"""MCP/A2A-capable JSON Schemas for the 5 remote-sensing model wrappers.

Each entry is a plain-dict JSON Schema pair (`input`/`output`) consumable by:
- `model_wrappers.mcp_server` (FastMCP tool registration — tool descriptions +
  input validation)
- the Magnetic-One orchestrator's Execution Graph Generator (so the planner can
  reason about which tool accepts which arguments without reading source code)
- any future A2A agent card (`skills[].inputSchema` / `outputSchema`)

Models (per `model_wrappers_模型调用说明.pptx`):
  - skyeyegpt — RS vision-language: captioning / VQA / dialogue / visual grounding
  - sarmae    — SAR representation model: detection / segmentation
  - dofa      — Dynamic One-For-All multispectral foundation model: semantic
                segmentation over 6 GEO-Bench heads
  - sattxt    — zero-shot classification / image-text retrieval (RemoteCLIP-backed)
  - mtp       — Multi-Task Pretraining RGB object detection
"""

from __future__ import annotations

from typing import Any

# Result envelope shared by every wrapper. Concrete `result` shapes are documented
# per-tool below; `ok=False` carries `error` (string) instead of `result`.
RESULT_ENVELOPE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "model": {"type": "string"},
        "task": {"type": "string"},
        "result": {"type": "object"},
        "error": {"type": "string"},
        "meta": {
            "type": "object",
            "properties": {
                "device": {"type": "string"},
                "weights": {"type": "string"},
                "latency_ms": {"type": "number"},
                "output_path": {"type": "string"},
            },
        },
    },
    "required": ["ok", "model", "task"],
}

DOFA_DATASET_HEADS = [
    "m-NeonTree",
    "m-SA-crop-type",
    "m-cashew-plant",
    "m-chesapeake",
    "m-nz-cattle",
    "m-pv4ger-seg",
]

SKYEYEGPT_TASKS = ["caption", "vqa", "dialogue", "grounding"]
SARMAE_TASKS = ["detect", "segment"]
SATTXT_TASKS = ["zero_shot_classify", "image_to_text_retrieval", "text_to_image_retrieval"]
MTP_TASKS = ["detect"]

# --------------------------------------------------------------------------- #
# Per-tool MCP schemas: { name: { description, input, output } }
# --------------------------------------------------------------------------- #

TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "skyeyegpt": {
        "description": (
            "SkyEyeGPT — remote-sensing vision-language model (MiniGPT-v2 / LLaMA2-based). "
            "Supports image captioning, visual question answering, multi-turn dialogue, "
            "and visual grounding (bounding-box localisation from natural-language referring "
            "expressions) over satellite/aerial imagery."
        ),
        "input": {
            "type": "object",
            "properties": {
                "image": {"type": "string", "description": "Path or URL to the input image."},
                "task": {"type": "string", "enum": SKYEYEGPT_TASKS},
                "prompt": {
                    "type": "string",
                    "description": "Question / instruction / referring expression. Required for "
                    "vqa, dialogue and grounding; optional for caption.",
                },
                "history": {
                    "type": "array",
                    "items": {"type": "object", "properties": {"role": {"type": "string"}, "content": {"type": "string"}}},
                    "description": "Prior turns for the 'dialogue' task.",
                },
            },
            "required": ["image", "task"],
        },
        "output": RESULT_ENVELOPE,
    },
    "sarmae": {
        "description": (
            "SARMAE — masked-autoencoder foundation model for SAR (Synthetic Aperture Radar) "
            "imagery. Supports semantic segmentation on SAR/PolSAR scenes with a real "
            "fine-tuned UPerHead (AIR-PolarSAR-Seg, 6 classes: Industrial, Natural, Water, "
            "Land_Use, Housing, Other). Also supports SAR object detection with the real "
            "fine-tuned mmrotate rotated detector checkpoint detect_epoch_34.pth; detection "
            "may fall back to CPU if CUDA/cuDNN is incompatible. If the user asks to use "
            "UPerHead/UPer for segmentation, call this tool with task='segment' directly."
        ),
        "input": {
            "type": "object",
            "properties": {
                "image": {"type": "string", "description": "Path or URL to the input SAR image."},
                "task": {"type": "string", "enum": SARMAE_TASKS},
            },
            "required": ["image", "task"],
        },
        "output": RESULT_ENVELOPE,
    },
    "dofa": {
        "description": (
            "DOFA (Dynamic One-For-All) — wavelength-conditioned multispectral foundation model "
            "(ViT backbone + UPerNet head). Performs semantic segmentation against one of the "
            "6 GEO-Bench dataset heads. Important: ordinary uploaded images are RGB only. "
            "RGB-compatible heads are task-specific: m-NeonTree for tree crowns, m-nz-cattle "
            "for cattle, and m-pv4ger-seg for photovoltaic panels. m-chesapeake needs 4 bands "
            "(Blue/Green/Red/NIR), satisfiable by separate B02/B03/B04/B08 TIFF uploads; "
            "m-SA-crop-type and m-cashew-plant need 12-band Sentinel-2 input. Do not use "
            "m-pv4ger-seg as a generic city/building/road segmentation fallback."
        ),
        "input": {
            "type": "object",
            "properties": {
                "image": {"type": "string", "description": "Path or URL to the input image."},
                "task": {"type": "string", "enum": ["segment"]},
                "dataset_head": {
                    "type": "string",
                    "enum": DOFA_DATASET_HEADS,
                    "description": (
                        "Choose only when the input bands and user task match the head: "
                        "m-NeonTree=RGB tree crown; m-nz-cattle=RGB cattle; "
                        "m-pv4ger-seg=RGB photovoltaic panel; m-chesapeake=4-band land cover "
                        "with B02/B03/B04/B08; m-SA-crop-type/m-cashew-plant=12-band multispectral."
                    ),
                },
                "bands": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "Optional central wavelengths (µm) per input channel; "
                    "defaults to RGB (0.665, 0.56, 0.49).",
                },
            },
            "required": ["image", "task", "dataset_head"],
        },
        "output": RESULT_ENVELOPE,
    },
    "sattxt": {
        "description": (
            "SATtxt — remote-sensing CLIP-family vision-language alignment model (RemoteCLIP "
            "weights). Supports zero-shot scene classification, image-to-text retrieval, and "
            "text-to-image retrieval over a candidate pool."
        ),
        "input": {
            "type": "object",
            "properties": {
                "image": {"type": "string", "description": "Path or URL to the query/candidate image."},
                "text": {
                    "type": ["string", "array"],
                    "description": "Candidate label(s) / caption(s) / text query, depending on task.",
                },
                "task": {"type": "string", "enum": SATTXT_TASKS},
            },
            "required": ["task"],
        },
        "output": RESULT_ENVELOPE,
    },
    "mtp": {
        "description": (
            "MTP (Multi-Task Pretraining, ViTAE-based) — RGB object detection over remote-sensing "
            "scenes (horizontal bounding boxes; DIOR/DOTA-style classes)."
        ),
        "input": {
            "type": "object",
            "properties": {
                "image": {"type": "string", "description": "Path or URL to the input RGB image."},
                "task": {"type": "string", "enum": MTP_TASKS},
                "score_thr": {"type": "number", "default": 0.3},
            },
            "required": ["image", "task"],
        },
        "output": RESULT_ENVELOPE,
    },
}
