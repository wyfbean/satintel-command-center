"""SARMAE backend — real ViT-L/16 encoder inference (MiliLab/SARMAE, CVPR 2026).

Checkpoint: `SARMAE_vitl_checkpoint-last` from
https://huggingface.co/Wenquandan777/SARMAE (CC-BY-NC-4.0), a MAE-pretrained
`vit_large_patch16_224` (timm) encoder per the repo's `SARMAE_Pretrain/models_vit.py`
(https://github.com/MiliLab/SARMAE).

Honest scope note: this is a *pretrain* checkpoint (encoder only — the repo's
fine-tuned detection/segmentation heads for RSAR / SARDet-100k / AIRSEG are
separate per-task checkpoints under `SARMAE_Fintune/`, built on MMRotate/MMSeg
and not bundled). Mirroring the `dofa_backend` approach, this backend:

1. Loads the real ViT-L/16 SARMAE encoder + real pretrained weights.
2. Runs a genuine forward pass (`forward_features`) on the input image.
3. `task="segment"`  -> k-means over patch embeddings -> per-patch cluster mask.
   `task="detect"`   -> the smallest cluster's patches are reported as
   coarse "anomalous region" bounding boxes (proxy for SAR target detection).

If fine-tuned MMRotate/MMSeg head checkpoints are later placed at
`weights/sarmae/heads/<task>.pth`, swap them in following the
`SARMAE_Fintune/Detection|Segmentation/mmrotate|mmseg/models/backbones/vit_timm.py`
configs (register `"sarmae"` -> a dedicated conda env in `CONDA_ENV_MAP` if
MMRotate/MMSeg versions conflict with this service's stack).
"""

from __future__ import annotations

import os
import time
import traceback
from pathlib import Path
from typing import Any

from ..common import MODEL_WEIGHT_ROOT, ModelNotAvailableError, OUTPUT_DIR, WEIGHTS_DIR, envelope, pick_device, resolve_image
from ..schemas import SARMAE_TASKS

MODEL_NAME = "sarmae"
_HF_REPO = "Wenquandan777/SARMAE"
_HF_FILE = "SARMAE_vitl_checkpoint-last"

def _default_heads_dir() -> Path:
    copied_heads = MODEL_WEIGHT_ROOT / "sarmae_seg_detect_weights"
    return copied_heads if copied_heads.exists() else WEIGHTS_DIR / "sarmae_heads"


# Fine-tuned head checkpoints (detect_epoch_34.pth / seg_iter_20000.pth) live here.
_HEADS_DIR = Path(os.environ.get("SARMAE_HEADS_DIR", str(_default_heads_dir())))
_SEG_CKPT = _HEADS_DIR / "seg_iter_20000.pth"
_DETECT_CKPT = _HEADS_DIR / "detect_epoch_34.pth"

_model_cache: dict[str, Any] = {}


def _load(device: str):
    if "model" in _model_cache:
        return _model_cache["model"]
    try:
        import timm  # noqa: PLC0415
        import torch  # noqa: PLC0415
    except ImportError as exc:
        raise ModelNotAvailableError(
            MODEL_NAME, "timm / torch not installed",
            download_hint="pip install timm torch huggingface_hub",
        ) from exc

    ckpt_candidates = [
        WEIGHTS_DIR / "sarmae" / _HF_FILE,
        MODEL_WEIGHT_ROOT / _HF_FILE,
    ]
    ckpt_path = next((p for p in ckpt_candidates if p.exists()), ckpt_candidates[0])
    if not ckpt_path.exists():
        try:
            from huggingface_hub import hf_hub_download  # noqa: PLC0415

            ckpt_path.parent.mkdir(parents=True, exist_ok=True)
            downloaded = hf_hub_download(repo_id=_HF_REPO, filename=_HF_FILE, local_dir=str(ckpt_path.parent))
            ckpt_path = Path(downloaded)
        except Exception as exc:  # noqa: BLE001
            raise ModelNotAvailableError(
                MODEL_NAME,
                f"SARMAE checkpoint not found locally and download failed ({exc})",
                download_hint=f"download {_HF_FILE} from https://huggingface.co/{_HF_REPO} "
                f"into {ckpt_path.parent}",
            ) from exc

    model = timm.create_model("vit_large_patch16_224", pretrained=False, num_classes=0, global_pool="")
    # The official SARMAE pretrain checkpoint pickles an argparse.Namespace (training args)
    # alongside the state dict, which torch>=2.6's default weights_only=True load rejects.
    try:
        raw = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    except TypeError as exc:
        if "weights_only" not in str(exc):
            raise
        raw = torch.load(ckpt_path, map_location="cpu")
    state_dict = raw.get("model", raw) if isinstance(raw, dict) else raw
    missing, unexpected = model.load_state_dict(state_dict, strict=False)

    model = model.to(device).eval()
    _model_cache.update({
        "model": model, "ckpt": str(ckpt_path),
        "missing": len(missing), "unexpected": len(unexpected),
    })
    return _model_cache["model"]


