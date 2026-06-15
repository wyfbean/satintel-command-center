"""SkyEyeGPT backend — RS vision-language (ZhanYang-nwpu/SkyEyeGPT, ISPRS 2025).

Status: **interface-only on this dev machine** — not downloaded/tested.

`https://github.com/ZhanYang-nwpu/SkyEyeGPT` is a MiniGPT-v2 / LLaMA2-7B-based
instruction-tuned VLM. At build time the repo's own README states "Chatbot,
codebase, and model inference tutorial coming soon!" — i.e. there is no
documented inference entrypoint to wrap yet, and the checkpoint ("run directly
with MiniGPT-v2") implies a multi-part download: LLaMA2-7B base weights (~13GB)
+ a SkyEyeGPT delta/LoRA + the MiniGPT-v2 vision encoder + Q-Former projection.
This is squarely a deployment-box job, not a dev-laptop smoke test — per the
slide's conda-env-per-model design, this backend targets a `skyeyegpt` env
running the (forthcoming) MiniGPT-v2-based inference script.

To complete this backend on the deployment GPU box (once SkyEyeGPT publishes
its inference tutorial):
1. `conda create -n skyeyegpt` per SkyEyeGPT/MiniGPT-v2's environment.yml.
2. Download LLaMA2-7B-chat weights (license-gated on HF) + the SkyEyeGPT
   checkpoint from the repo's HF model card, place under `weights/skyeyegpt/`.
3. Implement `_run_minigptv2_inference()` against MiniGPT-v2's
   `Chat`/`Conversation` API (eval_configs/minigptv2_eval.yaml pattern) for
   caption / vqa / dialogue / grounding.
4. `CONDA_ENV_MAP["skyeyegpt"] = "skyeyegpt"` is already set in `common.py`.
"""

from __future__ import annotations

import time
from typing import Any

from ..common import ModelNotAvailableError, WEIGHTS_DIR, envelope, pick_device
from ..schemas import SKYEYEGPT_TASKS

MODEL_NAME = "skyeyegpt"
_REPO = "https://github.com/ZhanYang-nwpu/SkyEyeGPT"


def _weights_present() -> bool:
    ckpt_dir = WEIGHTS_DIR / "skyeyegpt"
    return ckpt_dir.exists() and any(ckpt_dir.iterdir())


def run(image: str, task: str, prompt: str | None = None, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
    started = time.monotonic()
    device = pick_device()
    if task not in SKYEYEGPT_TASKS:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"unsupported task '{task}', expected one of {SKYEYEGPT_TASKS}")
    if task in ("vqa", "dialogue", "grounding") and not prompt:
        return envelope(model=MODEL_NAME, task=task, ok=False, error=f"'prompt' is required for task '{task}'")

    if not _weights_present():
        err = ModelNotAvailableError(
            MODEL_NAME,
            "no weights under weights/skyeyegpt/ (LLaMA2-7B base + SkyEyeGPT checkpoint + MiniGPT-v2 vision encoder)",
            download_hint=f"{_REPO} — README states the inference tutorial is forthcoming; "
            "follow the HF model card for the checkpoint set, place under "
            "backend/model_wrappers/weights/skyeyegpt/, and run via the 'skyeyegpt' conda env",
        )
        return envelope(model=MODEL_NAME, task=task, ok=False, error=str(err), device=device, started_at=started)

    err = ModelNotAvailableError(
        MODEL_NAME,
        "weights present but MiniGPT-v2 inference path not yet implemented "
        f"(no inference tutorial published by {_REPO} at build time)",
    )
    return envelope(model=MODEL_NAME, task=task, ok=False, error=str(err), device=device, started_at=started)


if __name__ == "__main__":
    import json
    import sys

    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(run(**payload), ensure_ascii=False))  # noqa: T201
