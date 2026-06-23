# 模型机交接文档（权重位置 · 部署配置 · 各模型任务）

> 面向**模型机（部署用 GPU 机）运维/算法同事**。说明：①每个模型权重应放在哪里、当前在开发机的哪个位置；②要让**所有模型工具都真实运行**，模型机上需要怎么配置（依赖 / conda 环境 / 环境变量）；③每个模型分别完成什么任务、当前状态、如何冒烟验证。
>
> 服务入口：`backend/` 一个进程同时服务两条 AG-UI 流水线 —— CrewAI 在 `POST /agent`、模型编排（Magnetic-One 单智能体）在 `POST /orchestrator/agent`。本文只关注**模型编排用到的 5 个模型包装器**（`backend/model_wrappers/`）。
>
> 调用链：前端 `/orchestration` → `magnetic.py:_safe_call` → `model_wrappers.remote_models.<tool>` → `common.run_in_env(...)` →（有对应 conda env 则 `conda run -n <env> python -m model_wrappers.backends.<x>`，否则本进程内执行）→ 各 `*_backend.run()`。

---

## 〇、五个模型一览

| 工具名 | 模型 | 任务 | 当前状态 | 让它真实运行还缺什么 |
|---|---|---|---|---|
| `sattxt` | RemoteCLIP | 零样本分类 / 图文互检 | ✅ 完全可用 | 仅需权重（可自动下载） |
| `dofa` | DOFA 多光谱基础模型 | 语义分割（6 个 GEO-Bench head） | ✅ 真实分割头（3 个 RGB head 直接可用） | 3 个多光谱 head 需多波段输入（见 §3.3） |
| `sarmae`·segment | SARMAE（SAR） | SAR 语义分割（6 类） | ✅ 真实分割头 | 仅需 `seg_iter_20000.pth`（自包含 backbone） |
| `sarmae`·detect | SARMAE（SAR） | SAR 旋转框目标检测 | ⚙️ 真实检测头已就位，**待 mmrotate 环境+配置** | mmrotate 栈 + `SARMAE_DETECT_CONFIG/REPO`（见 §3.4） |
| `mtp` | MTP（ViTAE/RVSA） | RGB 水平框目标检测 | ⚙️ 推理代码已实现，**待 mmdet 环境+配置对** | `mtp` conda 环境 + `weights/mtp/` 放 config+ckpt（见 §3.5） |
| `skyeyegpt` | SkyEyeGPT（MiniGPT-v2/LLaMA2） | 看图问答 / caption / 多轮 / 视觉定位 | 🔴 推理路径未实现 | conda 环境 + LLaMA2-7B + 实现 MiniGPT-v2 推理（见 §3.6） |

图例：✅ 真实可用 · ⚙️ 真实但需配置后启用 · 🔴 占位（返回 `ok:false` 友好错误，不崩）

---

## 一、权重布局（先看规范，再看开发机现状）

后端通过**环境变量**定位权重，不写死路径。模型机上把文件按下面规范摆好、设好变量即可（开发机是 Windows+D 盘，模型机大概率 Linux —— **以变量为准，把文件拷过去再设变量**）。

### 1.1 环境变量（写在 `backend/.env`）

| 变量 | 作用 | 示例值 |
|---|---|---|
| `MODEL_WRAPPERS_WEIGHTS_DIR` | 主权重根目录 | `/data/sat-models/mw_weights` |
| `DOFA_HEADS_DIR` | DOFA 微调分割头根目录 | `/data/sat-models/dofa_heads` |
| `SARMAE_HEADS_DIR` | SARMAE 分割/检测头目录 | `/data/sat-models/sarmae_heads` |
| `SARMAE_DETECT_CONFIG` | SARMAE 旋转检测 mmrotate 配置 `.py` | `/data/.../vitb_ssdd.py` |
| `SARMAE_DETECT_REPO` | SARMAE 检测代码仓库（注册自定义 ViT backbone，加进 `sys.path`） | `/data/.../SARMAE_Fintune/Detection` |
| `OPENAI_API_KEY`（+ `OPENAI_BASE_URL`/`OPENAI_MODEL`） | 编排智能体的 LLM；不设则跑确定性模拟脚本 | —（**仅按名设置，勿外泄**） |

### 1.2 `MODEL_WRAPPERS_WEIGHTS_DIR` 下的规范结构

