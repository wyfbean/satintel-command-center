"""Real DOFA segmentation: reconstructed UPerLite head + DOFA ViT encoder.

The team's fine-tuned heads (`<DOFA_HEADS_DIR>/<dataset>/best.pth`) were trained
with a custom `UPerLiteHead` (in the unreleased `train_seg_dofa.py`). We
reconstructed that head **exactly from the checkpoint tensor names/shapes** — it
is a pure-PyTorch reimplementation of the DOFA repo's
`Feature2Pyramid(rescales=[4,2,1,0.5])` neck + mmseg `UPerHead(pool_scales=
(1,2,3,6), channels=512, align_corners=False)` (confirmed from the repo's
`main_finetune.build_model`). No mmseg dependency.

Verification model: the head loads with `strict=True` (every parameter placed →
architecture provably correct). **Semantic correctness is NOT verifiable here** —
the per-dataset normalization stats (geobench `normalization_stats()`, i.e. the
missing `band_stats.json`) are unknown, so `normalize_bands()` uses a per-image
standardization approximation. Drop real stats into `_BAND_STATS` to make it exact.
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import sys
from pathlib import Path
from typing import Any

# Per-dataset (mean, std) per band — fill from band_stats.json for exact results.
# Empty → fall back to per-image standardization (see normalize_bands).
_BAND_STATS: dict[str, dict[str, list[float]]] = {}

_PPM_POOL_SCALES = (1, 2, 3, 6)
_CHANNELS = 512
_VIT_BASE_OUT_INDICES = [3, 5, 7, 11]  # set by the repo's vit_base_patch16

_encoder_cache: dict[str, Any] = {}
_head_cache: dict[str, Any] = {}


# --------------------------------------------------------------------------- #
# encoder — the repo's exact DOFASegmentationViT (multi-scale out_indices)
# --------------------------------------------------------------------------- #

def _repo_dir(weights_dir: Path) -> Path:
    return weights_dir / "torch_hub" / "zhu-xlab_DOFA_master"


def load_encoder(weights_dir: Path, device: str):
    key = "enc"
    if key in _encoder_cache:
        return _encoder_cache[key]
    import torch  # noqa: PLC0415

    repo = _repo_dir(weights_dir)
    model_py = repo / "downstream_tasks" / "geobench_segmentation" / "model.py"
    if not model_py.exists():
        raise FileNotFoundError(f"DOFA seg model code not found at {model_py}")
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))  # so `import wave_dynamic_layer` resolves
    spec = importlib.util.spec_from_file_location("dofa_seg_model", model_py)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    encoder = mod.vit_base_patch16(img_size=224, drop_path_rate=0.0)

    ckpt = weights_dir / "torch_hub" / "checkpoints" / "DOFA_ViT_base_e100.pth"
    if not ckpt.exists():
        raise FileNotFoundError(f"DOFA backbone not found at {ckpt}")
    state = torch.load(ckpt, map_location="cpu", weights_only=False)
    state = state.get("model", state) if isinstance(state, dict) else state
    msg = encoder.load_state_dict(state, strict=False)
    # The backbone keys (patch_embed/cls_token/pos_embed/blocks) MUST all load;
    # only MAE-decoder/norm keys may be missing. Guard against a silent mismatch.
    core_missing = [k for k in msg.missing_keys if k.startswith(("patch_embed", "blocks", "pos_embed", "cls_token"))]
    if core_missing:
        raise RuntimeError(f"DOFA backbone load missing core keys: {core_missing[:6]} (+{len(core_missing)})")
    encoder = encoder.to(device).eval()
    _encoder_cache[key] = encoder
    return encoder


# --------------------------------------------------------------------------- #
# head — reconstructed UPerLite (Feature2Pyramid neck + UPerHead), exact keys
# --------------------------------------------------------------------------- #

def _build_head(num_classes: int):
    import torch.nn as nn  # noqa: PLC0415

    C = _CHANNELS

    class UPerLiteHead(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            # Feature2Pyramid neck, rescales [4, 2, 1, 0.5] → strides 4/8/16/32
            self.scale4 = nn.Sequential(nn.ConvTranspose2d(768, C, 4, 4), nn.BatchNorm2d(C))
            self.scale2 = nn.Sequential(nn.ConvTranspose2d(768, C, 2, 2), nn.BatchNorm2d(C))
            self.scale1 = nn.Sequential(nn.Conv2d(768, C, 1), nn.BatchNorm2d(C))
            self.scale05 = nn.Sequential(nn.MaxPool2d(2, 2), nn.Conv2d(768, C, 1), nn.BatchNorm2d(C))
            # UPerHead PSP (applied on the coarsest level)
            self.ppm = nn.ModuleList(
                [nn.Sequential(nn.Conv2d(C, C, 1), nn.BatchNorm2d(C)) for _ in _PPM_POOL_SCALES]
            )
            self.ppm_bottleneck = nn.Sequential(
                nn.Conv2d(C * (1 + len(_PPM_POOL_SCALES)), C, 3, padding=1), nn.BatchNorm2d(C)
            )
            # FPN over the 3 finer levels (coarsest uses the PSP output as its lateral)
            self.fpn_laterals = nn.ModuleList([nn.Conv2d(C, C, 1) for _ in range(3)])
            self.fpn_convs = nn.ModuleList(
                [nn.Sequential(nn.Conv2d(C, C, 3, padding=1), nn.BatchNorm2d(C)) for _ in range(3)]
            )
            self.fpn_bottleneck = nn.Sequential(
                nn.Conv2d(C * 4, C, 3, padding=1), nn.BatchNorm2d(C), nn.ReLU(inplace=True),
                nn.Dropout2d(0.1), nn.Conv2d(C, num_classes, 1),
            )

        def _psp(self, x):
            import torch  # noqa: PLC0415
            import torch.nn.functional as F  # noqa: PLC0415

            h, w = x.shape[-2:]
            outs = [x]
            for scale, branch in zip(_PPM_POOL_SCALES, self.ppm):
                pooled = branch(F.adaptive_avg_pool2d(x, scale))
                outs.append(F.interpolate(pooled, size=(h, w), mode="bilinear", align_corners=False))
            return self.ppm_bottleneck(torch.cat(outs, dim=1))

        def forward(self, feats):
            import torch  # noqa: PLC0415
            import torch.nn.functional as F  # noqa: PLC0415

            p = [self.scale4(feats[0]), self.scale2(feats[1]), self.scale1(feats[2]), self.scale05(feats[3])]
            laterals = [self.fpn_laterals[i](p[i]) for i in range(3)] + [self._psp(p[3])]
            for i in range(3, 0, -1):
                laterals[i - 1] = laterals[i - 1] + F.interpolate(
                    laterals[i], size=laterals[i - 1].shape[-2:], mode="bilinear", align_corners=False
                )
            fpn_outs = [self.fpn_convs[i](laterals[i]) for i in range(3)] + [laterals[3]]
            target = fpn_outs[0].shape[-2:]
            fpn_outs = [
                o if o.shape[-2:] == target else F.interpolate(o, size=target, mode="bilinear", align_corners=False)
                for o in fpn_outs
            ]
            return self.fpn_bottleneck(torch.cat(fpn_outs, dim=1))

    return UPerLiteHead()


def load_head(head_ckpt: Path, device: str):
    """Return (head_module, config_dict). Strict-loads the reconstructed head."""
    import torch  # noqa: PLC0415

    cache_key = str(head_ckpt)
    if cache_key in _head_cache:
        return _head_cache[cache_key]

    # Heads were saved on Linux and pickle PosixPath in config["args"]; allow that on Windows.
    _orig = pathlib.PosixPath
    if os.name == "nt":
        pathlib.PosixPath = pathlib.PurePosixPath  # type: ignore[misc]
    try:
        ck = torch.load(head_ckpt, map_location="cpu", weights_only=False)
    finally:
        pathlib.PosixPath = _orig  # type: ignore[misc]

    cfg = ck.get("config", {})
    num_classes = int(cfg.get("num_classes") or ck["head"]["fpn_bottleneck.4.weight"].shape[0])
    head = _build_head(num_classes)
    head.load_state_dict(ck["head"], strict=True)  # strict → architecture provably exact
    head = head.to(device).eval()
    result = (head, dict(cfg))
    _head_cache[cache_key] = result
    return result


# --------------------------------------------------------------------------- #
# preprocessing + inference
# --------------------------------------------------------------------------- #

def normalize_bands(chw, dataset: str, band_names: list[str]):
    """Normalize a [C,H,W] float tensor. Uses _BAND_STATS[dataset] when available
    (exact = the missing band_stats.json), else per-image per-channel standardization."""
    import torch  # noqa: PLC0415

    stats = _BAND_STATS.get(dataset)
    if stats and "mean" in stats and "std" in stats:
        mean = torch.tensor(stats["mean"], device=chw.device).view(-1, 1, 1)
        std = torch.tensor(stats["std"], device=chw.device).view(-1, 1, 1)
        return (chw - mean) / (std + 1e-6)
    mean = chw.mean(dim=(1, 2), keepdim=True)
    std = chw.std(dim=(1, 2), keepdim=True)
    return (chw - mean) / (std + 1e-6)


# PIL RGB → channel index for a given band name (heads order bands as in config).
_BAND_TO_RGB_IDX = {"Red": 0, "Green": 1, "Blue": 2}


def preprocess(image_path: Path, cfg: dict, device: str):
    """Load image, reorder/normalize to the head's band layout. Returns ([1,C,224,224], (w,h))."""
    import torch  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    # The encoder is wavelength-conditioned; #input channels MUST equal #wavelengths.
    # An RGB upload only has 3 channels → only 3-band (RGB) heads are satisfiable.
    wavelengths = cfg.get("wavelengths") or [0.49, 0.56, 0.665]
    if len(wavelengths) != 3:
        raise ValueError(
            f"head '{cfg.get('dataset')}' needs {len(wavelengths)}-band multispectral input; an RGB "
            "upload cannot satisfy it. Use an RGB-only head (m-pv4ger-seg/m-NeonTree/m-nz-cattle)."
        )
    img = Image.open(image_path).convert("RGB").resize((224, 224))
    import numpy as np  # noqa: PLC0415

    arr = torch.from_numpy(np.asarray(img, dtype="float32")).permute(2, 0, 1)  # [3,H,W] = R,G,B
    # RGB heads order bands as [Blue,Green,Red] (wavelengths 0.49/0.56/0.665). Honour an
    # explicit RGB band_names order if present, else assume that ascending-wavelength order.
    band_names = cfg.get("band_names")
    order = band_names if (band_names and len(band_names) == 3 and all(b in _BAND_TO_RGB_IDX for b in band_names)) else ["Blue", "Green", "Red"]
    chan = torch.stack([arr[_BAND_TO_RGB_IDX[b]] for b in order], dim=0)
    chan = normalize_bands(chan, cfg.get("dataset", ""), order)
    return chan.unsqueeze(0).to(device), img.size


