"""Real SARMAE SAR segmentation: ported ViT backbone + reconstructed mmseg UPerHead.

The team's fine-tuned head (`seg_iter_20000.pth`) is a standard mmseg
`EncoderDecoder`: a ViTDet/BEiT-style ViT-B/16 backbone (with built-in fpn1-4
multi-scale pyramid) + `UPerHead` (6 classes, AIR-PolarSAR-Seg). We avoid the
mmseg/mmcv dependency by:

* **backbone** — a faithful port of the repo's `VisionTransformer_timm`
  (`SARMAE_Fintune/.../backbones/vit_timm.py`): class_token=False, run all blocks,
  reshape the final feature, apply fpn1(4x)/fpn2(2x)/fpn3(identity)/fpn4(maxpool).
* **head** — a pure-PyTorch reimplementation of mmseg `UPerHead` matching the
  checkpoint's exact `ConvModule` (`conv`/`bn`) key names; loaded `strict=True`.

Normalization is KNOWN from the seg config (`mean=std=127.5`, i.e. [-1,1],
crop 512, bgr_to_rgb=False) — unlike DOFA, no guessing. Architecture proof =
strict head load; semantic correctness still benefits from a real SAR test image.
"""

from __future__ import annotations

from functools import partial
from pathlib import Path
from typing import Any

_CROP = 512
_PPM_POOL_SCALES = (1, 2, 3, 6)
_CHANNELS = 512

_cache: dict[str, Any] = {}


def _build_backbone(embed_dim: int = 768, depth: int = 12, num_heads: int = 12, img_size: int = _CROP):
    import torch  # noqa: PLC0415
    import torch.nn as nn  # noqa: PLC0415
    from timm.models.vision_transformer import Block, PatchEmbed  # noqa: PLC0415

    norm_layer = partial(nn.LayerNorm, eps=1e-6)

    class Norm2d(nn.Module):
        def __init__(self, dim: int) -> None:
            super().__init__()
            self.ln = nn.LayerNorm(dim, eps=1e-6)

        def forward(self, x):
            return self.ln(x.permute(0, 2, 3, 1)).permute(0, 3, 1, 2).contiguous()

    class SARMAEViT(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.img_size, self.patch_size = img_size, 16
            self.patch_embed = PatchEmbed(img_size=img_size, patch_size=16, in_chans=3, embed_dim=embed_dim)
            self.pos_embed = nn.Parameter(torch.zeros(1, self.patch_embed.num_patches, embed_dim))  # class_token=False
            self.blocks = nn.Sequential(
                *[Block(dim=embed_dim, num_heads=num_heads, mlp_ratio=4, qkv_bias=True, norm_layer=norm_layer) for _ in range(depth)]
            )
            self.fpn1 = nn.Sequential(
                nn.ConvTranspose2d(embed_dim, embed_dim, 2, 2), Norm2d(embed_dim), nn.GELU(),
                nn.ConvTranspose2d(embed_dim, embed_dim, 2, 2),
            )
            self.fpn2 = nn.Sequential(nn.ConvTranspose2d(embed_dim, embed_dim, 2, 2))
            self.fpn3 = nn.Identity()
            self.fpn4 = nn.MaxPool2d(2, 2)

        def forward(self, x):
            b = x.shape[0]
            x = self.patch_embed(x) + self.pos_embed
            x = self.blocks(x)  # self.norm is Identity (global_pool='avg') → skip
            hw = self.img_size // self.patch_size
            xp = x.permute(0, 2, 1).reshape(b, -1, hw, hw)
            return [self.fpn1(xp), self.fpn2(xp), self.fpn3(xp), self.fpn4(xp)]

    return SARMAEViT()


def _build_head(num_classes: int):
    import torch  # noqa: PLC0415
    import torch.nn as nn  # noqa: PLC0415
    import torch.nn.functional as F  # noqa: PLC0415

    C = _CHANNELS

    class ConvModule(nn.Module):  # mmseg ConvModule: conv(bias=False) + bn + relu
        def __init__(self, ci, co, k, pad=0):
            super().__init__()
            self.conv = nn.Conv2d(ci, co, k, padding=pad, bias=False)
            self.bn = nn.BatchNorm2d(co)

        def forward(self, x):
            return F.relu(self.bn(self.conv(x)), inplace=True)

    class UPerHead(nn.Module):
        def __init__(self, in_ch=(768, 768, 768, 768)) -> None:
            super().__init__()
            self.psp_modules = nn.ModuleList(
                [nn.Sequential(nn.AdaptiveAvgPool2d(s), ConvModule(in_ch[-1], C, 1)) for s in _PPM_POOL_SCALES]
            )
            self.bottleneck = ConvModule(in_ch[-1] + len(_PPM_POOL_SCALES) * C, C, 3, pad=1)
            self.lateral_convs = nn.ModuleList([ConvModule(c, C, 1) for c in in_ch[:-1]])
            self.fpn_convs = nn.ModuleList([ConvModule(C, C, 3, pad=1) for _ in in_ch[:-1]])
            self.fpn_bottleneck = ConvModule(len(in_ch) * C, C, 3, pad=1)
            self.dropout = nn.Dropout2d(0.1)
            self.conv_seg = nn.Conv2d(C, num_classes, 1)

        def _psp(self, x):
            outs = [x]
            for ppm in self.psp_modules:
                outs.append(F.interpolate(ppm(x), size=x.shape[2:], mode="bilinear", align_corners=False))
            return self.bottleneck(torch.cat(outs, 1))

        def forward(self, inputs):
            laterals = [self.lateral_convs[i](inputs[i]) for i in range(len(inputs) - 1)] + [self._psp(inputs[-1])]
            n = len(laterals)
            for i in range(n - 1, 0, -1):
                laterals[i - 1] = laterals[i - 1] + F.interpolate(
                    laterals[i], size=laterals[i - 1].shape[2:], mode="bilinear", align_corners=False
                )
            fpn_outs = [self.fpn_convs[i](laterals[i]) for i in range(n - 1)] + [laterals[-1]]
            for i in range(1, n):
                fpn_outs[i] = F.interpolate(fpn_outs[i], size=fpn_outs[0].shape[2:], mode="bilinear", align_corners=False)
            out = self.fpn_bottleneck(torch.cat(fpn_outs, 1))
            return self.conv_seg(self.dropout(out))

    return UPerHead()


def _safe_torch_load(path: Path):
    """Load an mmseg checkpoint without mmengine/mmcv installed: fabricate stub mm*
    modules only for the duration of unpickling (we keep just the tensor state_dict),
    then purge them so real mm imports elsewhere still work."""
    import importlib.abc  # noqa: PLC0415
    import importlib.machinery  # noqa: PLC0415
    import os  # noqa: PLC0415
    import pathlib  # noqa: PLC0415
    import sys  # noqa: PLC0415
    import types  # noqa: PLC0415

    import torch  # noqa: PLC0415

    class _AnyMeta(type):
        def __getattr__(cls, n):
            return _Any

    class _Any(metaclass=_AnyMeta):
        def __init__(self, *a, **k): pass
        def __getattr__(self, n): return _Any
        def __setstate__(self, s): pass
        def __call__(self, *a, **k): return self

    mm = ("mmengine", "mmcv", "mmdet", "mmrotate", "mmseg")

    class _Finder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, name, path=None, target=None):
            return importlib.machinery.ModuleSpec(name, self) if name.split(".")[0] in mm else None

        def create_module(self, spec):
            m = types.ModuleType(spec.name); m.__path__ = []; m.__getattr__ = lambda a: _Any
            return m

        def exec_module(self, module): pass

    finder = _Finder()
    before = set(sys.modules)
    orig_posix = pathlib.PosixPath
    sys.meta_path.insert(0, finder)
    if os.name == "nt":
        pathlib.PosixPath = pathlib.PurePosixPath  # type: ignore[misc]
    try:
        try:
            return torch.load(path, map_location="cpu", weights_only=False)
        except TypeError as exc:
            if "weights_only" not in str(exc):
                raise
            return torch.load(path, map_location="cpu")
    finally:
        pathlib.PosixPath = orig_posix  # type: ignore[misc]
        try:
            sys.meta_path.remove(finder)
        except ValueError:
            pass
        for k in set(sys.modules) - before:  # purge stub mm* modules
            if k.split(".")[0] in mm:
                del sys.modules[k]