```
<MODEL_WRAPPERS_WEIGHTS_DIR>/
├── torch_hub/
│   ├── checkpoints/DOFA_ViT_base_e100.pth          # DOFA 编码器骨干
│   └── zhu-xlab_DOFA_master/                        # DOFA 仓库代码（分割必需）
│       ├── wave_dynamic_layer.py
│       └── downstream_tasks/geobench_segmentation/model.py
├── sarmae/SARMAE_vitl_checkpoint-last              # SARMAE 预训练编码器（仅 k-means 兜底用，真实分割/检测不需要）
├── sattxt/RemoteCLIP-ViT-B-32.pt                   # SATtxt
├── mtp/   <某配置>.py + <某检查点>.pth              # MTP 检测：config+ckpt 成对（待放）
└── skyeyegpt/ ...                                  # SkyEyeGPT 权重（待放）

<DOFA_HEADS_DIR>/<dataset_head>/best.pth            # 例 m-pv4ger-seg/best.pth，共 6 个
<SARMAE_HEADS_DIR>/seg_iter_20000.pth              # SARMAE 分割头（自带 backbone）
<SARMAE_HEADS_DIR>/detect_epoch_34.pth            # SARMAE 旋转检测头（需 mmrotate）
```

### 1.3 开发机现状（`D:\Downloads\sat-info-model\`，拷贝来源）

| 规范位置 | 开发机当前文件 |
|---|---|
| `torch_hub/checkpoints/DOFA_ViT_base_e100.pth` | `mw_weights/torch_hub/checkpoints/DOFA_ViT_base_e100.pth`（根目录也有一份） |
| `torch_hub/zhu-xlab_DOFA_master/` | `mw_weights/torch_hub/zhu-xlab_DOFA_master/`（根目录 `DOFA/` 同源） |
| `DOFA_HEADS_DIR/<head>/best.pth` | 根目录 `m-NeonTree/ m-SA-crop-type/ m-cashew-plant/ m-chesapeake/ m-nz-cattle/ m-pv4ger-seg/`（各含 `best.pth`）→ `DOFA_HEADS_DIR=D:\Downloads\sat-info-model` |
| `sarmae/SARMAE_vitl_checkpoint-last` | `mw_weights/sarmae/SARMAE_vitl_checkpoint-last`（根目录也有一份） |
| `SARMAE_HEADS_DIR/{seg,detect}` | `sarmae_seg_detect_weights/seg_iter_20000.pth` + `detect_epoch_34.pth` |
| `sattxt/RemoteCLIP-ViT-B-32.pt` | `mw_weights/sattxt/RemoteCLIP-ViT-B-32.pt` |
| `mtp/` config+ckpt | 检查点在根目录：`dior-rvsa-b-mae-mtp-epoch_12.pth`、`diorr-rvsa-b/l-mae-mtp-epoch_12.pth`；**还需配套的 mmdet `config.py`** |
| `skyeyegpt/` | 根目录：`SkyEyeGPT.pth`、`MiniGPT-4/`、`adapter_config.json`、`adapter_model.safetensors`、`large_weight_generator_*.pt` |

### 1.4 当前**未被任何包装器使用**的权重（开发机有、可忽略，勿浪费时间接）

`DOFA_ViT_large_e100.pth`、`DOFA_ViT_base_e100_full_weight.pth`、`dofav2_vit_base/large_e150.pth`、`dinov2_large_patch14_224.pth`、`config.json + model.safetensors`（DINOv3 ViT-L sat396m）、`SARMAE_vitb_checkpoint-last`、`sattxt_text_head.pt + sattxt_vision_head.pt`（+ LLM2Vec adapter）、`weight_generator_*.pt`、`data.zip`。

---

## 二、模型机基础环境

```bash
# 1. 基础后端 venv（所有 base-compatible 模型共用）
cd backend
uv sync --extra models     # torch / torchvision / timm / open_clip_torch / huggingface_hub / numpy / pillow / fastapi / uvicorn / ag-ui / openai / python-dotenv

# 2. 自动下载可联网获取的权重（DOFA 编码器 / RemoteCLIP / SARMAE 预训练编码器）
uv run python -m model_wrappers.download_weights all   # 或 dofa|sattxt|sarmae

# 3. 把上面 §1.3 的微调头（DOFA 6 head、SARMAE seg/detect、MTP config+ckpt）拷到位，写好 .env

# 4. 起服务
uv run uvicorn app:app --host 0.0.0.0 --port 8000
```

开发机 venv 已有：torch、torchvision、timm、open_clip、numpy、PIL、openai、dotenv。
开发机**缺**（模型机按需补）：transformers、mmcv、mmengine、mmdet、mmrotate、mmseg、h5py、rasterio、kornia、geobench。

---

## 三、各模型详解（任务 / 状态 / 依赖 / 验证）

