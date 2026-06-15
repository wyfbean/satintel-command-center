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

import time
from pathlib import Path
from typing import Any

from huggingface_hub import hf_hub_download

from ..common import ModelNotAvailableError, OUTPUT_DIR, WEIGHTS_DIR, envelope, pick_device, resolve_image
from ..schemas import SARMAE_TASKS

MODEL_NAME = "sarmae"
_HF_REPO = "Wenquandan777/SARMAE"
_HF_FILE = "SARMAE_vitl_checkpoint-last"

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

    ckpt_path = WEIGHTS_DIR / "sarmae" / _HF_FILE
    if not ckpt_path.exists():
        try:
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


def run(image: str, task: str = "detect") -> dict[str, Any]:
    started = time.monotonic()
    device = pick_device()
    if task not in SARMAE_TASKS:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"unsupported task '{task}', expected one of {SARMAE_TASKS}")

    try:
        model = _load(device)
        image_path = resolve_image(image)
        if not image_path.exists():
            return envelope(model=MODEL_NAME, task=task, ok=False, error=f"image not found: {image_path}")

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
