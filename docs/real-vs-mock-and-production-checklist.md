# 真实 vs. 模拟功能清单 & 上线步骤

> 本文盘点系统中**哪些功能是真实的、哪些是模拟/占位的、哪些是「半真」（接口真实但结果是近似/降级版）**，并给出把每一块切到「真实正常运行」所需的后续步骤。
>
> 关键设计原则：**整套系统在零环境变量下也能跑起来**（回退到种子数据 + 确定性中文文案 + 模拟工具结果），便于离线演示。「上线」本质上就是把下面每一行从「模拟/半真」推到「真实」。

图例：✅ 真实 · 🟡 半真（接口真但结果近似/降级） · 🔴 模拟/占位 · ⚙️ 真实但需配置后才启用

---

## 一、总览表

| 模块 | 子项 | 现状 | 切到真实需要 |
|---|---|---|---|
| **资讯流** `/`,`/news` | RSS 抓取 | ✅ | 配置 `SATINTEL_RSS_SOURCES` |
| | 网页抓取 (crawl) | ✅ | 配置 `SATINTEL_CRAWL_URLS` |
| | AI 生成文章 | ⚙️ | 设 `OPENAI_API_KEY`（否则该源不产出） |
| | 种子/示例文章 | 🔴 | 设计如此——冷启动兜底，可在数据充足后忽略 |
| | AI 摘要 / 简报 / 标题翻译 | ⚙️ | 设 `OPENAI_API_KEY`（否则用确定性中文模板） |
| | 推荐重排 (click/dwell) | ✅ | 无（纯启发式算法，已可用） |
| **认证** `/signin` | 邮箱/密码注册登录 | ⚙️ | 设 `AUTH_SECRET` |
| | Google 登录 | ⚙️ | 设 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` |
| | Microsoft 登录 | ⚙️ | 设 `AUTH_MICROSOFT_ENTRA_ID_*` |
| **3D 地球** `/globe` | 卫星目录（7560 颗） | ✅ | 无（已迁移至 SQLite） |
| | 轨道实时位置 | 🟡 | 用 CelesTrak 实时 TLE 替代「按目录近地点/远地点的开普勒推算」 |
| **CrewAI 智能体** `/orchestration·卫星智能体分析` | 多智能体编排框架 | ⚙️ | 设 `OPENAI_API_KEY`（否则跑确定性模拟脚本） |
| | 图像工具 `segment_image`/`detect_objects` | 🔴 | 接真实 CV 模型（见 §4.1）——**即便开了 LLM 也仍是模拟** |
| | `tle_lookup` / `geo_locate` | 🔴 | 接 CelesTrak / 真实地理编码 |
| | 知识图谱 MCP (`kg/`) | ⚙️ | 构建 Kùzu 图库 + 装 `kuzu`/`fastmcp`（见 §5） |
| **Magnetic-One 编排** `/orchestration·模型编排` | 5 阶段编排循环 | ⚙️ | 设 `OPENAI_API_KEY`（否则确定性模拟脚本） |
| | `dofa`（多光谱分割） | 🟡 | 编码器真实(torch.hub)，但分割=无监督 k-means；需接微调分割头 |
| | `sattxt`（零样本分类/检索） | ✅ | 下载 RemoteCLIP 权重即真实可用 |
| | `sarmae`（SAR 检测/分割） | 🟡 | 编码器真实(预训练)，但任务=k-means；需接微调检测/分割头 |
| | `mtp`（RGB 目标检测） | 🔴 | 提供权重 + `mtp` conda 环境（mmdet 栈） |
| | `skyeyegpt`（遥感 VLM） | 🔴 | 提供权重 + 实现 MiniGPT-v2 推理路径 |

---

## 二、资讯流（前端 Next.js）

**真实的：** RSS/网页抓取走真实 HTTP 拉取，落 SQLite（`data/intel-cache.db`），调度器周期性增量入库；推荐重排是真实的启发式算法（点击 +1 / 停留 +2，按特征加权 + 知识图谱扩展），**不依赖 LLM**。

**模拟/降级的：**
- `src/lib/mock/articles.ts` 的种子文章（`mock` 源）始终作为冷启动兜底被追加——这是**有意设计**，数据充足后它们会沉到底部。
- 无 `OPENAI_API_KEY` 时，文章摘要 / `whyItMatters` / 今日简报 / 英文标题翻译 / AI 生成文章 全部走 `src/lib/intel/llm.ts` 里的**确定性中文模板**（`getClient()` 返回 `null`）。

**上线步骤：**
1. 在 `.env.local` 配置：
   ```env
   OPENAI_API_KEY=...
   OPENAI_BASE_URL=https://your-endpoint/v1   # 可选，兼容端点
   OPENAI_MODEL=gpt-4o-mini                    # 可选
   SATINTEL_RSS_SOURCES=https://a/rss,https://b/rss
   SATINTEL_CRAWL_URLS=https://c/news,https://d/blog
   ```
2. 触发首轮入库：等调度器自动跑，或 `POST /api/crawl/trigger`。
3. 验证：`/api/feed` 返回的 `sourceSummary.llmConfigured === true`，且条目里出现非 `mock` channel 的真实文章。

---

## 三、认证（NextAuth v5）

**真实的：** 邮箱/密码注册登录的全套逻辑已实现（`src/auth.ts` + bcrypt + SQLite `users`/`accounts` 表）。Google / Microsoft Entra 的 provider 代码已写好，但**仅在对应 client id/secret 存在时才注册**（见 `src/auth.ts:39` 起的条件展开）。

**上线步骤：**
1. 生成会话签名密钥（生产必须）：
   ```bash
   openssl rand -hex 32   # 写入 AUTH_SECRET
   ```
2. 邮箱/密码：配 `AUTH_SECRET` 即可用。
3. Google 登录：在 Google Cloud Console 建 OAuth 客户端，回调 `https://<域名>/api/auth/callback/google`，配 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`。
4. Microsoft 登录（可选）：配 `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET`（多租户加 `_TENANT_ID`）。
5. 验证：`/signin` 出现对应登录按钮；登录后 `session.user.id === users.id`。

