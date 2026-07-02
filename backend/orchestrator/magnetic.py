"""Single tool-calling agent (autogen-style) for the /orchestration chat.

Replaces the former 5-stage CrewAI pipeline with **one** LLM agent: given the
user's request (and any attached image) it decides which `model_wrappers` tools
to call, calls them in a loop (OpenAI function-calling), and writes a concise
Chinese conclusion. Planning is implicit in the single agent's reasoning;
"execution" is just the agent invoking tools.

`run_magnetic(query, image_ref, emit)` keeps its name/signature so
`agui_bridge.py` is untouched. `emit(kind, payload)` carries `text` / `tool`
events and finally `__done__`.

Two modes:
  - **real** (`OPENAI_API_KEY` set): OpenAI function-calling loop; tools are the
    5 model wrappers (`schemas.TOOL_SCHEMAS`), executed via `model_wrappers.*`.
    The attached image is injected into image-taking tools at execution time, so
    the base64 never enters the LLM context.
  - **mock** (default, no key): deterministic single-agent flow that ALWAYS emits
    at least one visible tool call plus a final conclusion — including for
    text-only input — so the loop shape is demonstrated rather than silently
    skipped.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Callable

Emit = Callable[[str, dict[str, Any]], None]

MAX_TOOL_ROUNDS = 4

# Tools whose `image` argument is auto-filled from the attached image at
# execution time (every model wrapper takes an image; sattxt's is optional).
_IMAGE_TOOLS = {"skyeyegpt", "sarmae", "dofa", "sattxt", "mtp"}

_DOFA_HEAD_GUIDE = (
    "DOFA dataset_head 选择规则："
    "若用户只上传普通 RGB 图像，只能使用 3-band RGB head；"
    "若用户上传多张单波段 TIFF/GeoTIFF，且文件名/元数据能匹配 B02/B03/B04/B08 等波段，系统会自动合成多光谱 manifest 供 DOFA 使用；"
    "m-NeonTree 是 RGB 树冠/单木二分类分割，仅在用户明确要树木/树冠时使用；"
    "m-nz-cattle 是 RGB 牛只/牲畜二分类分割，仅在用户明确要牧场牛只时使用；"
    "m-pv4ger-seg 是 RGB 光伏板/太阳能电站二分类分割，仅在用户明确要光伏/太阳能板时使用，"
    "100% 背景只表示未发现光伏，不代表完成了城市/道路/建筑分割；"
    "m-chesapeake 是 4-band Blue/Green/Red/NIR 土地覆盖 head，需要 B02+B03+B04+B08 或等价 4 波段输入；"
    "m-SA-crop-type 和 m-cashew-plant 是 12-band Sentinel-2 多光谱 head，需要 B01/B02/B03/B04/B05/B06/B07/B08/B8A/B09/B11/B12。"
    "普通城市、建筑、道路、水体、裸地、通用土地覆盖的 RGB 图片，目前没有合适的 DOFA 真分割头；"
    "不要为了通用分割改用 m-pv4ger-seg。此类请求应说明 DOFA 不适用，并改用 SATtxt 做场景/地物文本判断，必要时用 MTP 做 RGB 目标检测。"
)

_SARMAE_GUIDE = (
    "SARMAE 使用规则："
    "sarmae task='segment' 当前可用，并且使用真实 fine-tuned UPerHead，不是 k-means fallback；"
    "该分割头来自 AIR-PolarSAR-Seg，适用于 SAR/PolSAR 场景语义分割，6 个类别为 "
    "0=Industrial, 1=Natural, 2=Water, 3=Land_Use, 4=Housing, 5=Other；"
    "当用户要求 SAR 图像的语义分割、水体/建筑/工业/自然/土地利用等 SAR 场景分割时，优先调用 sarmae task='segment'。"
    "当用户明确说“使用 UPerHead / UPer 进行分割”时，UPerHead 在本系统中专指 SARMAE 的真实分割头，"
    "若已附加图像则必须直接调用 sarmae task='segment'，不要反问影像类型；"
    "sarmae task='detect' 当前也可用，使用 detect_epoch_34.pth 的真实 fine-tuned mmrotate rotated detector；"
    "若检测失败，必须按工具 error 的具体原因解释；不要把普通读图失败/输入格式失败归因于 CUDA/cuDNN，"
    "也不要声称已 CPU 回退，除非工具结果中明确写了 cpu retry。"
)


def _llm_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def run_magnetic(
    query: str,
    image_ref: str | None,
    emit: Emit,
    image_refs: list[dict[str, Any]] | None = None,
    image_metadata: dict[str, Any] | None = None,
) -> None:
    emit("text", {"text": "正在分析……"})
    if image_ref and _is_uperhead_request(query):
        result = _safe_call("sarmae", {"task": "segment"}, image_ref, image_refs)
        emit("tool", {"name": "sarmae", "args": {"task": "segment"}, "result": result})
        if result.get("ok"):
            emit("text", {"text": "已按你的要求使用 SARMAE 的真实 fine-tuned UPerHead 完成分割。该头为 AIR-PolarSAR-Seg 6 类语义分割：Industrial、Natural、Water、Land_Use、Housing、Other。"})
        else:
            emit("text", {"text": f"SARMAE UPerHead 分割调用失败：{result.get('error', 'unknown error')}"})
        emit("__done__", {})
        return
    if _llm_configured():
        try:
            _run_agent(query, image_ref, emit, image_refs or [], image_metadata)
            emit("__done__", {})
            return
        except Exception as exc:  # noqa: BLE001 - degrade to mock on any real-mode failure
            emit("text", {"text": f"（实时智能体不可用，回退到确定性演示：{exc}）"})
    _run_mock(query, image_ref, emit, image_refs or [])
    emit("__done__", {})


# --------------------------------------------------------------------------- #
# tool plumbing (shared by real + mock)
# --------------------------------------------------------------------------- #



def _deployment_status() -> dict[str, bool]:
    """Best-effort local capability flags used to keep the LLM away from tools
    that are known to be unavailable on this host. The wrappers still enforce
    hard checks; this is only routing guidance/fallback.
    """
    import importlib.util  # noqa: PLC0415
    from pathlib import Path  # noqa: PLC0415

    def has_mod(name: str) -> bool:
        return importlib.util.find_spec(name) is not None

    def has_conda_env(name: str) -> bool:
        try:
            from model_wrappers.common import _conda_env_exists  # noqa: PLC0415

            return _conda_env_exists(name)
        except Exception:  # noqa: BLE001 - routing hint only
            return False

    llama_model = os.environ.get("SKYEYEGPT_LLAMA_MODEL", "")
    sky_env = os.environ.get("SKYEYEGPT_CONDA_ENV", "/root/autodl-tmp/conda-envs/skyeyegpt")
    sky_local_runtime = has_mod("omegaconf") and has_mod("transformers") and has_mod("peft")
    local_openmmlab = has_mod("mmdet") and has_mod("mmrotate") and has_mod("mmcv")
    sarmae_env = os.environ.get("SARMAE_CONDA_ENV", "sarmae")
    sarmae_detect_env_exists = has_conda_env(sarmae_env) or Path("/root/miniconda3/envs/sarmae").exists()
    return {
        "skyeyegpt": bool(llama_model and Path(llama_model).exists() and (sky_local_runtime or has_conda_env(sky_env))),
        "mtp": local_openmmlab or has_conda_env("mtp"),
        "sarmae_real_detect": local_openmmlab or sarmae_detect_env_exists,
    }


def _available_tool_names() -> set[str]:
    status = _deployment_status()
    tools = {"dofa", "sarmae", "sattxt"}
    if status["skyeyegpt"]:
        tools.add("skyeyegpt")
    if status["mtp"]:
        tools.add("mtp")
    return tools


def _is_caption_request(query: str) -> bool:
    q = query.lower()
    return any(token in q for token in ["图片里面", "图里", "图像里", "有什么", "描述", "caption", "describe", "what is in this image"])


def _is_uperhead_request(query: str) -> bool:
    q = query.lower()
    return "uperhead" in q or "uper head" in q or "uper-head" in q or "uper" in q


def _fallback_caption(image_ref: str | None) -> dict[str, Any]:
    """SkyEyeGPT-free image description fallback using deployed tools.

    It is intentionally conservative: SATtxt ranks broad scene labels without
    pretending that a task-specific DOFA head is generic. This avoids exposing SkyEyeGPT deployment
    errors to end users when LLaMA2 weights are unavailable.
    """
    if not image_ref:
        return {"ok": False, "model": "fallback_caption", "task": "caption", "error": "no image attached"}
    scene_labels = ["城市建筑群", "道路", "机场跑道", "港口码头", "农田", "森林", "水体", "云层覆盖", "裸地", "工业设施"]
    cls = _safe_call("sattxt", {"task": "zero_shot_classify", "text": scene_labels}, image_ref)
    predictions = []
    if cls.get("ok") and isinstance(cls.get("result"), dict):
        predictions = cls["result"].get("predictions", [])[:3]
    labels = "、".join(p.get("label", "") for p in predictions if isinstance(p, dict) and p.get("label"))
    summary = f"图像可能包含：{labels or '遥感地物/场景'}。"
    return {
        "ok": True,
        "model": "fallback_caption",
        "task": "caption",
        "result": {"summary": summary, "scene_predictions": predictions},
        "meta": {"device": "local", "weights": "sattxt fallback"},
    }

def _safe_call(
    name: str,
    args: dict[str, Any],
    image_ref: str | None,
    image_refs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Execute one model wrapper, injecting the attached image, never raising."""
    from model_wrappers import remote_models as rm  # noqa: PLC0415

    func = getattr(rm, name, None)
    if func is None:
        return {"ok": False, "model": name, "task": "", "error": f"unknown tool '{name}'"}
    call_args = dict(args or {})
    if name == "dofa":
        multiband = _dofa_multiband_manifest(call_args, image_refs or [])
        if multiband:
            call_args["image"] = multiband["image"]
            call_args["bands"] = multiband["bands"]
        elif _is_dofa_multispectral_head(call_args.get("dataset_head")) and image_refs:
            found = _dofa_found_bands(image_refs or [])
            missing = _dofa_missing_bands(str(call_args.get("dataset_head")), image_refs or [])
            return {
                "ok": False,
                "model": name,
                "task": call_args.get("task", ""),
                "error": (
                    f"DOFA multispectral input is incomplete for {call_args.get('dataset_head')}; "
                    f"found bands={found or 'none'}, missing={missing or 'unknown'}. "
                    "m-chesapeake needs Blue/Green/Red/NIR (B02/B03/B04/B08; B8A or NIR is accepted as a NIR substitute)."
                ),
            }
    if image_ref and name in _IMAGE_TOOLS:
        call_args.setdefault("image", image_ref)
    if name in _IMAGE_TOOLS and not call_args.get("image"):
        return {
            "ok": False,
            "model": name,
            "task": call_args.get("task", ""),
            "error": (
                f"no injectable image found for tool call; attached_images={len(image_refs or [])}. "
                "If this is a DOFA multispectral request, upload files named with B02/B03/B04/B08 etc."
            ),
        }
    try:
        return func(**call_args)
    except Exception as exc:  # noqa: BLE001 - surface as an ok=False envelope
        return {"ok": False, "model": name, "task": call_args.get("task", ""), "error": str(exc)}


