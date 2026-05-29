# 3D 卫星星图 (`/globe`)

类 satellitemap.space 的 3D 地球，展示各国旗舰卫星并实时推演其轨道。

## 技术栈

- `react-globe.gl`（基于 three.js / WebGL 的地球可视化组件）。
- `satellite.js`：SGP4/SDP4 轨道推演，将 TLE 解析为实时经纬高。
- `three`：自定义卫星 3D 对象。
- 页面经 `next/dynamic`（`ssr: false`）仅在浏览器加载，避免 WebGL/window 在服务端报错；
  路由 `force-dynamic`。

## 卫星目录 (`src/lib/satellites/catalog.ts`)

- 收录 12 颗各国旗舰卫星（美国、欧盟、中国、日本、印度、俄罗斯、韩国），覆盖对地观测、
  导航、通信、科学、气象类型。
- 每颗卫星以 Keplerian 元素描述，`buildTle()` 将其渲染为**列对齐、带校验和的合法 TLE**，
  satellite.js 即可零网络推演。固定 epoch 保证构建可复现。
- **生产替换点**：实现一个 CelesTrak 抓取适配器（按 NORAD id 查询、按任务分组），用实时
  element set 覆盖静态 TLE。抓取策略应与资讯侧 `CrawlAdapter` 一致——只取明确配置的公开
  数据，不做登录/反爬绕过。

## 渲染 (`src/components/globe/globe-shell.tsx`)

- `twoline2satrec` 仅解析一次（`useMemo`）；每秒 `propagate(satrec, now)` →
  `eciToGeodetic` → 经纬高，驱动卫星沿轨道滑动。
- `objectsData` + `objectLat/Lng/Altitude`（高度单位为地球半径，= altKm / 6371）+
  `objectThreeObject`（按国家着色的小球，选中放大并增强自发光）。
- 交互：按国家/地区筛选、点击卫星查看 NORAD id、机构、类型、当前高度与星下点。

## 验证

`scripts/verify-tle.mts`（`node --experimental-strip-types`）对全部卫星做 SGP4 推演并断言
经纬高有限且高度在 100–50000km 内。当前 12/12 通过：LEO ~500–800km、MEO ~20000km、
GEO ~35786km（lat≈0）。

## 备注

地球贴图与夜空背景来自 unpkg 上的 three-globe 示例纹理（浏览器端按需加载）。若需完全离线，
可将纹理改为本地静态资源。