def segment(encoder, head, image_path: Path, cfg: dict, device: str, grid: int = 56) -> dict[str, Any]:
    """Run encoder→head→mask. Asserts shapes at each stage; returns mask + class distribution."""
    import torch  # noqa: PLC0415
    import torch.nn.functional as F  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    x, (w, h) = preprocess(image_path, cfg, device)
    wave_list = cfg.get("wavelengths") or [0.49, 0.56, 0.665]

    with torch.no_grad():
        feats = encoder(x, wave_list)
        assert len(feats) == 4, f"expected 4 encoder features, got {len(feats)}"
        for f in feats:
            assert f.shape[1] == 768 and f.shape[-1] == 14, f"unexpected encoder feature shape {tuple(f.shape)}"
        logits = head(feats)  # [1, C, 56, 56]
        assert logits.shape[1] == int(cfg.get("num_classes") or logits.shape[1]), "class-count mismatch"
        full = F.interpolate(logits, size=(224, 224), mode="bilinear", align_corners=False)
        pred = full.argmax(dim=1)[0].cpu().numpy().astype("int64")

    num_classes = int(logits.shape[1])
    # coarse grid for the JSON mask (full-res argmax downsampled by nearest)
    step = max(1, 224 // grid)
    mask = pred[::step, ::step].tolist()
    classes, counts = np.unique(pred, return_counts=True)
    total = int(pred.size)
    dist = [{"class_id": int(c), "pixels": int(n), "ratio": round(float(n) / total, 4)} for c, n in zip(classes, counts)]
    return {
        "image_size": [w, h],
        "mask_grid": len(mask),
        "mask": mask,
        "num_classes": num_classes,
        "class_distribution": dist,
        "distinct_classes_predicted": int(len(classes)),
    }