def _image_raw_ref(image: dict[str, Any]) -> str | None:
    for key in ("rawRef", "image", "path", "dataUrl"):
        val = image.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _image_band_role(image: dict[str, Any]) -> tuple[str | None, str | None]:
    metadata = image.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    band = metadata.get("inferredBand")
    role = metadata.get("inferredRole")
    if not band:
        inferred = _infer_band_from_metadata(metadata)
        if inferred:
            band, role = inferred
    if not band:
        for key in ("name", "filename", "rawRef", "path", "image"):
            val = image.get(key) or metadata.get(key)
            if isinstance(val, str):
                inferred = _infer_band_from_name(val)
                if inferred:
                    band, role = inferred
                    break
    if not band:
        raw_ref = _image_raw_ref(image)
        if raw_ref:
            inferred = _infer_band_from_tiff_metadata(raw_ref)
            if inferred:
                band, role = inferred
    return (band if isinstance(band, str) else None, role if isinstance(role, str) else None)


def _infer_band_from_metadata(metadata: dict[str, Any]) -> tuple[str, str] | None:
    keys = (
        "band", "bandName", "band_name", "name", "filename", "description",
        "imageDescription", "ImageDescription", "gdalMetadata", "GDAL_METADATA",
        "wavelength", "centerWavelength", "central_wavelength",
    )
    texts: list[str] = []
    for key in keys:
        val = metadata.get(key)
        if isinstance(val, (str, int, float)):
            texts.append(str(val))
    for val in metadata.values():
        if isinstance(val, dict):
            nested = _infer_band_from_metadata(val)
            if nested:
                return nested
        elif isinstance(val, list):
            texts.extend(str(item) for item in val if isinstance(item, (str, int, float)))
    return _infer_band_from_name(" ".join(texts)) if texts else None


