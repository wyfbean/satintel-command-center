#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

from model_wrappers import remote_models  # noqa: E402


def main() -> int:
    image = sys.argv[1] if len(sys.argv) > 1 else "/tmp/satintel_smoke.png"
    checks = {
        "dofa": lambda: remote_models.dofa(image=image, task="segment", dataset_head="m-pv4ger-seg"),
        "sarmae_segment": lambda: remote_models.sarmae(image=image, task="segment"),
        "sarmae_detect": lambda: remote_models.sarmae(image=image, task="detect"),
        "sattxt": lambda: remote_models.sattxt(task="zero_shot_classify", image=image, text=["building", "forest", "road"]),
        "mtp": lambda: remote_models.mtp(image=image, task="detect"),
        "skyeyegpt": lambda: remote_models.skyeyegpt(image=image, task="caption", prompt="What is in this image?"),
    }
    for name, fn in checks.items():
        try:
            res = fn()
        except Exception as exc:  # noqa: BLE001
            res = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        print(f"\n== {name} ==")
        print(json.dumps({
            "ok": res.get("ok"),
            "model": res.get("model"),
            "task": res.get("task"),
            "meta": res.get("meta"),
            "error": res.get("error"),
            "result_keys": list((res.get("result") or {}).keys()) if isinstance(res.get("result"), dict) else [],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
