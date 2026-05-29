# 开发记录 (Development Log)

本文件记录前端三大能力（AG-UI 编排、CopilotKit 对话面板、3D 星图）的设计决策、
技术选型与实现过程，作为持续的开发档案。

## 背景与目标

仓库是一个面向卫星情报的 Next.js 16 应用（React 19 + Tailwind v4），后端意图为基于
A2A（Agent-to-Agent）协议的多智能体系统，但仓库内目前仅有 mock
(`src/lib/mock/a2a-orchestration.ts`)，没有真实 agent 端点。

本期目标：
1. **AG-UI 集成** — 以聊天式界面可视化 A2A 状态调用与多智能体通信。
2. **CopilotKit 对话面板** — 以对话方式呈现当前卫星领域信息（用户称之为 “A2UI”，
   确认为开源 CopilotKit 技术栈，而非 Microsoft Copilot Studio）。
3. **3D 地球卫星地图** — 类 satellitemap.space，展示各国旗舰卫星及其信息。

## 关键决策（与用户确认）

- 本期对接 **mock**，并为真实 A2A 端点预留唯一替换点。
- 采用 **开源 CopilotKit**（`@copilotkit/*` + `@ag-ui/*`）。
- **单 Next.js 应用、多路由**：AG-UI / CopilotKit / react-globe.gl 都是运行在 Next.js
  内的 React 库，而非替代 Next.js 的框架；“为每个工具选用合适生态”指的是每条路由选用
  合适的**库**，而非拆分成多个应用。
- 新的 AG-UI 聊天视图 **替换** 原 `/orchestration` 静态页。

## 架构关系

```
A2A 协议        agent ↔ agent（后端；本期为 mock）
   │  在 API 层桥接（现为 mock，未来换 @ag-ui/a2a-middleware）
AG-UI 协议      agent ↔ user 事件流（消息 / 工具调用 / 状态增量），走 SSE
   │  由其实现
CopilotKit      <CopilotKit> + <CopilotChat> + 生成式 UI + 前端动作
   │  托管于
Next.js 应用    路由、共享 /api 后端、单次部署

3D 地球         react-globe.gl + satellite.js + 静态/CelesTrak TLE（独立渲染面）
```

## 路由结构

| 路由 | 作用 | 技术 |
|------|------|------|
| `/` | 中文资讯流 + Ask AI（契约不变） | 既有 |
| `/orchestration` | AG-UI 对话式 A2A 编排视图（重建） | CopilotChat + useCoAgent + useCopilotAction |
| `/dashboard` | CopilotKit 对话式卫星情报面板 | CopilotChat + useCopilotReadable + filterBySource 前端动作 |
| `/globe` | 各国旗舰卫星 3D 星图 | react-globe.gl + satellite.js（client-only） |

新增 API：`/api/copilotkit`（CopilotRuntime 端点）。既有
`/api/feed`、`/api/briefing`、`/api/chat`、`/api/backend/*` 契约保持不变。

## 技术栈固化（按 node_modules 实测，非凭记忆）

- `@copilotkit/react-core` / `@copilotkit/react-ui` / `@copilotkit/runtime` `1.59.0`
  （peerDeps 支持 React 19；runtime 的 `openai` peer 为 `^4.85.1 || >=5.0.0`，
  与项目 `openai@^6` 兼容）。
- `@ag-ui/client`（`AbstractAgent` / `EventType` / SSE 事件 schema）。
- `react-globe.gl` `2.38` + `three` + `satellite.js` `7`。
- 进程内 agent 通过 `CopilotRuntime({ agents: Record<string, AbstractAgent> })` 注册；
  Provider 用 `<CopilotKit runtimeUrl="/api/copilotkit" agent="...">` 绑定具名 agent。
- 因 agent 自行产出事件，serviceAdapter 用 `ExperimentalEmptyAdapter`，**无需 LLM Key**，
  保持零环境变量可用。

## 实现进展

### Phase 0 — 分支整合
仓库无 `main`/`dev`/remote；四个 `codex/*` 分支共享基线 `c77c45c`，主要新增工作其实是
当前分支工作区里的未提交改动。流程：先把工作区改动按“mock 后端 / A2A 编排页”两个逻辑
提交落库，再创建 `dev`，把 `mock-backend-rss-crawl` 上唯一的滚动修复提交 `25fbbe0`
合并进来（与未提交的 dashboard-shell 改动同区，已确认干净合并）。`dev` 作为集成分支，
后续功能走 `feat/*` 分支并 `--no-ff` 合并回 `dev`。

### Phase 1 — CopilotKit 运行时
新增 `/api/copilotkit`，注册 `orchestration`、`satellite_dashboard` 两个进程内 AG-UI
agent。端到端验证：`{"method":"info"}` 列出两个 agent；`agent/run` 正确输出 SSE。

### Phase 2 — `/orchestration` 重建为 AG-UI 对话视图
`OrchestrationMockAgent` 把 `mockA2AOrchestrationRun` 回放为符合规范的事件序列
（`RUN_STARTED → STEP/TEXT_MESSAGE/TOOL_CALL/STATE_SNAPSHOT → RUN_FINISHED`）。三个渲染通道：
TEXT_MESSAGE→聊天气泡、TOOL_CALL→“A2A 状态调用”卡片（useCopilotAction catch-all）、
STATE_SNAPSHOT→useCoAgent 状态面板。**桥接是对接真实 A2A Host 的唯一替换点。**

踩坑：CopilotKit 初始可能将 coagent state 置为 `{}`，需用 `{...initialState, ...state}`
浅合并兜底，否则 SSR 读 `state.metrics.activeAgents` 报错；交互页统一 `force-dynamic`。

### Phase 3 — `/dashboard` CopilotKit 对话面板
`SatelliteDashboardAgent` 复用 `getDashboardData` + `generateChatAnswer`（含确定性回退），
按 STATE_SNAPSHOT 推送资讯流/趋势/简报供面板渲染。`useCopilotReadable` 暴露当前筛选与可见
条目作为 grounding；`useCopilotAction(filterBySource)` 实现“对话驱动筛选”的前端动作闭环
（agent 识别来源名后发出 filterBySource 工具调用）。端到端验证：欢迎语、grounded 回答与
filterBySource 工具调用均在 SSE 流中确认。

### Phase 4 — `/globe` 3D 星图
`src/lib/satellites/catalog.ts` 用 Keplerian 元素经列对齐 + 校验和生成合法 TLE，satellite.js
做 SGP4 推演，零网络即可定位。`scripts/verify-tle.mts` 验证 12 颗卫星全部得到物理合理位置
（LEO ~500–800km、MEO ~20000km、GEO ~35786km）。`react-globe.gl` 经 `next/dynamic`
（`ssr:false`）仅在浏览器加载，按国家筛选、点击查看详情。
