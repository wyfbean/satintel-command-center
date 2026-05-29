# CopilotKit 对话面板与 AG-UI 运行时

`/dashboard` 与 `/orchestration` 共享同一个 CopilotKit 运行时端点
`/api/copilotkit`，二者用途不同：`/orchestration` 用于**观察** A2A 编排过程，
`/dashboard` 用于**对话查询**卫星领域信息。

## 运行时端点 (`src/app/api/copilotkit/route.ts`)

```ts
new CopilotRuntime({
  agents: {
    orchestration: new OrchestrationMockAgent(),
    satellite_dashboard: new SatelliteDashboardAgent(),
  },
});
```

- serviceAdapter = `ExperimentalEmptyAdapter`：agent 自行产出 AG-UI 事件，运行时层不需要
  LLM Key。**零环境变量即可运行**。
- 前端用 `<CopilotKit runtimeUrl="/api/copilotkit" agent="<name>">` 绑定具名 agent。
- 协议自查：`POST /api/copilotkit` body `{"method":"info"}` 返回已注册 agent；
  `{"method":"agent/run","params":{"agentId":"..."},"body":<RunAgentInput>}` 触发 SSE 事件流。

## Agent 实现（进程内 AG-UI `AbstractAgent`）

`run(input): Observable<BaseEvent>`，发出符合 `verifyEvents` 顺序约束的事件：
`RUN_STARTED` 先、`RUN_FINISHED` 后；消息 `START→CONTENT→END`；工具调用 `START→ARGS→END`。

- `OrchestrationMockAgent` (`src/lib/a2a/orchestration-agent.ts`)：回放 mock A2A run。
- `SatelliteDashboardAgent` (`src/lib/a2a/dashboard-agent.ts`)：
  - `getDashboardData()` 作为 grounding，`STATE_SNAPSHOT` 推送资讯流/趋势/简报。
  - `generateChatAnswer()` 生成回答（无 Key 时走确定性中文回退）。
  - 读取 `input.context`（来自 `useCopilotReadable`）贴合界面上下文。
  - 识别用户提到的来源名 → 若前端注册了 `filterBySource` 工具则发出工具调用。

## 前端 (`src/components/dashboard-copilot/dashboard-copilot-shell.tsx`)

- `useCoAgent<DashboardAgentState>`：读取 agent 推送的快照渲染领域面板，挂载时 `run()` 拉取。
- `useCopilotReadable`：暴露当前筛选/可见条目，使回答贴合所见。
- `useCopilotAction(filterBySource)`：对话驱动来源筛选的前端动作闭环。
- `<CopilotChat>`：对话界面，配套 `@copilotkit/react-ui/styles.css`。
- 注意：CopilotKit 初始可能将 coagent state 置为 `{}`，用 `{...initialState, ...state}` 兜底。

## 接真实后端的替换点

当前两个 agent 都是 mock/复用既有服务。接真实 A2A/agent 时：
- 编排视图：用 `@ag-ui/a2a-middleware` 指向真实 A2A Host（见
  [a2a-orchestration-ui.md](a2a-orchestration-ui.md)）。
- 对话面板：把 `SatelliteDashboardAgent` 换成指向真实 agent 的 `HttpAgent`，或保留其作为
  领域服务的 BFF。前端契约（agent 名、状态形状）保持不变。