> 冒烟命令统一在 `backend/` 下运行：`python -m model_wrappers.backends.<x> '<json>'`，最后一行打印 JSON 信封；看 `ok` 与 `result.head_source`。

### 3.1 `sattxt`（RemoteCLIP）— ✅ 完全可用
- **任务**：`zero_shot_classify` / `image_to_text_retrieval` / `text_to_image_retrieval`。
- **依赖**：`open_clip`（base venv 已含）。权重缺失时自动从 `chendelong/RemoteCLIP` 下载。
- **冒烟**：`python -m model_wrappers.backends.sattxt_backend '{"task":"zero_shot_classify","image":"<img>","text":["airport","farmland","harbor"]}'` → `ok:true`，`result.predictions` 排序。

### 3.2 `dofa`（多光谱分割）— ✅ 真实头（3 个 RGB head 直接可用）
- **任务**：`segment`，`dataset_head` ∈ {m-NeonTree, m-SA-crop-type, m-cashew-plant, m-chesapeake, m-nz-cattle, m-pv4ger-seg}。
- **依赖**：torch + timm（base）+ `DOFA_HEADS_DIR/<head>/best.pth` + 编码器 `torch_hub/checkpoints/DOFA_ViT_base_e100.pth` + 仓库代码 `torch_hub/zhu-xlab_DOFA_master/`。分割头按 checkpoint 张量逆向重建（`strict=True` 加载，结构可证正确）。
- **冒烟**：`python -m model_wrappers.backends.dofa_backend '{"task":"segment","dataset_head":"m-pv4ger-seg","image":"<RGB图>"}'` → `head_source` 含 `real fine-tuned UPerLite`。

### 3.3 ⚠️ DOFA 多光谱 head 的输入限制
`m-pv4ger-seg / m-NeonTree / m-nz-cattle` 是 **3 波段 RGB**，上传普通图即可。
`m-chesapeake`(4 波段) / `m-SA-crop-type`、`m-cashew-plant`(12 波段) 需对应波段数的多光谱输入，目前传 3 通道图会返回明确的 `ValueError`（不是崩溃）。要真实跑这 3 个：需多波段读取（`rasterio`/`h5py`）+ 各数据集 `band_stats.json` 归一化（填入 `dofa_seg.py:_BAND_STATS`，否则用按图标准化近似）。

### 3.4 `sarmae`（SAR）— segment ✅ / detect ⚙️
- **segment（✅）**：6 类 SAR 语义分割。分割头 `seg_iter_20000.pth` **自带 backbone**，只依赖 torch+timm（base），**不需要** mmseg、也不需要 3.9GB 的 SARMAE 预训练编码器。
  冒烟：`python -m model_wrappers.backends.sarmae_backend '{"task":"segment","image":"<SAR图>"}'` → `head_source` 含 `real fine-tuned UPerHead`。
- **detect（⚙️ 待环境）**：SAR 旋转框检测，权重 `detect_epoch_34.pth` 已就位，但**是两阶段旋转检测器，必须用 mmrotate 框架**，无法纯 PyTorch 重建。需要：
  1. conda env `sarmae` 装 `mmrotate` + `mmdet` + `mmcv`（与该检测头训练时版本对齐）；
  2. 设 `SARMAE_DETECT_CONFIG`（指向 SSDD 检测配置 `.py`）、`SARMAE_DETECT_REPO`（指向注册自定义 ViT backbone 的代码目录，如 `SARMAE_Fintune/Detection`）。
  缺 mmrotate 时**自动降级**为编码器 + k-means 近似（不崩，`head_source` 会标注降级）。

### 3.5 `mtp`（RGB 水平框检测）— ⚙️ 待环境+配置对
- **任务**：`detect`（DIOR/DOTA 风格水平框）。推理代码 `_run_mmdet_inference()` **已实现**（用 `mmdet.apis.inference_detector`），水平 head 已确认正确。
- **依赖**：版本钉死的 mmdet 栈，与 base 的现代 torch 冲突 → **必须独立 conda env**：
  ```bash
  conda create -n mtp python=3.8 && conda activate mtp
  # 按 MTP 仓库 INSTALL.md：torch==1.10 + mmcv==2.0.0 + mmdet==3.1.0 + mmrotate==1.0.0rc1
  ```
  然后把一个 **config.py + checkpoint.pth 成对**放进 `MODEL_WRAPPERS_WEIGHTS_DIR/mtp/`（开发机已有 `dior-rvsa-*` / `diorr-rvsa-*` 检查点，**还需配套 config**）。
