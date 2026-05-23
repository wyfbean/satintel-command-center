import type { RawIntelRecord } from "@/types/intel";

export const seededIntelRecords: RawIntelRecord[] = [
  {
    id: "seed-1",
    sourceId: "seed-satellite-lab",
    sourceName: "轨道情报实验室",
    channel: "mock",
    title: "商业 SAR 星座加密东南亚重访频次，海事与灾害监测需求显著升温",
    excerpt:
      "一家商业遥感运营商宣布提高东南亚海域与洪涝地区的 SAR 重访频次，重点服务海上监管与灾害响应。",
    body:
      "该运营商披露，其合成孔径雷达卫星将覆盖东南亚主要港口、近海航线与易涝省份，并提供更密集的任务排程窗口。新策略聚焦暗船识别、应急制图与关键基础设施监测。业内判断，这会直接拉动保险、物流以及政府应急部门对高频情报产品的采购需求。",
    url: "https://example.com/sar-constellation-cadence",
    publishedAt: "2026-05-23T09:10:00.000Z",
    tags: ["SAR", "海事", "星座", "监测"],
    region: "亚太",
    imageryModes: ["SAR"],
  },
  {
    id: "seed-2",
    sourceId: "seed-satellite-lab",
    sourceName: "轨道情报实验室",
    channel: "mock",
    title: "高光谱创业公司签下省级农业订单，遥感正从卖图转向卖决策",
    excerpt:
      "一家高光谱遥感公司获得省级农业客户订单，核心交付物不再是影像，而是作物胁迫与土壤湿度分析结果。",
    body:
      "这份协议覆盖高光谱数据采集、农学异常识别与季节性分析报告等服务。公司将该合作定义为“从原始卫星影像到采购决策”的桥梁。市场观察者认为，这再次证明遥感企业正在从单次影像售卖，转向按场景订阅的行业情报服务。",
    url: "https://example.com/hyperspectral-agri-analytics",
    publishedAt: "2026-05-23T06:25:00.000Z",
    tags: ["MS", "高光谱", "农业", "分析"],
    region: "中国",
    imageryModes: ["MS"],
  },
  {
    id: "seed-3",
    sourceId: "seed-satellite-lab",
    sourceName: "轨道情报实验室",
    channel: "mock",
    title: "发射延迟拖慢响应式成像合同，交付节点被迫顺延到下季度",
    excerpt:
      "一次搭载发射延误，正在影响一份面向防务客户的响应式对地观测合同交付节奏。",
    body:
      "原定的拼车发射计划推迟后，依赖短期光学与多光谱覆盖能力的合同里程碑被迫顺延到下季度。延迟正在加大下游交付压力，如果不能尽快找到备用运力或临时采集合作方，客户信心可能受到冲击。投资人与采购团队当前最关注的，是替代发射窗口与过渡性产能补位方案。",
    url: "https://example.com/launch-delay-responsive-imaging",
    publishedAt: "2026-05-22T21:30:00.000Z",
    tags: ["发射", "EO", "合同", "延迟"],
    region: "全球",
    imageryModes: ["RGB", "MS"],
  },
  {
    id: "seed-4",
    sourceId: "seed-satellite-lab",
    sourceName: "轨道情报实验室",
    channel: "mock",
    title: "微信行业文称多地汛期指挥中心开始采购卫星 EO 看板",
    excerpt:
      "一篇微信公众号文章显示，多地政府正在为汛期调度配置卫星遥感看板与跨部门联动面板。",
    body:
      "这篇微信公众号文章总结了地方政府在汛期对地观测看板的需求增长，产品形态通常会整合卫星影像、降雨数据和快速灾损快照。文章特别提到市级指挥中心、水库监测和跨部门简报流程。这个信号重要的地方在于，它说明预算正在向“可执行的情报工作台”倾斜，而不仅是购买影像归档服务。",
    url: "https://mp.weixin.qq.com/s/demo-flood-eo-dashboard",
    publishedAt: "2026-05-22T14:40:00.000Z",
    tags: ["微信", "洪涝", "EO", "政务"],
    region: "中国",
    imageryModes: ["RGB", "SAR", "MS"],
  },
  {
    id: "seed-5",
    sourceId: "seed-satellite-lab",
    sourceName: "轨道情报实验室",
    channel: "mock",
    title: "光学遥感厂商公布山火响应基准，主打亚小时级任务闭环",
    excerpt:
      "一家光学遥感公司称，在区域地面站配合下，山火响应可做到亚小时级任务闭环。",
    body:
      "该厂商发布了一套面向山火场景的响应基准，强调从任务排程、成像下传到简报生成的完整链路能力。它同时指出，若能结合 SAR 基线数据，就能部分缓解烟雾与云层对光学观测的影响。这类能力之所以重要，是因为应急客户越来越倾向于采购端到端响应工作流，而非单独购买影像。",
    url: "https://example.com/wildfire-tasking-benchmark",
    publishedAt: "2026-05-22T08:00:00.000Z",
    tags: ["RGB", "山火", "任务", "应急"],
    region: "北美",
    imageryModes: ["RGB", "SAR"],
  },
];