def _infer_band_from_name(name: str) -> tuple[str, str] | None:
    upper = name.upper()
    match = re.search(r"(?:^|[_\-.])B(0[1-9]|1[0-2]|8A|8)(?:[_\-.]|$)", upper)
    if match:
        raw = match.group(1)
        band = "B08" if raw == "8" else f"B{raw}"
    elif re.search(r"(?:^|[_\-.])(NIR|NEAR[_\-.]?INFRARED)(?:[_\-.]|$)", upper):
        band = "B08"
    else:
        return None
    roles = {
        "B01": "Coastal",
        "B02": "Blue",
        "B03": "Green",
        "B04": "Red",
        "B05": "RedEdge1",
        "B06": "RedEdge2",
        "B07": "RedEdge3",
        "B08": "NIR",
        "B8A": "NarrowNIR",
        "B09": "WaterVapor",
        "B10": "Cirrus",
        "B11": "SWIR1",
        "B12": "SWIR2",
    }
    return band, roles.get(band, band)


def _infer_band_from_tiff_metadata(path: str) -> tuple[str, str] | None:
    if not path.lower().endswith((".tif", ".tiff", ".geotiff")):
        return None
    try:
        from PIL import Image  # noqa: PLC0415

        img = Image.open(path)
        tag_texts: list[str] = []
        for tag in (270, 305, 315, 42112, 42113, 34737):
            val = img.tag_v2.get(tag)
            if val is not None:
                tag_texts.append(str(val))
        return _infer_band_from_name(" ".join(tag_texts)) if tag_texts else None
    except Exception:  # noqa: BLE001 - metadata is best-effort only
        return None