def _preprocess(image_path: Path, device: str):
    import torch  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415
    from torchvision import transforms  # noqa: PLC0415

    tfm = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    img = Image.open(image_path).convert("RGB")
    return tfm(img).unsqueeze(0).to(device), img.size


def _kmeans_labels(feats, k: int):
    import numpy as np

    rng = np.random.default_rng(0)
    centers = feats[rng.choice(len(feats), size=min(k, len(feats)), replace=False)]
    for _ in range(10):
        dists = ((feats[:, None, :] - centers[None, :, :]) ** 2).sum(-1)
        labels = dists.argmin(axis=1)
        for c in range(len(centers)):
            members = feats[labels == c]
            if len(members):
                centers[c] = members.mean(axis=0)
    return labels


def _to_uint8_channel(channel):
    import numpy as np  # noqa: PLC0415

    arr = np.asarray(channel)
    if arr.dtype == np.uint8:
        return arr
    arr = arr.astype("float32", copy=False)
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return np.zeros(arr.shape, dtype=np.uint8)
    lo, hi = np.percentile(finite, [1, 99])
    if hi <= lo:
        lo, hi = float(finite.min()), float(finite.max())
    if hi <= lo:
        return np.zeros(arr.shape, dtype=np.uint8)
    return np.clip((arr - lo) * 255.0 / (hi - lo), 0, 255).astype(np.uint8)


def _ensure_mmdet_readable_image(image_path: Path, mmcv_imread) -> tuple[Path, bool]:
    """Return an image path that MMDetection/MMCV can decode.

    SAR uploads are commonly 16-bit grayscale TIFF/GeoTIFF files. Older
    OpenMMLab pipelines call mmcv/cv2.imread inside LoadImageFromFile; when
    that returns None the next pipeline step fails with the misleading
    `'NoneType' object has no attribute 'shape'`. Convert such inputs to an
    8-bit RGB PNG before invoking inference_detector.
    """
    try:
        probe = mmcv_imread(str(image_path))
        if probe is not None and getattr(probe, "shape", None) is not None:
            return image_path, False
    except Exception:  # noqa: BLE001 - fall through to conversion
        pass

    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    with Image.open(image_path) as img:
        arr = np.asarray(img)

    if arr.ndim == 2:
        ch = _to_uint8_channel(arr)
        rgb = np.stack([ch, ch, ch], axis=-1)
    elif arr.ndim == 3:
        # Some TIFF readers expose band-first arrays. Convert small-band
        # channel-first tensors to HWC before selecting RGB-like channels.
        if arr.shape[0] <= 16 and arr.shape[1] > 32 and arr.shape[2] > 32 and arr.shape[-1] > 16:
            arr = np.moveaxis(arr, 0, -1)
        if arr.shape[-1] == 1:
            ch = _to_uint8_channel(arr[..., 0])
            rgb = np.stack([ch, ch, ch], axis=-1)
        else:
            bands = [_to_uint8_channel(arr[..., i]) for i in range(min(3, arr.shape[-1]))]
            while len(bands) < 3:
                bands.append(bands[-1])
            rgb = np.stack(bands[:3], axis=-1)
    else:
        raise ValueError(f"unsupported image array shape for SARMAE detect: {arr.shape}")

    out = OUTPUT_DIR / f"_sarmae_detect_input_{abs(hash(str(image_path)))}.png"
    Image.fromarray(rgb, mode="RGB").save(out)
    return out, True