---

## 四、CrewAI 智能体后端（`backend/app.py` · `POST /agent`）

**框架真实性：** 设 `OPENAI_API_KEY` 后跑真实 CrewAI crew（`satintel_agents/crew.py`）；否则跑 `satintel_agents/agui.py` 里的确定性多智能体模拟脚本。两种模式都会调用下面的工具。

**关键提醒——工具是模拟的，且 LLM 开了也不会变真：**
`satintel_agents/satellite_tools_impl.py` 里的 `segment_image` / `detect_objects` / `tle_lookup` / `geo_locate` 全是**确定性占位函数**（用 SHA-256 播种生成「看起来合理」的框/类别/经纬度）。它们同时被 mock 模式和真实 CrewAI crew（经 `mcp_server/server.py`）使用。所以**即使配置了 LLM，crew 拿到的图像/轨道工具结果仍是假的**。

### 4.1 让 CrewAI 用上真实工具
两条路：
- **路 A（复用已有真实模型，但非一行改动）：** 把 crew 的 `MCPServerAdapter` 从 `mcp_server/server.py`（模拟）改指向 `model_wrappers/mcp_server.py`（真实 DOFA/SATtxt/SARMAE）。注意这会**改变工具名与返回信封**（`dofa`/`sattxt` ≠ `segment_image`/`detect_objects`），因此还需同步改：① crew agent 提示里引用的工具名；② 前端工具卡渲染（`orchestration-shell.tsx` 按 `regions`/`objects` 字段形状渲染，需适配新信封）。
- **路 B（前端零改动）：** 直接重写 `satellite_tools_impl.py` 四个函数体为真实实现（SAM/检测器/CelesTrak/地理编码）——工具名与信封契约不变，前端无需改动。
- `tle_lookup` 接 **CelesTrak GP/TLE API**；`geo_locate` 接真实地理编码服务。

---

## 五、知识图谱 MCP（`kg/`，被真实 CrewAI crew 调用）

`kg/kg_mcp_server.py` 是**真实实现**——基于 **Kùzu** 图数据库查询卫星目录（`get_satellite` / `query_satellites` / `satellites_by_operator` 等）。crew 用**根目录 venv 的 python** 启动它（见 `crew.py` 的 `_ROOT_PYTHON`），所以依赖装在根 venv，而非 `backend/`。需先构建图库才能用。

**上线步骤（在项目根目录）：**
```bash
uv pip install kuzu fastmcp        # 或 pip install -r kg/requirements.txt
python kg/ingest.py                 # 读 satellite-KG.csv → 生成 Kùzu 图库到 data/satellite-kg/
```
（以脚本实际参数为准：`ingest.py` 输入 `satellite-KG.csv`、输出 `data/satellite-kg/`。）未构建/未装依赖时，真实 crew 启动会因连不上该 MCP server 而降级（仍可用图像工具与 LLM）。

---

## 六、Magnetic-One 模型编排（`backend/app.py` · `POST /orchestrator/agent`）

**框架真实性：** 同上，`OPENAI_API_KEY` 控制真实 CrewAI 分阶段编排 vs 确定性模拟脚本。无论真假模式，**附带图像时 Agent Executor 都会调用真实的 `model_wrappers` 后端**。

### 6.1 五个模型包装器现状（`backend/model_wrappers/backends/`）