def _role_key(role: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (role or "").lower())


def _is_dofa_multispectral_head(dataset_head: Any) -> bool:
    return str(dataset_head) in {"m-chesapeake", "m-SA-crop-type", "m-cashew-plant"}


def _dofa_found_bands(images: list[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for image in images:
        band, role = _image_band_role(image)
        label = band or role
        if label and label not in found:
            found.append(label)
    return sorted(found)


def _dofa_requirements(dataset_head: str) -> list[dict[str, Any]]:
    sentinel12 = [
        {"band": "B01", "role": "Coastal", "wavelength": 0.443, "aliases": [("B01", "Coastal", 0.443)]},
        {"band": "B02", "role": "Blue", "wavelength": 0.49, "aliases": [("B02", "Blue", 0.49)]},
        {"band": "B03", "role": "Green", "wavelength": 0.56, "aliases": [("B03", "Green", 0.56)]},
        {"band": "B04", "role": "Red", "wavelength": 0.665, "aliases": [("B04", "Red", 0.665)]},
        {"band": "B05", "role": "RedEdge1", "wavelength": 0.705, "aliases": [("B05", "RedEdge1", 0.705)]},
        {"band": "B06", "role": "RedEdge2", "wavelength": 0.74, "aliases": [("B06", "RedEdge2", 0.74)]},
        {"band": "B07", "role": "RedEdge3", "wavelength": 0.783, "aliases": [("B07", "RedEdge3", 0.783)]},
        {"band": "B08", "role": "NIR", "wavelength": 0.842, "aliases": [("B08", "NIR", 0.842)]},
        {"band": "B8A", "role": "NarrowNIR", "wavelength": 0.865, "aliases": [("B8A", "NarrowNIR", 0.865)]},
        {"band": "B09", "role": "WaterVapor", "wavelength": 0.945, "aliases": [("B09", "WaterVapor", 0.945)]},
        {"band": "B11", "role": "SWIR1", "wavelength": 1.61, "aliases": [("B11", "SWIR1", 1.61)]},
        {"band": "B12", "role": "SWIR2", "wavelength": 2.19, "aliases": [("B12", "SWIR2", 2.19)]},
    ]
    if dataset_head == "m-chesapeake":
        return [
            {"band": "B02", "role": "Blue", "wavelength": 0.49, "aliases": [("B02", "Blue", 0.49)]},
            {"band": "B03", "role": "Green", "wavelength": 0.56, "aliases": [("B03", "Green", 0.56)]},
            {"band": "B04", "role": "Red", "wavelength": 0.665, "aliases": [("B04", "Red", 0.665)]},
            {"band": "B08", "role": "NIR", "wavelength": 0.842, "aliases": [("B08", "NIR", 0.842), ("B8", "NIR", 0.842), ("B8A", "NIR", 0.865), ("NIR", "NIR", 0.842)]},
        ]
    if dataset_head in {"m-SA-crop-type", "m-cashew-plant"}:
        return sentinel12
    return []


def _find_image_for_requirement(req: dict[str, Any], images: list[dict[str, Any]]) -> tuple[dict[str, Any], str, float] | None:
    aliases = req.get("aliases") or [(req["band"], req["role"], req["wavelength"])]
    for alias_band, alias_role, wavelength in aliases:
        alias_band = str(alias_band).upper()
        alias_role_key = _role_key(str(alias_role))
        for image in images:
            band, role = _image_band_role(image)
            band_key = (band or "").upper()
            role_key = _role_key(role)
            if band_key == alias_band or role_key == alias_role_key:
                return image, str(req["role"]), float(wavelength)
    return None


def _dofa_missing_bands(dataset_head: str, images: list[dict[str, Any]]) -> list[str]:
    missing = []
    for req in _dofa_requirements(dataset_head):
        if not _find_image_for_requirement(req, images):
            missing.append(f"{req['band']}/{req['role']}")
    return missing


def _dofa_multiband_manifest(args: dict[str, Any], images: list[dict[str, Any]]) -> dict[str, Any] | None:
    dataset_head = str(args.get("dataset_head"))
    required = _dofa_requirements(dataset_head)
    if not required or len(images) < len(required):
        return None

    sources: list[dict[str, Any]] = []
    for req in required:
        match = _find_image_for_requirement(req, images)
        image, role, wavelength = match if match else (None, None, None)
        raw_ref = _image_raw_ref(image) if image else None
        if not raw_ref:
            return None
        sources.append({"path": raw_ref, "band": req["band"], "role": role, "wavelength": wavelength})

    try:
        from model_wrappers.common import OUTPUT_DIR  # noqa: PLC0415
    except ModuleNotFoundError:  # pragma: no cover - root-level tooling import path
        from backend.model_wrappers.common import OUTPUT_DIR  # type: ignore[import-not-found]  # noqa: PLC0415

    manifest = {
        "type": "satintel_multiband_manifest",
        "dataset_head": dataset_head,
        "sources": sources,
    }
    path = OUTPUT_DIR / f"dofa_multiband_{abs(hash(json.dumps(manifest, sort_keys=True)))}.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return {"image": str(path), "bands": [float(s["wavelength"]) for s in sources]}


def _openai_tools() -> list[dict[str, Any]]:
    """Map TOOL_SCHEMAS → OpenAI function-calling tool defs, hiding `image`
    (auto-injected at execution time, so the model never invents a path)."""
    from model_wrappers.schemas import TOOL_SCHEMAS  # noqa: PLC0415

    available = _available_tool_names()
    status = _deployment_status()
    tools: list[dict[str, Any]] = []
    for name, spec in TOOL_SCHEMAS.items():
        if name not in available:
            continue
        params = json.loads(json.dumps(spec["input"]))  # deep copy
        params.get("properties", {}).pop("image", None)
        if isinstance(params.get("required"), list):
            params["required"] = [r for r in params["required"] if r != "image"]
        description = spec["description"]
        if name == "sarmae" and not status["sarmae_real_detect"]:
            description += " 当前环境的 task='segment' 可用且为真实 fine-tuned UPerHead；task='detect' 仅在检测环境缺失时报不可用。"
        if name == "dofa":
            description += " " + _DOFA_HEAD_GUIDE
        if name == "sarmae":
            description += " " + _SARMAE_GUIDE
        tools.append(
            {
                "type": "function",
                "function": {"name": name, "description": description, "parameters": params},
            }
        )
    return tools


def _compact_for_llm(result: dict[str, Any]) -> str:
    """Strip bulky arrays before feeding a tool result back into the LLM context."""
    slim = dict(result)
    inner = slim.get("result")
    if isinstance(inner, dict):
        inner = {k: v for k, v in inner.items() if k not in {"mask", "mask_grid", "embedding", "features"}}
        slim["result"] = inner
    text = json.dumps(slim, ensure_ascii=False)
    return text[:4000]


# --------------------------------------------------------------------------- #
# real mode — single OpenAI function-calling agent loop
# --------------------------------------------------------------------------- #

def _run_agent(
    query: str,
    image_ref: str | None,
    emit: Emit,
    image_refs: list[dict[str, Any]],
    image_metadata: dict[str, Any] | None,
) -> None:
    from openai import OpenAI  # noqa: PLC0415

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], base_url=os.environ.get("OPENAI_BASE_URL"))
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    tools = _openai_tools()

    status = _deployment_status()
    unavailable_notes = []
    if not status["skyeyegpt"]:
        unavailable_notes.append("SkyEyeGPT 未部署完整 LLaMA2/MiniGPT-v2 运行栈；图片描述请用 SATtxt 场景标签，必要时结合 MTP/SARMAE 结果，不要调用 SkyEyeGPT。")
    if not status["mtp"]:
        unavailable_notes.append("MTP 需要独立 mmdet/mmrotate 环境；当前不要调用 MTP。")
    if not status["sarmae_real_detect"]:
        unavailable_notes.append("SARMAE 真检测环境缺 mmdet/mmrotate；此时不要调用 sarmae detect。")
    system = (
        "你是遥感分析智能体。根据用户请求（可能附带一张或多张卫星/SAR/多光谱图像）决定调用哪些遥感模型工具完成分析，"
        "可多轮调用工具；拿到工具结果后用简洁、可执行的中文给出研判结论。"
        + _DOFA_HEAD_GUIDE
        + _SARMAE_GUIDE
        + ("当前部署限制：" + "；".join(unavailable_notes) + "。" if unavailable_notes else "")
        + (
            f"用户已附加 {len(image_refs) or 1} 张图像；调用图像类工具时无需也不要指定 image 参数，系统会自动注入。"
            "若多张 TIFF 文件名包含 B02/B03/B04/B08/B11/B12 等，它们可能是同一多光谱样本的分波段文件；"
            "此时 m-chesapeake 可使用 B02+B03+B04+B08，m-SA-crop-type/m-cashew-plant 可使用 Sentinel-2 多波段组合。"
            if image_ref
            else "用户未附加图像；这些模型工具均需影像输入，若无合适工具可直接说明并给出建议。"
        )
        + (f"附件元数据：{json.dumps(image_metadata, ensure_ascii=False)[:3000]}。" if image_metadata else "")
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": query},
    ]

    for round_i in range(MAX_TOOL_ROUNDS + 1):
        final_turn = round_i == MAX_TOOL_ROUNDS
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice="none" if final_turn else "auto",
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            emit("text", {"text": msg.content or ""})
            return

        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ],
            }
        )
        for tc in msg.tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _safe_call(name, args, image_ref, image_refs)
            emit("tool", {"name": name, "args": args, "result": result})
            if name == "skyeyegpt" and not result.get("ok") and image_ref:
                fallback = _fallback_caption(image_ref)
                emit("tool", {"name": "fallback_caption", "args": {"reason": "skyeyegpt_unavailable"}, "result": fallback})
                result = fallback
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": _compact_for_llm(result)})


