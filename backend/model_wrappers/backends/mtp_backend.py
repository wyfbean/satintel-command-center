"""MTP backend — RGB object detection (ViTAE-Transformer/MTP, JSTARS 2024).

Status: **interface-only on this dev machine** — not downloaded/tested.

`https://github.com/ViTAE-Transformer/MTP` ships pretrained detectors as
MMDetection/MMRotate checkpoints (mmdet>=3.1.0, mmrotate>=1.0.0rc1, mmcv 2.0.0,
torch 1.10) — a heavyweight, version-pinned stack that conflicts with this
backend service's torch/CUDA versions (torch 1.10 vs. the modern torch used by
DOFA/SATtxt). This is exactly the kind of dependency split `CONDA_ENV_MAP`
("mtp") exists for: the deployment box should provision a separate `mtp` conda
env with the pinned MMDetection/MMRotate stack, and `run_in_env()` in
`common.py` will shell out to it via `conda run -n mtp`.

To complete this backend on the deployment GPU box:
1. `conda create -n mtp python=3.8 && conda activate mtp`
2. Install torch==1.10 + mmcv==2.0.0 + mmdet==3.1.0 + mmrotate==1.0.0rc1 per
   the MTP repo's `INSTALL.md`.
3. Put the exact detection checkpoint and matching config under
   `/root/autodl-tmp/model_weight/mtp/` or set `MODEL_WRAPPERS_WEIGHTS_DIR`.
4. Implement `_run_mmdet_inference()` below using `mmdet.apis.inference_detector`
   against the downloaded `config.py` + `checkpoint.pth` pair.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import time
from pathlib import Path
from typing import Any

from ..common import MODEL_WEIGHT_ROOT, ModelNotAvailableError, WEIGHTS_DIR, envelope, pick_device
from ..schemas import MTP_TASKS

MODEL_NAME = "mtp"
_REPO = "https://github.com/ViTAE-Transformer/MTP"
_MTP_REPO_DIR = Path(os.environ.get("MTP_REPO_DIR", "/root/autodl-tmp/MTP"))
_HORIZONTAL_TASK_DIR = _MTP_REPO_DIR / "RS_Tasks_Finetune" / "Horizontal_Detection"
_DIOR_CLASSES = (
    "airplane", "airport", "baseballfield", "basketballcourt", "bridge",
    "chimney", "expressway-service-area", "expressway-toll-station",
    "dam", "golffield", "groundtrackfield", "harbor", "overpass", "ship",
    "stadium", "storagetank", "tenniscourt", "trainstation", "vehicle",
    "windmill",
)


def _find_checkpoint_pair() -> tuple[str, str] | None:
    ckpt_dirs = [WEIGHTS_DIR / "mtp", MODEL_WEIGHT_ROOT / "mtp", MODEL_WEIGHT_ROOT]
    cfgs = []
    pths = []
    for ckpt_dir in ckpt_dirs:
        if ckpt_dir.exists():
            cfgs.extend(sorted(ckpt_dir.glob("*.py")))
            pths.extend(sorted(ckpt_dir.glob("*mtp*.pth")) or sorted(ckpt_dir.glob("*.pth")))
    if cfgs and pths:
        return str(cfgs[0]), str(pths[0])
    return None


def run(image: str, task: str = "detect", score_thr: float = 0.3) -> dict[str, Any]:
    started = time.monotonic()
    device = pick_device()
    if task not in MTP_TASKS:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"unsupported task '{task}', expected one of {MTP_TASKS}")

    pair = _find_checkpoint_pair()
    if pair is None:
        err = ModelNotAvailableError(
            MODEL_NAME,
            f"no (config.py, checkpoint.pth) pair found under {WEIGHTS_DIR / 'mtp'} or {MODEL_WEIGHT_ROOT / 'mtp'}",
            download_hint=f"clone {_REPO}, download a checkpoint + matching config from its results "
            "tables (Baidu/OneDrive), place both under /root/autodl-tmp/model_weight/mtp/, "
            "and set up the 'mtp' conda env (mmdet>=3.1.0, mmrotate>=1.0.0rc1, torch==1.10)",
        )
        return envelope(model=MODEL_NAME, task=task, ok=False, error=str(err), device=device, started_at=started)

    cfg, ckpt = pair
    try:
        return _run_mmdet_inference(image, cfg, ckpt, score_thr, device, started)
    except ImportError as exc:
        err = ModelNotAvailableError(
            MODEL_NAME, "mmdet/mmrotate not importable in this environment",
            download_hint="run via the 'mtp' conda env (see module docstring), or install "
            "mmdet>=3.1.0 mmrotate>=1.0.0rc1 mmcv==2.0.0 torch==1.10 in the active env",
        )
        return envelope(model=MODEL_NAME, task=task, ok=False, error=str(err), device=device, weights=ckpt, started_at=started)
    except RuntimeError as exc:
        msg = str(exc)
        if device == "cuda" and ("CUDA" in msg or "cuDNN" in msg or "CUDNN" in msg or "kernel image" in msg):
            try:
                result = _run_mmdet_inference(image, cfg, ckpt, score_thr, "cpu", started)
                result["meta"]["device"] = "cpu"
                result["result"]["runtime_note"] = "cuda failed in the old MTP torch/mmcv stack; retried on cpu"
                return result
            except Exception as cpu_exc:  # noqa: BLE001
                msg = f"{msg}; CPU retry failed: {cpu_exc}"
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"MTP inference failed: {msg}", device=device, weights=ckpt, started_at=started)


def _run_mmdet_inference(image: str, cfg: str, ckpt: str, score_thr: float, device: str, started: float) -> dict[str, Any]:
    _register_horizontal_mtp_modules()

    from mmdet.apis import inference_detector, init_detector  # noqa: PLC0415

    cfg_obj = _load_inference_config(cfg)

    # `palette='random'` avoids mmdet building the config's test dataset just to
    # fetch palette metadata. The shipped config points to the authors' training
    # data path, which is not present on this deployment host.
    model = init_detector(cfg_obj, ckpt, device=device, palette="random")
    model.dataset_meta = {"classes": _DIOR_CLASSES, "palette": "random"}
    result = inference_detector(model, image)

    try:
        from PIL import Image  # noqa: PLC0415

        image_size = list(Image.open(image).size)
    except Exception:  # noqa: BLE001
        image_size = []

    detections = []
    if hasattr(result, "pred_instances"):
        instances = result.pred_instances
        bboxes = instances.bboxes.detach().cpu().tolist()
        scores = instances.scores.detach().cpu().tolist()
        labels = instances.labels.detach().cpu().tolist()
        classes = getattr(model, "dataset_meta", {}).get("classes", [])
        for bbox, score, label in zip(bboxes, scores, labels):
            if score >= score_thr:
                detections.append({
                    "class": classes[label] if label < len(classes) else str(label),
                    "class_id": int(label),
                    "bbox": [round(float(v), 2) for v in bbox],
                    "score": round(float(score), 4),
                })
    else:
        for cls_idx, bboxes in enumerate(result):
            for bbox in bboxes:
                *coords, score = bbox.tolist()
                if score >= score_thr:
                    detections.append({"class_id": cls_idx, "bbox": coords, "score": round(float(score), 4)})

    return envelope(
        model=MODEL_NAME, task="detect",
        result={"image_size": image_size, "detections": detections, "count": len(detections)},
        device=device, weights=ckpt, started_at=started,
    )


def _load_inference_config(cfg: str):
    from mmengine.config import Config  # noqa: PLC0415

    cfg_obj = Config.fromfile(cfg)
    img_size = int(cfg_obj.model.backbone.get("img_size", 800))

    def patch_pipeline(pipeline):
        if not pipeline:
            return
        for step in pipeline:
            if step.get("type") == "Resize":
                step["scale"] = (img_size, img_size)
                step["keep_ratio"] = False

    # The RVSA backbone in the released MTP DIOR config uses absolute position
    # embeddings for img_size=800 (50x50=2500 patch tokens). The original test
    # pipeline keeps aspect ratio, so a non-square upload can become e.g.
    # 800x704 (50x44=2200 tokens) and crash with `tensor a (2200) ... b (2500)`.
    # Force square inference only at runtime; do not mutate the checkpoint config.
    patch_pipeline(cfg_obj.get("test_pipeline"))
    try:
        patch_pipeline(cfg_obj.test_dataloader.dataset.pipeline)
    except AttributeError:
        pass
    return cfg_obj


def _register_horizontal_mtp_modules() -> None:
    """Register MTP's custom RVSA backbone with the installed mmdet registry."""
    if not _HORIZONTAL_TASK_DIR.exists():
        return
    if str(_HORIZONTAL_TASK_DIR) not in sys.path:
        sys.path.insert(0, str(_HORIZONTAL_TASK_DIR))

    backbones_dir = _HORIZONTAL_TASK_DIR / "mmdet" / "models" / "backbones"
    for module_name in ("vit_rvsa_mtp", "vit_rvsa_mtp_branches"):
        module_path = backbones_dir / f"{module_name}.py"
        if not module_path.exists() or f"_mtp_horizontal_{module_name}" in sys.modules:
            continue
        spec = importlib.util.spec_from_file_location(f"_mtp_horizontal_{module_name}", module_path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)


if __name__ == "__main__":
    import json
    import sys

    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(run(**payload), ensure_ascii=False))  # noqa: T201