def _real_detect(image_path: Path, device: str) -> dict[str, Any]:
    """Real SAR rotated detection via mmrotate (deployment GPU box only)."""
    import importlib.util  # noqa: PLC0415
    import sys  # noqa: PLC0415

    config = os.environ.get("SARMAE_DETECT_CONFIG", "")
    repo = os.environ.get("SARMAE_DETECT_REPO", "")
    if repo and repo not in sys.path:
        sys.path.insert(0, repo)

    try:
        from mmcv import Config, imread  # noqa: PLC0415
        from mmdet.apis import inference_detector, init_detector  # noqa: PLC0415
        import mmrotate  # noqa: F401,PLC0415  (registers rotated modules)
    except ImportError as exc:
        raise ModelNotAvailableError(
            MODEL_NAME,
            "real SAR rotated detection needs the mmrotate/mmdet/mmcv stack (not installed here)",
            download_hint="run on the GPU box with the mmrotate env + set SARMAE_DETECT_CONFIG / SARMAE_DETECT_REPO",
        ) from exc

    if not config or not Path(config).exists():
        raise ModelNotAvailableError(MODEL_NAME, "SARMAE_DETECT_CONFIG not set or not found",
                                     download_hint="point SARMAE_DETECT_CONFIG at the SSDD detect config (vitb_ssdd.py)")

    # The local SARMAE_Fintune/Detection copy only contains custom extension
    # files, not a complete installable mmrotate fork. Register the custom ViT
    # backbone explicitly before mmdet builds the model from config.
    vit_timm = Path(repo) / "mmrotate" / "models" / "backbones" / "vit_timm.py" if repo else Path()
    if vit_timm.exists() and "sarmae_detection_vit_timm" not in sys.modules:
        spec = importlib.util.spec_from_file_location("sarmae_detection_vit_timm", vit_timm)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(module)
            except KeyError as exc:
                if "VisionTransformer_timm is already registered" not in str(exc):
                    raise
            sys.modules["sarmae_detection_vit_timm"] = module

    cfg = Config.fromfile(config)
    if "model" in cfg and "backbone" in cfg.model:
        # The checked-in config points at a training-time relative MAE file that
        # is not present in this deployment. The actual fine-tuned detector is
        # loaded from detect_epoch_34.pth below.
        cfg.model.backbone.pretrained = None

    model = init_detector(cfg, str(_DETECT_CKPT), device=device)
    detect_image_path, converted_input = _ensure_mmdet_readable_image(image_path, imread)
    res = inference_detector(model, str(detect_image_path))
    names = getattr(getattr(model, "dataset_meta", None), "get", lambda *_: None)("classes") or getattr(model, "CLASSES", None) or ["ship"]
    dets = []
    if hasattr(res, "pred_instances"):
        inst = res.pred_instances
        bboxes = inst.bboxes.cpu().numpy().tolist()
        scores = inst.scores.cpu().numpy().tolist()
        labels = inst.labels.cpu().numpy().tolist()
        dets = []
        for box, score, label in zip(bboxes, scores, labels):
            if score < 0.3:
                continue
            item = {"class": names[label] if label < len(names) else str(label), "confidence": round(float(score), 3)}
            item["rbox" if len(box) == 5 else "bbox"] = box
            dets.append(item)
    elif isinstance(res, (list, tuple)):
        bbox_result = res[0] if res and isinstance(res[0], list) else res
        for cls_idx, cls_boxes in enumerate(bbox_result):
            for row in cls_boxes:
                vals = row.tolist() if hasattr(row, "tolist") else list(row)
                if len(vals) >= 5 and float(vals[-1]) >= 0.3:
                    coords = vals[:-1]
                    item = {
                        "class": names[cls_idx] if cls_idx < len(names) else str(cls_idx),
                        "confidence": round(float(vals[-1]), 3),
                    }
                    item["rbox" if len(coords) == 5 else "bbox"] = coords
                    dets.append(item)
    from PIL import Image  # noqa: PLC0415

    result = {"image_size": list(Image.open(image_path).size), "detections": dets, "count": len(dets)}
    if converted_input:
        result["input_preprocessed"] = "converted SAR/TIFF input to 8-bit RGB PNG for MMDetection image loading"
    return result

