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
3. Download a detection checkpoint (e.g. ViT-L+RVSA on DIOR-R) from the
   Baidu/OneDrive links in the repo's results tables into `weights/mtp/`.
4. Implement `_run_mmdet_inference()` below using `mmdet.apis.inference_detector`
   against the downloaded `config.py` + `checkpoint.pth` pair.
"""

from __future__ import annotations

import time
from typing import Any

from ..common import ModelNotAvailableError, WEIGHTS_DIR, envelope, pick_device
from ..schemas import MTP_TASKS

MODEL_NAME = "mtp"
_REPO = "https://github.com/ViTAE-Transformer/MTP"


def _find_checkpoint_pair() -> tuple[str, str] | None:
    ckpt_dir = WEIGHTS_DIR / "mtp"
    if not ckpt_dir.exists():
        return None
    cfgs = sorted(ckpt_dir.glob("*.py"))
    pths = sorted(ckpt_dir.glob("*.pth"))
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
            "no (config.py, checkpoint.pth) pair found under weights/mtp/",
            download_hint=f"clone {_REPO}, download a checkpoint + matching config from its results "
            "tables (Baidu/OneDrive), place both under backend/model_wrappers/weights/mtp/, "
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


def _run_mmdet_inference(image: str, cfg: str, ckpt: str, score_thr: float, device: str, started: float) -> dict[str, Any]:
    from mmdet.apis import inference_detector, init_detector  # noqa: PLC0415

    model = init_detector(cfg, ckpt, device=device)
    result = inference_detector(model, image)

    detections = []
    for cls_idx, bboxes in enumerate(result):
        for bbox in bboxes:
            *coords, score = bbox.tolist()
            if score >= score_thr:
                detections.append({"class_id": cls_idx, "bbox": coords, "score": round(score, 4)})

    return envelope(
        model=MODEL_NAME, task="detect",
        result={"detections": detections, "count": len(detections)},
        device=device, weights=ckpt, started_at=started,
    )


if __name__ == "__main__":
    import json
    import sys

    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(run(**payload), ensure_ascii=False))  # noqa: T201
