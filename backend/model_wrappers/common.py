"""Shared plumbing for the model_wrappers package.

- `WEIGHTS_DIR` / `OUTPUT_DIR`: local directories for checkpoints and per-call
  artifacts (segmentation masks, overlays, ...). On AutoDL/GPU hosts, defaults
  point at `/root/autodl-tmp` so model weights never land in the repo volume.
- `envelope(...)`: builds the standard result dict every wrapper returns.
- `ModelNotAvailableError`: raised by a backend when its weights aren't present
  locally — carries a human-readable download hint so the orchestrator / chat
  can surface "model not deployed here yet" instead of crashing.
- `resolve_image(...)`: accepts a local path, `file://`, or `http(s)://` URL and
  returns a local filesystem path (downloading remote images to a temp file).
- `CONDA_ENV_MAP` / `run_in_env(...)`: per-slide "conda environment auto-switching"
  — if a backend's required env differs from the current interpreter's env and
  conda is available, the backend's CLI entrypoint is invoked via
  `conda run -n <env>`, parsing the last stdout line as the JSON result. When
  conda isn't available (e.g. this dev machine), backends fall back to
  in-process execution under whatever environment is active.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable

_PKG_DIR = Path(__file__).resolve().parent
_DATA_DISK = Path("/root/autodl-tmp")
_MODEL_WEIGHT_ROOT = _DATA_DISK / "model_weight"


def _default_model_weight_root() -> Path:
    return _MODEL_WEIGHT_ROOT if _MODEL_WEIGHT_ROOT.exists() else _PKG_DIR / "weights"


MODEL_WEIGHT_ROOT = Path(os.environ.get("MODEL_WEIGHT_ROOT", str(_default_model_weight_root())))


def _default_wrappers_weights_dir() -> Path:
    # The original development-machine copy under /root/autodl-tmp/model_weight
    # keeps wrapper-managed downloads in mw_weights/ and task heads at the root.
    mw_weights = MODEL_WEIGHT_ROOT / "mw_weights"
    return mw_weights if mw_weights.exists() else MODEL_WEIGHT_ROOT


WEIGHTS_DIR = Path(os.environ.get("MODEL_WRAPPERS_WEIGHTS_DIR", str(_default_wrappers_weights_dir())))
OUTPUT_DIR = Path(os.environ.get("MODEL_WRAPPERS_OUTPUT_DIR", str(_DATA_DISK / "model_outputs")))
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class ModelNotAvailableError(RuntimeError):
    """Raised when a backend's weights/deps aren't present in this environment."""

    def __init__(self, model: str, reason: str, *, download_hint: str = ""):
        self.model = model
        self.reason = reason
        self.download_hint = download_hint
        super().__init__(f"{model}: {reason}" + (f" ({download_hint})" if download_hint else ""))


def envelope(
    *,
    model: str,
    task: str,
    ok: bool = True,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    device: str = "cpu",
    weights: str = "",
    started_at: float | None = None,
    output_path: str = "",
) -> dict[str, Any]:
    meta: dict[str, Any] = {"device": device, "weights": weights}
    if started_at is not None:
        meta["latency_ms"] = round((time.monotonic() - started_at) * 1000, 1)
    if output_path:
        meta["output_path"] = output_path
    out: dict[str, Any] = {"ok": ok, "model": model, "task": task, "meta": meta}
    if ok:
        out["result"] = result or {}
    else:
        out["error"] = error or "unknown error"
    return out


def resolve_image(image: str) -> Path:
    """Return a local Path for `image`, downloading http(s)/file URLs or decoding
    `data:` URLs (inline base64, as sent by the /orchestration image-upload UI) to
    a temp file under OUTPUT_DIR."""
    if image.startswith("data:"):
        import base64  # noqa: PLC0415

        header, _, b64data = image.partition(",")
        ext = ".jpg"
        if "image/png" in header:
            ext = ".png"
        elif "image/webp" in header:
            ext = ".webp"
        dest = OUTPUT_DIR / f"_input_{abs(hash(image))}{ext}"
        if not dest.exists():
            dest.write_bytes(base64.b64decode(b64data))
        return dest
    if image.startswith("http://") or image.startswith("https://"):
        dest = OUTPUT_DIR / f"_input_{abs(hash(image))}{Path(image).suffix or '.jpg'}"
        if not dest.exists():
            urllib.request.urlretrieve(image, dest)  # noqa: S310 - explicit user-provided URL
        return dest
    if image.startswith("file://"):
        image = image[len("file://"):]
    return Path(image)


def pick_device() -> str:
    try:
        import torch  # noqa: PLC0415

        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


# --------------------------------------------------------------------------- #
# Conda environment auto-switching (per slide 7)
# --------------------------------------------------------------------------- #

# Maps model name -> conda env name expected to host its (often conflicting)
# dependency stack on the deployment GPU box. On machines without these envs
# (e.g. this dev machine), `run_in_env` transparently falls back to in-process.
CONDA_ENV_MAP: dict[str, str] = {
    "skyeyegpt": os.environ.get("SKYEYEGPT_CONDA_ENV", "/root/autodl-tmp/conda-envs/skyeyegpt"),
    "sarmae": "sarmae",
    "sarmae-seg": os.environ.get("SARMAE_SEG_CONDA_ENV", "/root/autodl-tmp/conda-envs/sarmae-seg"),
    "dofa": "dofa",
    "sattxt": "dofa",  # shares the lightweight open_clip / torchgeo env
    "mtp": "mtp",
}


def _conda_env_exists(env_name: str) -> bool:
    if os.path.isabs(env_name):
        return Path(env_name).exists()
    conda = shutil.which("conda")
    if not conda:
        return False
    try:
        out = subprocess.run([conda, "env", "list", "--json"], capture_output=True, text=True, timeout=15, check=True)
        envs = json.loads(out.stdout).get("envs", [])
        return any(Path(e).name == env_name for e in envs)
    except Exception:  # noqa: BLE001 - best-effort discovery only
        return False


def run_in_env(model: str, module: str, payload: dict[str, Any], in_process: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """Run `module`'s CLI in `CONDA_ENV_MAP[model]` if that env exists; else call `in_process()`.

    `module` is a `python -m`-style module path (e.g. "model_wrappers.backends.mtp_backend")
    whose `__main__` reads a JSON payload from argv[1] and prints the JSON result as its
    LAST stdout line (per the slide's output convention).
    """
    env_name = CONDA_ENV_MAP.get(model)
    conda = shutil.which("conda")
    if env_name and conda and _conda_env_exists(env_name):
        env = os.environ.copy()
        backend_root = str(_PKG_DIR.parent)
        env["PYTHONPATH"] = backend_root + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        proc = subprocess.run(
            [conda, "run", "-p" if os.path.isabs(env_name) else "-n", env_name, "python", "-m", module, json.dumps(payload, ensure_ascii=False)],
            capture_output=True,
            text=True,
            cwd=_PKG_DIR.parent,
            env=env,
            timeout=600,
        )
        lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
        if proc.returncode == 0 and lines:
            try:
                return json.loads(lines[-1])
            except json.JSONDecodeError:
                pass
        return envelope(model=model, task=payload.get("task", ""), ok=False, error=proc.stderr.strip()[-2000:] or "conda run failed")
    return in_process()
