"""Public entrypoints: `skyeyegpt`, `sarmae`, `dofa`, `sattxt`, `mtp`.

Mirrors the slide spec's `from model_wrappers import skyeyegpt, sarmae, dofa,
sattxt` (+ `mtp`). Each function:

- accepts the arguments documented in `model_wrappers.schemas.TOOL_SCHEMAS`,
- returns a plain Python dict following the `RESULT_ENVELOPE` shape
  (`{ok, model, task, result|error, meta}`),
- is routed through `common.run_in_env`, so it executes in-process unless the
  deployment box has provisioned the model's dedicated conda env (see
  `common.CONDA_ENV_MAP`), in which case it shells out to
  `python -m model_wrappers.backends.<model>_backend` and parses the last
  stdout line as JSON (the slide's documented output convention).
"""

from __future__ import annotations

from typing import Any

from .backends import dofa_backend, mtp_backend, sarmae_backend, sattxt_backend, skyeyegpt_backend
from .common import run_in_env


def skyeyegpt(image: str, task: str, prompt: str | None = None, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
    payload = {"image": image, "task": task, "prompt": prompt, "history": history}
    return run_in_env("skyeyegpt", "model_wrappers.backends.skyeyegpt_backend", payload, lambda: skyeyegpt_backend.run(**payload))


def sarmae(image: str, task: str = "detect") -> dict[str, Any]:
    payload = {"image": image, "task": task}
    env_key = "sarmae-seg" if task == "segment" else "sarmae"
    return run_in_env(env_key, "model_wrappers.backends.sarmae_backend", payload, lambda: sarmae_backend.run(**payload))


def dofa(image: str, task: str = "segment", dataset_head: str = "m-chesapeake", bands: list[float] | None = None) -> dict[str, Any]:
    payload = {"image": image, "task": task, "dataset_head": dataset_head, "bands": bands}
    return run_in_env("dofa", "model_wrappers.backends.dofa_backend", payload, lambda: dofa_backend.run(**payload))


def sattxt(task: str, image: str | None = None, text: str | list[str] | None = None) -> dict[str, Any]:
    payload = {"task": task, "image": image, "text": text}
    return run_in_env("sattxt", "model_wrappers.backends.sattxt_backend", payload, lambda: sattxt_backend.run(**payload))


def mtp(image: str, task: str = "detect", score_thr: float = 0.3) -> dict[str, Any]:
    payload = {"image": image, "task": task, "score_thr": score_thr}
    return run_in_env("mtp", "model_wrappers.backends.mtp_backend", payload, lambda: mtp_backend.run(**payload))
