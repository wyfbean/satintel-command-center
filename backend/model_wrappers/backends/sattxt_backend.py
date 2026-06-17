"""SATtxt backend — RemoteCLIP-backed zero-shot classification & retrieval.

The slide's "SATtxt" model (zero-shot classification / retrieval / image<->text)
maps directly onto **RemoteCLIP** (ChenDelong1999/RemoteCLIP,
https://github.com/ChenDelong1999/RemoteCLIP), a CLIP model continually
pre-trained on remote-sensing image-text pairs and distributed via
`open_clip` + HuggingFace (`chendelong/RemoteCLIP`). No public "SATtxt" repo
with downloadable weights was found at build time (its arXiv preprint,
2602.22613, predates any released checkpoint) — RemoteCLIP ViT-B-32 is used
as the concrete, real, runnable backend behind the `sattxt` tool name. If/when
SATtxt weights are published, drop the checkpoint at
`weights/sattxt/<file>.pt` and point `CKPT_PATH` at it; the wrapper contract
is unchanged.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from huggingface_hub import hf_hub_download

from ..common import ModelNotAvailableError, OUTPUT_DIR, WEIGHTS_DIR, envelope, pick_device, resolve_image

MODEL_NAME = "sattxt"
_HF_REPO = "chendelong/RemoteCLIP"
_HF_FILE = "RemoteCLIP-ViT-B-32.pt"
_ARCH = "ViT-B-32"

_model_cache: dict[str, Any] = {}


def _load(device: str):
    if "model" in _model_cache:
        return _model_cache["model"]
    try:
        import open_clip  # noqa: PLC0415
        import torch  # noqa: PLC0415
    except ImportError as exc:
        raise ModelNotAvailableError(
            MODEL_NAME, "open_clip_torch / torch not installed",
            download_hint="pip install open-clip-torch huggingface_hub",
        ) from exc

    model, _, preprocess = open_clip.create_model_and_transforms(_ARCH)
    tokenizer = open_clip.get_tokenizer(_ARCH)

    ckpt_path = WEIGHTS_DIR / "sattxt" / _HF_FILE
    if not ckpt_path.exists():
        try:
            ckpt_path.parent.mkdir(parents=True, exist_ok=True)
            downloaded = hf_hub_download(repo_id=_HF_REPO, filename=_HF_FILE, local_dir=str(ckpt_path.parent))
            ckpt_path = Path(downloaded)
        except Exception as exc:  # noqa: BLE001
            raise ModelNotAvailableError(
                MODEL_NAME,
                f"RemoteCLIP checkpoint not found locally and download failed ({exc})",
                download_hint=f"download {_HF_FILE} from https://huggingface.co/{_HF_REPO} "
                f"into {ckpt_path.parent}",
            ) from exc

    state_dict = torch.load(ckpt_path, map_location="cpu")
    model.load_state_dict(state_dict)
    model = model.to(device).eval()

    _model_cache.update({"model": model, "preprocess": preprocess, "tokenizer": tokenizer, "ckpt": str(ckpt_path)})
    return _model_cache["model"]


def run(task: str, image: str | None = None, text: str | list[str] | None = None) -> dict[str, Any]:
    started = time.monotonic()
    device = pick_device()
    try:
        _load(device)
        import torch  # noqa: PLC0415

        model = _model_cache["model"]
        preprocess = _model_cache["preprocess"]
        tokenizer = _model_cache["tokenizer"]
        ckpt = _model_cache["ckpt"]

        if task == "zero_shot_classify":
            if not image or not text:
                return envelope(model=MODEL_NAME, task=task, ok=False, error="'image' and 'text' (candidate labels) are required")
            labels = text if isinstance(text, list) else [text]
            img_path = resolve_image(image)
            if not img_path.exists():
                return envelope(model=MODEL_NAME, task=task, ok=False, error=f"image not found: {img_path}")

            from PIL import Image  # noqa: PLC0415

            img_t = preprocess(Image.open(img_path).convert("RGB")).unsqueeze(0).to(device)
            txt_t = tokenizer([f"a satellite photo of {label}" for label in labels]).to(device)
            with torch.no_grad():
                img_f = model.encode_image(img_t)
                txt_f = model.encode_text(txt_t)
                img_f /= img_f.norm(dim=-1, keepdim=True)
                txt_f /= txt_f.norm(dim=-1, keepdim=True)
                probs = (100.0 * img_f @ txt_f.T).softmax(dim=-1).squeeze(0).cpu().tolist()

            ranked = sorted(zip(labels, probs), key=lambda x: -x[1])
            return envelope(
                model=MODEL_NAME, task=task,
                result={"predictions": [{"label": l, "score": round(p, 4)} for l, p in ranked]},
                device=device, weights=ckpt, started_at=started,
            )

        if task in ("image_to_text_retrieval", "text_to_image_retrieval"):
            if not text:
                return envelope(model=MODEL_NAME, task=task, ok=False, error="'text' candidates are required")
            candidates = text if isinstance(text, list) else [text]
            txt_t = tokenizer(candidates).to(device)
            with torch.no_grad():
                txt_f = model.encode_text(txt_t)
                txt_f /= txt_f.norm(dim=-1, keepdim=True)

            if task == "image_to_text_retrieval":
                if not image:
                    return envelope(model=MODEL_NAME, task=task, ok=False, error="'image' is required for image_to_text_retrieval")
                img_path = resolve_image(image)
                if not img_path.exists():
                    return envelope(model=MODEL_NAME, task=task, ok=False, error=f"image not found: {img_path}")
                from PIL import Image  # noqa: PLC0415

                img_t = preprocess(Image.open(img_path).convert("RGB")).unsqueeze(0).to(device)
                with torch.no_grad():
                    img_f = model.encode_image(img_t)
                    img_f /= img_f.norm(dim=-1, keepdim=True)
                    sims = (img_f @ txt_f.T).squeeze(0).cpu().tolist()
                ranked = sorted(zip(candidates, sims), key=lambda x: -x[1])
                return envelope(
                    model=MODEL_NAME, task=task,
                    result={"ranking": [{"text": t, "score": round(s, 4)} for t, s in ranked]},
                    device=device, weights=ckpt, started_at=started,
                )

            # text_to_image_retrieval: rank a single image against text queries (per-query score)
            if not image:
                return envelope(model=MODEL_NAME, task=task, ok=False, error="'image' (candidate image) is required for text_to_image_retrieval")
            img_path = resolve_image(image)
            from PIL import Image  # noqa: PLC0415

            img_t = preprocess(Image.open(img_path).convert("RGB")).unsqueeze(0).to(device)
            with torch.no_grad():
                img_f = model.encode_image(img_t)
                img_f /= img_f.norm(dim=-1, keepdim=True)
                sims = (img_f @ txt_f.T).squeeze(0).cpu().tolist()
            ranked = sorted(zip(candidates, sims), key=lambda x: -x[1])
            return envelope(
                model=MODEL_NAME, task=task,
                result={"image": str(img_path), "query_scores": [{"text": t, "score": round(s, 4)} for t, s in ranked]},
                device=device, weights=ckpt, started_at=started,
            )

        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"unsupported task '{task}'")
    except ModelNotAvailableError as exc:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=str(exc), device=device)


if __name__ == "__main__":
    import json
    import sys

    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(run(**payload), ensure_ascii=False))  # noqa: T201
