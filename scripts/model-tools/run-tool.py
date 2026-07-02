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

TOOLS = {
    "dofa": remote_models.dofa,
    "sarmae": remote_models.sarmae,
    "sattxt": remote_models.sattxt,
    "mtp": remote_models.mtp,
    "skyeyegpt": remote_models.skyeyegpt,
}


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in TOOLS:
        print("Usage: scripts/model-tools/run-tool.py <dofa|sarmae|sattxt|mtp|skyeyegpt> '<json-args>'", file=sys.stderr)
        print('Example: scripts/model-tools/run-tool.py sarmae \'{"image":"/tmp/a.png","task":"segment"}\'', file=sys.stderr)
        return 2
    tool = sys.argv[1]
    args = json.loads(sys.argv[2])
    result = TOOLS[tool](**args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
