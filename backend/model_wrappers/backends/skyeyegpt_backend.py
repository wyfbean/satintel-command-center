"""SkyEyeGPT backend — MiniGPT-v2/LLaMA2 remote-sensing VLM inference.

This host stores the SkyEyeGPT LoRA checkpoint separately from the licensed
LLaMA2-7B-chat base model and MiniGPT-v2 source tree. The wrapper builds a
runtime MiniGPT-v2 config from those local paths, then runs caption/VQA/dialogue
through MiniGPT's Chat helper.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any

from ..common import MODEL_WEIGHT_ROOT, ModelNotAvailableError, OUTPUT_DIR, WEIGHTS_DIR, envelope, pick_device, resolve_image
from ..schemas import SKYEYEGPT_TASKS

MODEL_NAME = "skyeyegpt"
_REPO = "https://github.com/ZhanYang-nwpu/SkyEyeGPT"
_MODEL_CACHE: dict[str, Any] = {}


def _first_existing(candidates: list[Path]) -> Path | None:
    return next((path for path in candidates if path.exists()), None)


def _asset_status() -> dict[str, Any]:
    ckpt = _first_existing([
        Path(os.environ.get("SKYEYEGPT_CKPT", "")) if os.environ.get("SKYEYEGPT_CKPT") else Path("/__missing__"),
        WEIGHTS_DIR / "skyeyegpt" / "SkyEyeGPT.pth",
        MODEL_WEIGHT_ROOT / "SkyEyeGPT.pth",
        Path("/root/autodl-tmp/SkyEyeGPT/SkyEyeGPT.pth"),
    ])
    minigpt_root = _first_existing([
        Path(os.environ.get("MINIGPT_ROOT", "")) if os.environ.get("MINIGPT_ROOT") else Path("/__missing__"),
        MODEL_WEIGHT_ROOT / "MiniGPT-4",
        Path("/root/autodl-tmp/MiniGPT-4-main"),
    ])
    minigpt_cfg = minigpt_root / "eval_configs" / "minigptv2_eval.yaml" if minigpt_root else None
    llama_model = Path(os.environ.get("SKYEYEGPT_LLAMA_MODEL", "")) if os.environ.get("SKYEYEGPT_LLAMA_MODEL") else None

    missing_deps: list[str] = []
    for module in ("omegaconf", "transformers", "peft", "sentencepiece"):
        try:
            __import__(module)
        except Exception:
            missing_deps.append(module)

    return {
        "checkpoint": str(ckpt) if ckpt else "",
        "checkpoint_exists": bool(ckpt),
        "minigpt_root": str(minigpt_root) if minigpt_root else "",
        "minigpt_config": str(minigpt_cfg) if minigpt_cfg else "",
        "minigpt_config_exists": bool(minigpt_cfg and minigpt_cfg.exists()),
        "llama_model": str(llama_model) if llama_model else "",
        "llama_model_exists": bool(llama_model and llama_model.exists()),
        "missing_python_deps": missing_deps,
    }


def _not_available_reason(status: dict[str, Any]) -> str:
    problems: list[str] = []
    if not status["checkpoint_exists"]:
        problems.append("SkyEyeGPT checkpoint not found")
    if not status["minigpt_config_exists"]:
        problems.append("MiniGPT-v2 config not found")
    if not status["llama_model_exists"]:
        problems.append("LLaMA2-7B-chat HF directory is not configured/found; set SKYEYEGPT_LLAMA_MODEL")
    if status["missing_python_deps"]:
        problems.append("missing Python deps: " + ", ".join(status["missing_python_deps"]))
    return "; ".join(problems)


def _normalize_history(raw_history: object) -> list[dict[str, str]]:
    if raw_history is None:
        return []
    if not isinstance(raw_history, list):
        raise ValueError("history must be a list of {'role': ..., 'content': ...}")

    aliases = {"human": "user", "user": "user", "assistant": "assistant", "ai": "assistant", "model": "assistant"}
    normalized: list[dict[str, str]] = []
    for idx, item in enumerate(raw_history):
        if not isinstance(item, dict):
            raise ValueError(f"history[{idx}] must be a dict")
        role = aliases.get(str(item.get("role")).lower())
        content = item.get("content")
        if role is None:
            raise ValueError(f"history[{idx}] role must be user/assistant")
        if content is None:
            raise ValueError(f"history[{idx}] content must not be None")
        normalized.append({"role": role, "content": str(content)})

    for idx, turn in enumerate(normalized):
        expected = "user" if idx % 2 == 0 else "assistant"
        if turn["role"] != expected:
            raise ValueError(f"history must alternate user/assistant and start with user; index {idx} is {turn['role']}")
    if normalized and normalized[-1]["role"] != "assistant":
        raise ValueError("history must end with an assistant turn before the current prompt")
    return normalized


def _runtime_config(status: dict[str, Any]) -> Path:
    from omegaconf import OmegaConf  # noqa: PLC0415

    cfg = OmegaConf.load(status["minigpt_config"])
    cfg.model.ckpt = status["checkpoint"]
    cfg.model.llama_model = status["llama_model"]
    cfg.model.low_resource = False
    cfg.model.image_size = int(cfg.model.get("image_size", 448) or 448)
    cfg.model.max_txt_len = int(cfg.model.get("max_txt_len", 500) or 500)
    cfg.model.end_sym = cfg.model.get("end_sym", "</s>")
    cfg.model.prompt_template = cfg.model.get("prompt_template", "[INST] {} [/INST]")
    cfg.model.lora_r = int(cfg.model.get("lora_r", 64) or 64)
    cfg.model.lora_alpha = int(cfg.model.get("lora_alpha", 16) or 16)
    cfg.model.model_type = "pretrain"
    cfg.run.task = cfg.run.get("task", "image_text_pretrain")

    out_dir = OUTPUT_DIR / "skyeyegpt"
    out_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = out_dir / "skyeyegpt_runtime.yaml"
    OmegaConf.save(cfg, cfg_path)
    return cfg_path


def _patch_runtime_compat() -> None:
    import peft  # noqa: PLC0415
    import torch  # noqa: PLC0415

    if not hasattr(peft, "prepare_model_for_int8_training") and hasattr(peft, "prepare_model_for_kbit_training"):
        peft.prepare_model_for_int8_training = peft.prepare_model_for_kbit_training

    if not getattr(torch.load, "_satintel_skyeyegpt_patched", False):
        original_load = torch.load

        def _load_compat(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return original_load(*args, **kwargs)

        _load_compat._satintel_skyeyegpt_patched = True
        torch.load = _load_compat


def _load_runtime(status: dict[str, Any], device: str):
    cache_key = f"{status['checkpoint']}|{status['llama_model']}|{device}"
    if _MODEL_CACHE.get("cache_key") == cache_key:
        return _MODEL_CACHE["model"], _MODEL_CACHE["chat"], _MODEL_CACHE["vis_processor"]

    minigpt_root = status["minigpt_root"]
    if minigpt_root not in sys.path:
        sys.path.insert(0, minigpt_root)
    os.environ.setdefault("WANDB_MODE", "disabled")

    _patch_runtime_compat()

    import torch  # noqa: PLC0415
    from minigpt4.common.config import Config  # noqa: PLC0415
    from minigpt4.common.registry import registry  # noqa: PLC0415
    from minigpt4.conversation.conversation import Chat  # noqa: PLC0415
    from transformers import StoppingCriteriaList  # noqa: PLC0415
    import minigpt4.models  # noqa: F401,PLC0415
    import minigpt4.models.modeling_llama as minigpt_llama  # noqa: PLC0415
    import minigpt4.processors  # noqa: F401,PLC0415

    if not getattr(minigpt_llama.LlamaForCausalLM.forward, "_satintel_cache_position_patched", False):
        original_forward = minigpt_llama.LlamaForCausalLM.forward

        def _forward_compat(self, *args, cache_position=None, **kwargs):
            kwargs.pop("cache_position", None)
            return original_forward(self, *args, **kwargs)

        _forward_compat._satintel_cache_position_patched = True
        minigpt_llama.LlamaForCausalLM.forward = _forward_compat

    cfg_path = _runtime_config(status)

    class Args:
        pass

    args = Args()
    args.cfg_path = str(cfg_path)
    args.options = None
    args.gpu_id = 0

    cfg = Config(args)
    model_config = cfg.model_cfg
    model_config.device_8bit = 0
    model_cls = registry.get_model_class(model_config.arch)
    model = model_cls.from_config(model_config).to(device).eval()
    load_stats = _load_legacy_skyeyegpt_lora(model, Path(status["checkpoint"]))

    vis_processor_cfg = cfg.datasets_cfg.cc_sbu_align.vis_processor.train
    vis_processor = registry.get_processor_class(vis_processor_cfg.name).from_config(vis_processor_cfg)
    chat = Chat(model, vis_processor, device=device, stopping_criteria=StoppingCriteriaList())

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    _MODEL_CACHE.update({
        "cache_key": cache_key,
        "model": model,
        "chat": chat,
        "vis_processor": vis_processor,
        "load_stats": load_stats,
    })
    return model, chat, vis_processor


def _load_legacy_skyeyegpt_lora(model: Any, ckpt_path: Path) -> dict[str, int]:
    """Load SkyEyeGPT's old PEFT LoRA keys into newer PEFT modules.

    The checkpoint uses keys such as `lora_A.weight`; PEFT 0.19 stores the same
    tensors under `lora_A.default.weight`. MiniGPT's own strict=False load only
    matches `llama_proj`, so without this remap the LLM LoRA adapter is inert.
    """
    import torch  # noqa: PLC0415

    raw = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    state = raw.get("model", raw) if isinstance(raw, dict) else raw
    model_keys = set(model.state_dict().keys())
    remapped: dict[str, Any] = {}
    direct = 0
    lora = 0
    skipped = 0

    for key, value in state.items():
        target = key
        if ".lora_A.weight" in key:
            target = key.replace(".lora_A.weight", ".lora_A.default.weight")
        elif ".lora_B.weight" in key:
            target = key.replace(".lora_B.weight", ".lora_B.default.weight")

        if target in model_keys:
            remapped[target] = value
            if target == key:
                direct += 1
            else:
                lora += 1
        else:
            skipped += 1

    msg = model.load_state_dict(remapped, strict=False)
    return {
        "direct_keys": direct,
        "remapped_lora_keys": lora,
        "skipped_keys": skipped,
        "missing_after_remap": len(getattr(msg, "missing_keys", [])),
        "unexpected_after_remap": len(getattr(msg, "unexpected_keys", [])),
    }


def _conversation_template():
    from minigpt4.conversation.conversation import CONV_VISION_minigptv2  # noqa: PLC0415

    return CONV_VISION_minigptv2.copy()


def _prompt_for(task: str, prompt: str | None) -> str:
    if prompt:
        return prompt
    if task == "caption":
        return "Describe this remote sensing image in one concise sentence."
    if task == "grounding":
        return "Identify and describe the target region in the image."
    return "Answer the question about this remote sensing image."


def run(image: str, task: str, prompt: str | None = None, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
    started = time.monotonic()
    device = pick_device()
    if task not in SKYEYEGPT_TASKS:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"unsupported task {task!r}, expected one of {SKYEYEGPT_TASKS}")
    if task in ("vqa", "dialogue", "grounding") and not prompt:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"'prompt' is required for task {task!r}")

    status = _asset_status()
    reason = _not_available_reason(status)
    if reason:
        err = ModelNotAvailableError(
            MODEL_NAME,
            reason,
            download_hint=(
                f"{_REPO}; current host has checkpoint={status['checkpoint'] or 'missing'}, "
                f"MiniGPT-v2={status['minigpt_root'] or 'missing'}, LLaMA2={status['llama_model'] or 'missing'}."
            ),
        )
        return envelope(model=MODEL_NAME, task=task, ok=False, error=str(err), device=device, weights=status["checkpoint"], started_at=started)

    try:
        import torch  # noqa: PLC0415
        from PIL import Image  # noqa: PLC0415

        image_path = resolve_image(image)
        if task != "dialogue" and not image_path.exists():
            raise FileNotFoundError(str(image_path))

        model, chat, _vis_processor = _load_runtime(status, device)
        chat_state = _conversation_template()
        img_list: list[Any] = []

        if image_path.exists():
            pil_image = Image.open(image_path).convert("RGB")
            chat.upload_img(pil_image, chat_state, img_list)
            chat.encode_img(img_list)

        for turn in _normalize_history(history):
            if turn["role"] == "user":
                chat.ask(turn["content"], chat_state)
            else:
                chat_state.append_message(chat_state.roles[1], turn["content"])

        final_prompt = _prompt_for(task, prompt)
        chat.ask(final_prompt, chat_state)
        with torch.inference_mode():
            generation_kwargs = chat.answer_prepare(
                conv=chat_state,
                img_list=img_list,
                num_beams=1,
                temperature=0.6,
                max_new_tokens=256 if task == "caption" else 512,
                max_length=2000,
            )
            generation_kwargs["min_new_tokens"] = 12 if task == "caption" else 8
            output_tokens = chat.model_generate(**generation_kwargs)[0].detach().cpu()
        answer = model.llama_tokenizer.decode(output_tokens, skip_special_tokens=True)
        answer = answer.split("###")[0].split("Assistant:")[-1].strip()
        chat_state.messages[-1][1] = answer
        answer = answer.strip()
        if task == "caption" and answer and answer[-1] not in ".!?。！？":
            answer += "."
        generated_tokens = int(output_tokens.numel() if hasattr(output_tokens, "numel") else getattr(output_tokens, "size", 0) or len(output_tokens))

        key = "caption" if task == "caption" else "answer"
        return envelope(
            model=MODEL_NAME,
            task=task,
            ok=True,
            device=device,
            weights=status["checkpoint"],
            started_at=started,
            result={
                key: answer,
                "answer": answer,
                "prompt": final_prompt,
                "image_path": str(image_path) if image_path.exists() else "",
                "generated_tokens": generated_tokens,
                "runtime": {
                    "minigpt_root": status["minigpt_root"],
                    "llama_model": status["llama_model"],
                    "architecture": "minigpt_v2",
                    "load_stats": _MODEL_CACHE.get("load_stats", {}),
                },
            },
        )
    except Exception as exc:  # noqa: BLE001
        return envelope(
            model=MODEL_NAME,
            task=task,
            ok=False,
            error=f"SkyEyeGPT runtime failed: {type(exc).__name__}: {exc}",
            device=device,
            weights=status["checkpoint"],
            started_at=started,
            result={"asset_status": status},
        )


if __name__ == "__main__":
    import json

    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(run(**payload), ensure_ascii=False))  # noqa: T201