- **冒烟**（mtp env 内）：`python -m model_wrappers.backends.mtp_backend '{"task":"detect","image":"<RGB图>"}'`。
- ⚠️ 见 §四 —— mtp 依赖 conda 切换，而当前 `run_in_env` 有一处需先修。

### 3.6 `skyeyegpt`（遥感 VLM）— 🔴 未实现
- **任务**：`caption` / `vqa` / `dialogue` / `grounding`。
- **现状**：返回 `ok:false` 友好错误。需在 `skyeyegpt` conda env 内：装 MiniGPT-v2 环境、下载 LLaMA2-7B（HF 许可）+ 视觉编码器，并在 `skyeyegpt_backend.py` 实现 `_run_minigptv2_inference()`。开发机已有 `SkyEyeGPT.pth`/`MiniGPT-4/`/adapter，但**上游推理脚本尚未实现**，是真正的开发任务（不只是配置）。

---

## 四、⚠️ conda 环境切换的关键提醒（mtp/sarmae-detect 必读）

`common.py:CONDA_ENV_MAP` 把模型映射到 conda 环境名：`skyeyegpt→skyeyegpt`、`sarmae→sarmae`、`dofa→dofa`、**`sattxt→dofa`**、`mtp→mtp`。建好同名 env 后，`run_in_env` 会用 `conda run -n <env>` 调度；没有则本进程执行。

有三个**必须知道**的点：

1. **切换粒度是「按模型」不是「按任务」**：`sarmae` seg（torch+timm）和 `sarmae` detect（mmrotate）共用同一个 `sarmae` env → 该 env 必须是**超集**（同时含 timm 与 mmrotate），否则启用 detect 会把 seg 弄坏。`dofa` env 同理（且因 `sattxt→dofa`，`dofa` env 还需含 `open_clip`）。

2. **`run_in_env` 当前传的是 `sys.executable`（=base 解释器绝对路径）**：`conda run -n env /abs/base/python -m mod` 实际仍用 **base 的 site-packages**，不会用 env 里的包。也就是说**目前 conda 切换并未真正生效**（base-compatible 模型因此「碰巧」一直正常）。要让独立 env 真正生效，把 `common.py:149` 的 `sys.executable` 改成字符串 `"python"`（由 `conda run` 在 env 内解析）。
   - 对 **mtp 这是硬性前置**（torch 1.10 无法与 base 现代 torch 共存，必须在独立 env 跑）。
   - 改完后请注意第 1 点：若 `sarmae`/`dofa` env 是半成品（缺 timm/open_clip），原本正常的 seg/分类会**回归报错**。改 `run_in_env` 与「env 必须是超集」要一起做。

3. **推荐策略（省事且避坑）**：base-compatible 的 `sattxt` / `dofa`(分割) / `sarmae`(分割) **不要建对应 conda env**（让 `run_in_env` 回退到 base 进程内，直接可用）；只为依赖冲突的 **`mtp`**（以及 `sarmae` detect 的 mmrotate 栈）建独立 env，并配合第 2 点的 `run_in_env` 修复。

> 本机无 conda，上述第 2 点为代码分析结论而非实测，请在模型机实测确认后再依赖按模型切换。需要的话我可以直接把 `run_in_env` 的 `sys.executable→"python"` 改掉。

---

## 五、验收顺序建议

1. `uv sync --extra models` + `download_weights all` + 拷微调头 + 写 `.env` → 起服务。
2. 逐个跑 §三 的冒烟命令：`sattxt`、`dofa`(RGB head)、`sarmae` segment **应立即 `ok:true`**。
3. `sarmae` detect：建 `sarmae`(mmrotate 超集) env + 配 `SARMAE_DETECT_CONFIG/REPO` + 修 `run_in_env` → `ok:true` 且 `head_source` 含 `rotated detector`。
4. `mtp`：建 `mtp` env + 放 config+ckpt + 修 `run_in_env` → `ok:true` detections。
5. `skyeyegpt`：实现推理脚本后再启用。
6. 前端 `/orchestration` 端到端：上传图 + 提问，工具卡应渲染分割掩码 / 检测框（前端已支持 `mask` 彩色叠加与旋转/水平框）。

---

## 六、相关文档
- 整体「真实 vs 模拟 + 上线清单」：`docs/real-vs-mock-and-production-checklist.md`（其 §6.1 关于 dofa/sarmae 仍为 k-means 的描述**已被本文取代** —— 现已接入真实分割头）。
- 模型包装器与编排实现：`docs/model-wrappers-orchestration.md`。
- 后端启动与 AG-UI：`docs/agent-backend-crewai.md`。
