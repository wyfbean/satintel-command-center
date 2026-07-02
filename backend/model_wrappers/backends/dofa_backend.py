"""DOFA (Dynamic One-For-All) backend — real torch.hub inference.

Loads `vit_base_dofa` from `zhu-xlab/DOFA` (https://github.com/zhu-xlab/DOFA),
a wavelength-conditioned ViT encoder for multispectral Earth observation imagery.

Honest scope note: the slide lists 6 GEO-Bench dataset heads (m-NeonTree,
m-SA-crop-type, m-cashew-plant, m-chesapeake, m-nz-cattle, m-pv4ger-seg). The
*fine-tuned UPerNet decoder weights* for those heads are separate per-dataset
checkpoints published alongside the DOFA paper / torchgeo benchmarks and are
NOT bundled with the base encoder. Rather than fabricate per-dataset decoders,
this backend:

1. Always runs the real DOFA encoder (`forward_features`) on the input image —
   genuine pretrained weights, genuine forward pass.
2. Produces a segmentation-style output via k-means clustering of the patch
   embeddings (`N_CLUSTERS` per `dataset_head`), giving a real, runnable,
   testable pipeline end-to-end on a single image.
3. If a fine-tuned head checkpoint for `dataset_head` is later placed at
   `weights/dofa/heads/<dataset_head>.pt`, that head is used instead for a
   true per-dataset class segmentation (loaded lazily, see `_load_head`).

This keeps the wrapper contract (`dofa(image, task="segment", dataset_head=...)`)
stable while being explicit that the "head weight" download step from the slide
is what upgrades step 2 -> true per-dataset segmentation.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from ..common import MODEL_WEIGHT_ROOT, ModelNotAvailableError, OUTPUT_DIR, WEIGHTS_DIR, envelope, pick_device, resolve_image
from ..schemas import DOFA_DATASET_HEADS

MODEL_NAME = "dofa"
_DEFAULT_RGB_WAVELENGTHS = [0.665, 0.56, 0.49]  # µm

def _default_heads_dir() -> Path:
    if any((MODEL_WEIGHT_ROOT / name / "best.pth").exists() for name in DOFA_DATASET_HEADS):
        return MODEL_WEIGHT_ROOT
    return WEIGHTS_DIR / "dofa_heads"


# Fine-tuned UPerLite head checkpoints live at <DOFA_HEADS_DIR>/<dataset_head>/best.pth.
_HEADS_DIR = Path(os.environ.get("DOFA_HEADS_DIR", str(_default_heads_dir())))


def _head_ckpt_path(dataset_head: str) -> Path:
    return _HEADS_DIR / dataset_head / "best.pth"

# Cluster counts roughly matching each GEO-Bench head's class count.
N_CLUSTERS: dict[str, int] = {
    "m-NeonTree": 2,
    "m-SA-crop-type": 7,
    "m-cashew-plant": 6,
    "m-chesapeake": 7,
    "m-nz-cattle": 2,
    "m-pv4ger-seg": 2,
}

_HEAD_DEFAULT_WAVELENGTHS: dict[str, list[float]] = {
    "m-chesapeake": [0.49, 0.56, 0.665, 0.842],
    "m-SA-crop-type": [0.443, 0.49, 0.56, 0.665, 0.705, 0.74, 0.783, 0.842, 0.865, 0.945, 1.61, 2.19],
    "m-cashew-plant": [0.443, 0.49, 0.56, 0.665, 0.705, 0.74, 0.783, 0.842, 0.865, 0.945, 1.61, 2.19],
}

_HEAD_DEFAULT_BAND_NAMES: dict[str, list[str]] = {
    "m-chesapeake": ["Blue", "Green", "Red", "NIR"],
    "m-SA-crop-type": ["Coastal", "Blue", "Green", "Red", "RedEdge1", "RedEdge2", "RedEdge3", "NIR", "NarrowNIR", "WaterVapor", "SWIR1", "SWIR2"],
    "m-cashew-plant": ["Coastal", "Blue", "Green", "Red", "RedEdge1", "RedEdge2", "RedEdge3", "NIR", "NarrowNIR", "WaterVapor", "SWIR1", "SWIR2"],
}

_model_cache: dict[str, Any] = {}


def _load_encoder(device: str):
    if "encoder" in _model_cache:
        return _model_cache["encoder"]
    try:
        import torch  # noqa: PLC0415
    except ImportError as exc:
        raise ModelNotAvailableError(
            MODEL_NAME, "torch is not installed",
            download_hint="pip install torch torchvision",
        ) from exc

    try:
        torch.hub.set_dir(str(WEIGHTS_DIR / "torch_hub"))
        model = torch.hub.load("zhu-xlab/DOFA", "vit_base_dofa", pretrained=True, trust_repo=True)
    except Exception as exc:  # noqa: BLE001
        raise ModelNotAvailableError(
            MODEL_NAME,
            "failed to load zhu-xlab/DOFA vit_base_dofa via torch.hub (no network or weights cache)",
            download_hint="run `python -m model_wrappers.backends.dofa_backend --warm` with network access "
            "to populate weights/torch_hub/, or place a cached checkpoint at "
            "weights/dofa/vit_base_dofa.pth",
        ) from exc

    model = model.to(device).eval()
    _model_cache["encoder"] = model
    return model


def _load_head(dataset_head: str, device: str):
    head_path = WEIGHTS_DIR / "dofa" / "heads" / f"{dataset_head}.pt"
    if not head_path.exists():
        return None
    import torch  # noqa: PLC0415

    head = torch.load(head_path, map_location=device)
    return head.to(device).eval() if hasattr(head, "to") else head


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


def _patch_tokens(model, x, wave_list):
    """Reproduce `OFAViT.forward_features` up to the transformer blocks, returning the
    full [B, 1+N, D] token sequence (cls token + patch tokens) instead of its pooled output."""
    import torch  # noqa: PLC0415

    wavelist = torch.tensor(wave_list, device=x.device).float()
    model.waves = wavelist
    x, _ = model.patch_embed(x, model.waves)
    x = x + model.pos_embed[:, 1:, :]
    cls_token = model.cls_token + model.pos_embed[:, :1, :]
    cls_tokens = cls_token.expand(x.shape[0], -1, -1)
    x = torch.cat((cls_tokens, x), dim=1)
    for block in model.blocks:
        x = block(x)
    return x


def run(image: str, task: str = "segment", dataset_head: str = "m-chesapeake", bands: list[float] | None = None) -> dict[str, Any]:
    started = time.monotonic()
    if task != "segment":
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"unsupported task '{task}', only 'segment' is implemented")
    if dataset_head not in DOFA_DATASET_HEADS:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"unknown dataset_head '{dataset_head}', expected one of {DOFA_DATASET_HEADS}")

    device = pick_device()
    try:
        image_path = resolve_image(image)
        if not image_path.exists():
            return envelope(model=MODEL_NAME, task=task, ok=False, error=f"image not found: {image_path}")

        # --- REAL fine-tuned head path (reconstructed UPerLite, strict-loaded) ---
        head_ckpt = _head_ckpt_path(dataset_head)
        if head_ckpt.exists():
            from . import dofa_seg  # noqa: PLC0415

            try:
                encoder = dofa_seg.load_encoder(WEIGHTS_DIR, device)
                head, cfg = dofa_seg.load_head(head_ckpt, device)
                cfg.setdefault("dataset", dataset_head)
                cfg.setdefault("wavelengths", bands or _HEAD_DEFAULT_WAVELENGTHS.get(dataset_head))
                cfg.setdefault("band_names", _HEAD_DEFAULT_BAND_NAMES.get(dataset_head))
                res = dofa_seg.segment(encoder, head, image_path, cfg, device)
            except Exception as exc:  # noqa: BLE001 - any head/preproc failure → ok:false envelope, never crash
                return envelope(model=MODEL_NAME, task=task, ok=False, error=f"DOFA real-head failed: {exc}", device=device, started_at=started)
            res["dataset_head"] = dataset_head
            res["head_source"] = (
                f"real fine-tuned UPerLite head ({head_ckpt.name}, strict-loaded); "
                "normalization approximate — place band_stats.json for exact"
            )
            out_path = OUTPUT_DIR / f"dofa_{dataset_head}_{int(time.time())}.json"
            out_path.write_text(__import__("json").dumps(res), encoding="utf-8")
            return envelope(
                model=MODEL_NAME, task=task, result=res, device=device,
                weights="DOFA ViT-B/16 + fine-tuned UPerLite head", started_at=started, output_path=str(out_path),
            )

        # --- FALLBACK: real encoder + unsupervised k-means (no fine-tuned head present) ---
        model = _load_encoder(device)

        import torch  # noqa: PLC0415

        tensor, (w, h) = _preprocess(image_path, device)
        wave_list = bands or _DEFAULT_RGB_WAVELENGTHS

        with torch.no_grad():
            # model.forward_features pools to [B, D] (cls token or global-mean), discarding
            # per-patch tokens needed for segmentation — replicate its body up to (but not
            # including) that pooling step to recover the [B, 1+N, D] sequence.
            patch_feats = _patch_tokens(model, tensor, wave_list)[:, 1:, :].squeeze(0)  # [N, D]

        head = _load_head(dataset_head, device)
        if head is not None:
            with torch.no_grad():
                logits = head(patch_feats)
                labels = logits.argmax(dim=-1).cpu().numpy()
            head_used = f"weights/dofa/heads/{dataset_head}.pt"
        else:
            labels = _kmeans_labels(patch_feats.cpu().numpy(), N_CLUSTERS.get(dataset_head, 4))
            head_used = "k-means(patch_embeddings) — no fine-tuned head downloaded for this dataset_head"

        grid = int(round(len(labels) ** 0.5))  # 14x14 for 224/16
        mask = labels.reshape(grid, grid).tolist()

        out_path = OUTPUT_DIR / f"dofa_{dataset_head}_{int(time.time())}.json"
        out_path.write_text(__import__("json").dumps({"mask": mask, "grid": grid}), encoding="utf-8")

        return envelope(
            model=MODEL_NAME,
            task=task,
            result={
                "dataset_head": dataset_head,
                "image_size": [w, h],
                "mask_grid": grid,
                "mask": mask,
                "num_classes": int(max(max(row) for row in mask)) + 1,
                "head_source": head_used,
            },
            device=device,
            weights="zhu-xlab/DOFA vit_base_dofa (torch.hub)",
            started_at=started,
            output_path=str(out_path),
        )
    except ModelNotAvailableError as exc:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=str(exc), device=device)


def _kmeans_labels(feats, k: int):
    """Tiny dependency-free k-means (numpy only) for the unsupervised fallback head."""
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


if __name__ == "__main__":
    import json
    import sys

    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(run(**payload), ensure_ascii=False))  # noqa: T201 - last line is the JSON contract
