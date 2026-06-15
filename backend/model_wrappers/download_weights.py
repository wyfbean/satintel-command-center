"""Download the locally-runnable model weights (DOFA encoder, RemoteCLIP/SATtxt, SARMAE ViT-L).

Usage: `uv run python -m model_wrappers.download_weights [dofa|sattxt|sarmae|all]`

MTP / SkyEyeGPT are NOT handled here — see the docstrings in
`backends/mtp_backend.py`, `backends/skyeyegpt_backend.py` for why (multi-GB
license-gated LLM weights / version-pinned MMDetection stack), and follow their
documented manual steps on the deployment GPU box.
"""

from __future__ import annotations

import sys

from .common import WEIGHTS_DIR


def fetch_dofa() -> None:
    import torch  # noqa: PLC0415

    torch.hub.set_dir(str(WEIGHTS_DIR / "torch_hub"))
    print("[dofa] downloading vit_base_dofa via torch.hub ...")
    torch.hub.load("zhu-xlab/DOFA", "vit_base_dofa", pretrained=True, trust_repo=True)
    print("[dofa] done ->", WEIGHTS_DIR / "torch_hub")


def fetch_sattxt() -> None:
    from huggingface_hub import hf_hub_download  # noqa: PLC0415

    dest = WEIGHTS_DIR / "sattxt"
    dest.mkdir(parents=True, exist_ok=True)
    print("[sattxt] downloading RemoteCLIP-ViT-B-32.pt from chendelong/RemoteCLIP ...")
    path = hf_hub_download(repo_id="chendelong/RemoteCLIP", filename="RemoteCLIP-ViT-B-32.pt", local_dir=str(dest))
    print("[sattxt] done ->", path)


def fetch_sarmae() -> None:
    from huggingface_hub import hf_hub_download  # noqa: PLC0415

    dest = WEIGHTS_DIR / "sarmae"
    dest.mkdir(parents=True, exist_ok=True)
    print("[sarmae] downloading SARMAE_vitl_checkpoint-last from Wenquandan777/SARMAE ...")
    path = hf_hub_download(repo_id="Wenquandan777/SARMAE", filename="SARMAE_vitl_checkpoint-last", local_dir=str(dest))
    print("[sarmae] done ->", path)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "all"
    if target in ("dofa", "all"):
        fetch_dofa()
    if target in ("sattxt", "all"):
        fetch_sattxt()
    if target in ("sarmae", "all"):
        fetch_sarmae()