def run(image: str, task: str = "detect") -> dict[str, Any]:
    started = time.monotonic()
    device = pick_device()
    if task not in SARMAE_TASKS:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"unsupported task '{task}', expected one of {SARMAE_TASKS}")

    try:
        image_path = resolve_image(image)
        if not image_path.exists():
            return envelope(model=MODEL_NAME, task=task, ok=False, error=f"image not found: {image_path}")

        # --- REAL segmentation (reconstructed UPerHead, strict-loaded) ---
        if task == "segment" and _SEG_CKPT.exists():
            from . import sarmae_seg  # noqa: PLC0415

            try:
                res = sarmae_seg.segment(_SEG_CKPT, image_path, device)
            except Exception as exc:  # noqa: BLE001 - never crash; degrade to ok:false
                msg = str(exc)
                if device == "cuda" and ("CUDA" in msg or "cuDNN" in msg or "CUDNN" in msg):
                    try:
                        res = sarmae_seg.segment(_SEG_CKPT, image_path, "cpu")
                        res["head_source"] = (
                            f"real fine-tuned UPerHead ({_SEG_CKPT.name}, strict-loaded; "
                            "AIR-PolarSAR-Seg 6 类; cuda failed, retried on cpu)"
                        )
                        out_path = OUTPUT_DIR / f"sarmae_segment_{int(time.time())}.json"
                        out_path.write_text(__import__("json").dumps(res), encoding="utf-8")
                        return envelope(model=MODEL_NAME, task=task, result=res, device="cpu",
                                        weights="SARMAE ViT-B/16 + fine-tuned UPerHead",
                                        started_at=started, output_path=str(out_path))
                    except Exception as cpu_exc:  # noqa: BLE001
                        msg = f"{msg}; CPU retry failed: {cpu_exc}"
                return envelope(model=MODEL_NAME, task=task, ok=False, error=f"SARMAE real-seg failed: {msg}", device=device, started_at=started)
            res["head_source"] = f"real fine-tuned UPerHead ({_SEG_CKPT.name}, strict-loaded; AIR-PolarSAR-Seg 6 类)"
            out_path = OUTPUT_DIR / f"sarmae_segment_{int(time.time())}.json"
            out_path.write_text(__import__("json").dumps(res), encoding="utf-8")
            return envelope(model=MODEL_NAME, task=task, result=res, device=device,
                            weights="SARMAE ViT-B/16 + fine-tuned UPerHead", started_at=started, output_path=str(out_path))

        # --- REAL detection (mmrotate; deployment box). Degrades to k-means on dev ---
        if task == "detect" and _DETECT_CKPT.exists():
            try:
                res = _real_detect(image_path, device)
                res["head_source"] = f"real fine-tuned rotated detector ({_DETECT_CKPT.name}, mmrotate)"
                out_path = OUTPUT_DIR / f"sarmae_detect_{int(time.time())}.json"
                out_path.write_text(__import__("json").dumps(res), encoding="utf-8")
                return envelope(model=MODEL_NAME, task=task, result=res, device=device,
                                weights="SARMAE ViT + fine-tuned rotated detector", started_at=started, output_path=str(out_path))
            except ModelNotAvailableError as exc:
                return envelope(model=MODEL_NAME, task=task, ok=False, error=str(exc), device=device,
                                weights=str(_DETECT_CKPT), started_at=started)
            except Exception as exc:  # noqa: BLE001 - surface real detector setup errors
                detail = traceback.format_exc(limit=4)
                msg = str(exc)
                if "NoneType' object has no attribute 'shape" in msg:
                    return envelope(model=MODEL_NAME, task=task, ok=False,
                                    error=("SARMAE real-detect could not load the image through MMDetection even after "
                                           "SAR/TIFF preprocessing. The input may be corrupt or in an unsupported raster layout."),
                                    device=device, weights=str(_DETECT_CKPT), started_at=started)
                if device == "cuda" and ("cuDNN" in msg or "CUDNN" in msg):
                    try:
                        res = _real_detect(image_path, "cpu")
                        res["head_source"] = (
                            f"real fine-tuned rotated detector ({_DETECT_CKPT.name}, mmrotate; "
                            "cuda cuDNN failed, retried on cpu)"
                        )
                        out_path = OUTPUT_DIR / f"sarmae_detect_{int(time.time())}.json"
                        out_path.write_text(__import__("json").dumps(res), encoding="utf-8")
                        return envelope(model=MODEL_NAME, task=task, result=res, device="cpu",
                                        weights="SARMAE ViT + fine-tuned rotated detector",
                                        started_at=started, output_path=str(out_path))
                    except Exception as cpu_exc:  # noqa: BLE001
                        detail += "\nCPU retry failed:\n" + traceback.format_exc(limit=4)
                        msg = f"{msg}; CPU retry failed: {cpu_exc}"
                return envelope(model=MODEL_NAME, task=task, ok=False,
                                error=f"SARMAE real-detect failed with {_DETECT_CKPT}: {msg}\n{detail}",
                                device=device, weights=str(_DETECT_CKPT), started_at=started)

        # --- FALLBACK: real encoder + unsupervised k-means proxy ---
        model = _load(device)

        import torch  # noqa: PLC0415

        tensor, (w, h) = _preprocess(image_path, device)
        with torch.no_grad():
            feats = model.forward_features(tensor)  # [B, 1+N, D] (cls token + 196 patches for 224/16)
            patch_feats = feats[:, 1:, :].squeeze(0)

        grid = int(round(patch_feats.shape[0] ** 0.5))  # 14x14

        if task == "segment":
            labels = _kmeans_labels(patch_feats.cpu().numpy(), k=4)
            mask = labels.reshape(grid, grid).tolist()
            out_path = OUTPUT_DIR / f"sarmae_segment_{int(time.time())}.json"
            out_path.write_text(__import__("json").dumps({"mask": mask, "grid": grid}), encoding="utf-8")
            result = {"image_size": [w, h], "mask_grid": grid, "mask": mask, "num_classes": int(max(max(r) for r in mask)) + 1, "head_source": "k-means(patch_embeddings) — no fine-tuned SARMAE_Fintune/Segmentation head loaded"}
        else:  # detect
            import numpy as np  # noqa: PLC0415

            labels = _kmeans_labels(patch_feats.cpu().numpy(), k=4)
            counts = np.bincount(labels, minlength=4)
            target_cluster = int(counts.argmin())
            cell = 100.0 / grid
            detections = []
            for idx, lab in enumerate(labels):
                if lab == target_cluster:
                    r, c = divmod(idx, grid)
                    detections.append({
                        "class": "sar_anomalous_region",
                        "bbox": [round(c * cell, 1), round(r * cell, 1), round((c + 1) * cell, 1), round((r + 1) * cell, 1)],
                        "confidence": 0.5,
                    })
            out_path = OUTPUT_DIR / f"sarmae_detect_{int(time.time())}.json"
            out_path.write_text(__import__("json").dumps({"detections": detections}), encoding="utf-8")
            result = {"image_size": [w, h], "detections": detections, "count": len(detections), "head_source": "k-means anomaly proxy — no fine-tuned SARMAE_Fintune/Detection (RSAR/SARDet-100k) head loaded"}

        return envelope(
            model=MODEL_NAME, task=task, result=result,
            device=device, weights=f"{_model_cache['ckpt']} (missing={_model_cache['missing']}, unexpected={_model_cache['unexpected']})",
            started_at=started, output_path=str(out_path),
        )
    except ModelNotAvailableError as exc:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=str(exc), device=device)


if __name__ == "__main__":
    import json
    import sys

    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(run(**payload), ensure_ascii=False))  # noqa: T201