# --------------------------------------------------------------------------- #
# mock mode — deterministic single-agent flow (no LLM key)
# --------------------------------------------------------------------------- #

def _run_mock(query: str, image_ref: str | None, emit: Emit, image_refs: list[dict[str, Any]] | None = None) -> None:
    if image_ref:
        emit("text", {"text": f"已收到任务「{query}」并附带图像，调用已部署工具分析……"})
        calls = [
            ("skyeyegpt", {"task": "caption", "prompt": "Describe this remote sensing image in one concise sentence."}),
            ("sattxt", {"task": "zero_shot_classify", "text": ["机场跑道", "港口码头", "农田", "城市建筑群", "森林", "水体", "云层覆盖"]}),
        ]
    else:
        # Text-only: still demonstrate the loop with one visible tool call. The
        # model wrappers all need an image, so this honestly surfaces that.
        emit("text", {"text": f"已收到任务「{query}」，未附带图像；尝试调用模型工具以确认所需输入……"})
        calls = [("skyeyegpt", {"task": "caption", "image": ""})]

    results: list[tuple[str, dict[str, Any]]] = []
    for name, args in calls:
        result = _safe_call(name, args, image_ref, image_refs or [])
        emit("tool", {"name": name, "args": args, "result": result})
        if name == "skyeyegpt" and not result.get("ok") and image_ref:
            fallback = _fallback_caption(image_ref)
            emit("tool", {"name": "fallback_caption", "args": {"reason": "skyeyegpt_unavailable"}, "result": fallback})
            result = fallback
        results.append((name, result))

    emit("text", {"text": _summarize_mock(query, results, has_image=bool(image_ref))})


def _summarize_mock(query: str, results: list[tuple[str, dict[str, Any]]], *, has_image: bool) -> str:
    lines = [f"【研判结论】针对请求「{query}」："]
    any_ok = False
    for name, res in results:
        if res.get("ok"):
            any_ok = True
            inner = res.get("result", {})
            keys = ", ".join(list(inner.keys())[:6]) if isinstance(inner, dict) else ""
            lines.append(f"- {name}：调用成功（{keys}）。")
        else:
            lines.append(f"- {name}：{res.get('error', '未能执行')}")
    if not has_image:
        lines.append("提示：遥感模型工具均需影像输入，请附加卫星 / SAR 图像后重试。")
    if not any_ok:
        lines.append("（当前为无 LLM key 的确定性演示模式；设置 OPENAI_API_KEY 后将由单智能体自主规划并调用可用模型工具。）")
    return "\n".join(lines)