def load_seg_model(ckpt: Path, device: str):
    """Build backbone + UPerHead and load the seg checkpoint. Head loads strict=True."""
    key = f"{ckpt}:{device}"
    if key in _cache:
        return _cache[key]
    state = _safe_torch_load(ckpt)
    sd = state["state_dict"] if isinstance(state, dict) and "state_dict" in state else state

    backbone = _build_backbone()
    bb = {k[len("backbone."):]: v for k, v in sd.items() if k.startswith("backbone.")}
    msg = backbone.load_state_dict(bb, strict=False)
    core_missing = [k for k in msg.missing_keys if k.startswith(("patch_embed", "blocks", "pos_embed", "fpn1", "fpn2"))]
    if core_missing:
        raise RuntimeError(f"SARMAE backbone missing core keys: {core_missing[:6]}")

    num_classes = int(sd["decode_head.conv_seg.weight"].shape[0])
    head = _build_head(num_classes)
    hd = {k[len("decode_head."):]: v for k, v in sd.items() if k.startswith("decode_head.")}
    head.load_state_dict(hd, strict=True)  # strict → architecture provably exact

    backbone, head = backbone.to(device).eval(), head.to(device).eval()
    _cache[key] = (backbone, head, num_classes)
    return _cache[key]


def segment(ckpt: Path, image_path: Path, device: str, grid: int = 64) -> dict[str, Any]:
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415
    import torch.nn.functional as F  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    backbone, head, num_classes = load_seg_model(ckpt, device)

    img = Image.open(image_path).convert("RGB").resize((_CROP, _CROP))
    arr = np.asarray(img, dtype="float32")[:, :, ::-1].copy()  # RGB→BGR (config bgr_to_rgb=False)
    x = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
    x = (x - 127.5) / 127.5  # config mean=std=127.5 → [-1, 1]
    x = x.to(device)

    with torch.no_grad():
        feats = backbone(x)
        assert len(feats) == 4 and feats[0].shape[1] == 768, f"unexpected backbone feats {[tuple(f.shape) for f in feats]}"
        logits = head(feats)
        assert logits.shape[1] == num_classes, "class-count mismatch"
        full = F.interpolate(logits, size=(_CROP, _CROP), mode="bilinear", align_corners=False)
        pred = full.argmax(dim=1)[0].cpu().numpy().astype("int64")

    step = max(1, _CROP // grid)
    mask = pred[::step, ::step].tolist()
    classes, counts = np.unique(pred, return_counts=True)
    total = int(pred.size)
    dist = [{"class_id": int(c), "pixels": int(n), "ratio": round(float(n) / total, 4)} for c, n in zip(classes, counts)]
    return {
        "image_size": list(img.size),
        "mask_grid": len(mask),
        "mask": mask,
        "num_classes": num_classes,
        "class_distribution": dist,
        "distinct_classes_predicted": int(len(classes)),
    }
