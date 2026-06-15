# `model_wrappers` + Magnetic-One orchestrator

A second AG-UI pipeline that exposes 5 remote-sensing model wrappers
(`skyeyegpt`, `sarmae`, `dofa`, `sattxt`, `mtp`) as MCP tools and drives them
through a **Magnetic-One-style** multi-agent loop, bridged into `/orchestration`
as a second selectable agent. Because both pipelines already speak AG-UI, they
are served from the **same backend process** by default — the CrewAI crew at
`/agent` and the orchestrator at `/orchestrator/agent` (one `uvicorn`, one port).

## Topology

```
/orchestration (CopilotChat, agent switcher)
   ├─ "卫星智能体分析" -> satelliteAnalyst     -> backend/app.py  POST /agent
   └─ "模型编排 Magnetic-One" -> magneticOrchestrator -> backend/app.py  POST /orchestrator/agent
            │  AG-UI over HTTP  (same process, port 8000 by default)
            orchestrator/agui_bridge.run_agent_stream
            │  emit(kind, payload) from a worker thread
            orchestrator/magnetic.run_magnetic
            │
            ├─ mock  (no OPENAI_API_KEY): deterministic 5-stage script;
            │         Agent Executor calls REAL model_wrappers.dofa / .sattxt
            │         when an image is attached.
            └─ real  (OPENAI_API_KEY set): each stage = one-shot CrewAI Crew
                      (orchestrator/agents.py); Agent Executor gets MCP tools
                      from model_wrappers/mcp_server.py via MCPServerAdapter.
```

`backend/app.py` mounts the orchestrator's `run_agent_stream` under
`/orchestrator/*` alongside the crew. `backend/orchestrator/app.py` stays as a
standalone app for prod deployments that want the (heavy) model_wrappers on a
separate GPU host — run it on its own port and set `ORCHESTRATOR_BACKEND_URL`.

`src/app/api/agent/health/route.ts` proxies `GET /health` for both pipelines;
`?backend=orchestrator` checks `/orchestrator/health` (same host by default).

## The 5-stage Magnetic-One loop (`backend/orchestrator/magnetic.py`)

Per the slide diagram, each "Task" is one agent. `MAX_ITERATIONS = 2`; the
Verify Agent's feedback feeds back into the Task Planner for the next round.

1. **Task Planner** — Task Ledger JSON `{facts, plan, feedback_applied}`.
2. **Execution Graph Generator** — `{nodes: [{id, tool, args}], edges}` where
   `tool ∈ {skyeyegpt, sarmae, dofa, sattxt, mtp}`.
3. **Agent Executor** — calls each node's `model_wrappers` tool, collects the
   real result envelopes.
4. **Integration Agent** — Chinese research report synthesizing the results.
5. **Verify Agent** — `{pass, feedback}`; on `pass=false`, loop with feedback.

## `model_wrappers` package (`backend/model_wrappers/`)

Every function returns the same envelope (`schemas.RESULT_ENVELOPE`):

```json
{"ok": true, "model": "dofa", "task": "segment",
 "result": {...}, "error": null,
 "meta": {"device": "cuda|cpu", "weights": "...", "latency_ms": 123, "output_path": "..."}}
```