| 模型 | 现状 | 说明 |
|---|---|---|
| `sattxt` | ✅ 真实 | RemoteCLIP（`open_clip` ViT-B/32 + `chendelong/RemoteCLIP` 权重）。零样本分类 / 图文检索，结果真实可用。 |
| `dofa` | 🟡 半真 | 编码器真实（`torch.hub` `zhu-xlab/DOFA` `vit_base_dofa`），但**分割是对 patch 嵌入做无监督 k-means**——没有捆绑微调的 GEO-Bench 分割头，结果是诚实的近似而非生产级分割。 |
| `sarmae` | 🟡 半真 | 编码器真实（`timm` ViT-L/16 + `Wenquandan777/SARMAE` 预训练权重），但检测/分割同样是 k-means 近似；未捆绑 RSAR/SARDet-100k/AIRSEG 微调头。 |
| `mtp` | 🔴 占位 | 抛 `ModelNotAvailableError`，直到提供 `weights/mtp/` 的 config+checkpoint 且配好 `mtp` conda 环境（mmdet 3.1 / mmrotate / mmcv 2.0 / torch 1.10）。 |
| `skyeyegpt` | 🔴 占位 | 抛 `ModelNotAvailableError`；上游 MiniGPT-v2/LLaMA2-7B 推理路径未实现，需权重 + 实现推理脚本。 |

### 6.2 上线步骤（在**部署用 GPU 机**上执行，非本开发机）

1. **下载已就绪模型的权重**：
   ```bash
   cd backend
   uv sync --extra models
   uv run python -m model_wrappers.download_weights all   # dofa | sattxt | sarmae | all
   ```
   - DOFA ≈330MB（ViT-B/16，torch.hub）、SATtxt(RemoteCLIP) ≈600MB、SARMAE ≈3.9GB。
2. **提升 dofa/sarmae 到生产级（可选但重要）**：把 k-means 近似换成真实下游头——下载/训练 GEO-Bench 分割头（DOFA）、RSAR/SARDet 检测头（SARMAE），在各自 backend 的 `run()` 中加载并推理。
3. **启用 mtp**：建 `mtp` conda 环境装 mmdet 栈，下载检测 checkpoint 到 `weights/mtp/`，实现 `_run_mmdet_inference()`。
4. **启用 skyeyegpt**：建 `skyeyegpt` 环境，下载 LLaMA2-7B + SkyEyeGPT checkpoint + MiniGPT-v2 视觉编码器到 `weights/skyeyegpt/`，实现 `_run_minigptv2_inference()`。
5. **conda 环境自动切换**：`common.py` 的 `CONDA_ENV_MAP` 已配好各模型对应 env 名；GPU 机上建好同名 conda 环境后，`run_in_env()` 会自动用 `conda run -n <env>` 调度（开发机无 conda 时回退本进程执行）。

---

## 七、3D 地球（`/globe`）

**真实的：** 7560 颗卫星目录（`satellite.csv` + `satlist.txt`）已入 SQLite `globe_satellites` 表并渲染。

**半真：** 轨道位置由目录里的近地点/远地点 + 倾角经**开普勒第三定律推算**，是**代表性轨迹而非实时精确星历**。

**上线步骤（可选）：** 若需实时精确位置，定期从 **CelesTrak** 拉取实时 TLE，用 `satellite.js` 的 SGP4 传播替代当前的开普勒近似。

---

## 八、部署拓扑提醒

- 一条命令即可在一个进程内同时服务两条流水线：`cd backend && uv run uvicorn app:app --port 8000`（CrewAI 在 `/agent`，Magnetic-One 在 `/orchestrator/agent`）。
- **重型模型推理应放在独立 GPU 机**。如需把 Magnetic-One 编排拆到 GPU 机：在该机跑 `uvicorn orchestrator.app:app --port 8100`，并在前端设 `ORCHESTRATOR_BACKEND_URL=http://<gpu-host>:8100/agent`。

---

## 九、上线优先级清单（建议顺序）

1. **[必做]** `OPENAI_API_KEY`（解锁资讯流 AI 摘要/简报 + 两条流水线的真实智能体推理）。
2. **[必做]** `AUTH_SECRET`（生产会话）；按需加 Google/Microsoft OAuth。
3. **[必做]** 资讯源：`SATINTEL_RSS_SOURCES` / `SATINTEL_CRAWL_URLS`。
4. **[高价值]** 在 GPU 机下载 DOFA/SATtxt/SARMAE 权重——SATtxt 立即真实可用；DOFA/SARMAE 编码器可用。
5. **[高价值]** 把 CrewAI crew 的图像工具从模拟 `satellite_tools_impl.py` 切到真实 `model_wrappers`（§4.1 路 A）。
6. **[按需]** 构建 KG Kùzu 图库（§5）。
7. **[进阶]** dofa/sarmae 接微调下游头；启用 mtp / skyeyegpt（§6.2）。
8. **[进阶]** globe 实时 TLE（§7）。