| Tool | Status | Implementation |
|---|---|---|
| `dofa(image, task="segment", dataset_head, bands)` | **Real** | `torch.hub` `zhu-xlab/DOFA` `vit_base_dofa` encoder + numpy k-means over patch embeddings. `dataset_head` selects cluster count from `schemas.DOFA_DATASET_HEADS` (no fine-tuned GEO-Bench head bundled — honest unsupervised fallback). |
| `sattxt(task, image, text)` | **Real** | RemoteCLIP (`open_clip` ViT-B/32 + `chendelong/RemoteCLIP` weights) — substitutes for SATtxt, which has no public weights. Zero-shot classify / image↔text retrieval. |
| `sarmae(image, task="detect"|"segment")` | **Real (pretrain encoder)** | ViT-L/16 (`timm.create_model("vit_large_patch16_224")`) loaded with `SARMAE_vitl_checkpoint-last` from `Wenquandan777/SARMAE` (CC-BY-NC-4.0), `strict=False` (pretrain checkpoint has decoder/mask-token keys not present in a plain ViT). `forward_features` → patch embeddings → k-means. `segment` → per-patch cluster mask; `detect` → smallest-cluster patches reported as "SAR anomalous region" boxes. The repo's fine-tuned RSAR/SARDet-100k/AIRSEG heads (MMRotate/MMSeg) are **not** bundled. |
| `mtp(image, task="detect", score_thr)` | Interface-only stub | Needs a `(config.py, checkpoint.pth)` pair under `weights/mtp/` + MMDetection 3.1.0/MMRotate 1.0.0rc1/MMCV 2.0.0/torch 1.10 (separate conda env). Raises `ModelNotAvailableError` with setup hint until provided. |
| `skyeyegpt(image, task, prompt, history)` | Interface-only stub | MiniGPT-v2/LLaMA2-7B based; upstream repo has no published inference API yet. Raises `ModelNotAvailableError`. |

Each wrapper is dispatched via `common.run_in_env()`, which on the
deployment GPU box switches to the model's conda env
(`common.CONDA_ENV_MAP`) and on this dev machine falls back to in-process
execution (no conda envs configured here).

### MCP server

`backend/model_wrappers/mcp_server.py` is a `FastMCP` stdio server exposing
the 5 functions as `*_tool`s with descriptions from `schemas.TOOL_SCHEMAS` —
consumed by the orchestrator's Agent Executor via `MCPServerAdapter`, and
reusable by the existing CrewAI crew the same way
`backend/mcp_server/server.py` is.

## Weights

```bash
cd backend
uv sync --extra models
uv run python -m model_wrappers.download_weights all   # dofa | sattxt | sarmae | all
```

Downloads land in `backend/model_wrappers/weights/` (git-ignored), outputs
(segmentation masks / detection JSON) in `backend/model_wrappers/outputs/`
(also git-ignored).

- **DOFA**: `torch.hub` cache under `weights/torch_hub/` (~330 MB, ViT-B/16).
- **SATtxt (RemoteCLIP)**: `weights/sattxt/RemoteCLIP-ViT-B-32.pt` (~600 MB).
- **SARMAE**: `weights/sarmae/SARMAE_vitl_checkpoint-last` (ViT-L/16, ~3.9 GB).

All three run inference on CPU or the dev machine's RTX 4060 (8 GB VRAM is
ample for ViT-B/ViT-L encoder forward passes at 224×224).

## Run (dev)

One backend process serves both pipelines:

```bash
# terminal 1 — both CrewAI crew (/agent) and orchestrator (/orchestrator/agent)
cd backend && uv run uvicorn app:app --host 127.0.0.1 --port 8000 --reload

# terminal 2 — Next.js
npm run dev
```

`/orchestration` has a "智能体模式" switcher in the left sidebar to pick
between the two agents (`satelliteAnalyst` / `magneticOrchestrator`); each
re-mounts the `CopilotKit` provider with the corresponding agent and shows an
offline hint with the single `uvicorn` command if the backend isn't running.

**Split deployment (optional, prod):** to run the orchestrator on a separate
GPU host, start `uvicorn orchestrator.app:app --port 8100` there and point the
frontend at it with `ORCHESTRATOR_BACKEND_URL=http://<gpu-host>:8100/agent`.

## Smoke testing a single backend module

```bash
cd backend
uv run python -m model_wrappers.backends.dofa_backend '{"image": "<path-or-url>", "task": "segment", "dataset_head": "m-chesapeake"}'
uv run python -m model_wrappers.backends.sattxt_backend '{"task": "zero_shot_classify", "image": "<path>", "text": ["机场跑道", "港口码头", "农田"]}'
uv run python -m model_wrappers.backends.sarmae_backend '{"image": "<path>", "task": "segment"}'
```

Each prints the JSON envelope on stdout (last line).
