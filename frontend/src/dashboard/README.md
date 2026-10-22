# RAG Atelier · Liquid Glass Dashboard

暖桃色液态玻璃风格的知识数据看板。默认作为应用首页展示，底部 Dock 可进入文档库、知识问答等原有页面；原有顶栏也保留了「数据看板」入口。

## 技术栈

- React 19 + TypeScript
- Framer Motion：共享布局、弹簧、Dock 缩放、浮层动画
- GSAP：数字滚动、液态筛选、图表柱体插值
- 原生 CSS：玻璃材质、响应式、字体与纹理
- 视觉字体：Manrope Variable（项目已有 `@fontsource-variable/manrope`）

## 5 个高阶交互

| 交互 | 实现位置 | 技术要点 |
| --- | --- | --- |
| 玻璃胶囊滑动菜单 | `components/GlassNav.tsx` | `layoutId` 让选中胶囊弹簧滑动；内层液体光斑按方向拉伸回弹 |
| 光标光斑 + 3D 倾斜 | `components/TiltCard.tsx` | 指针位置驱动 radial spotlight、边缘 mask 提亮，最大 3.6° 透视倾斜 |
| 原位放大详情 + 缩略图停靠 | `components/ModuleOverlay.tsx` + `ModuleCards.tsx` | 卡片、详情、缩略图共用 `layoutId`；打开、切换、关闭都走同一条共享布局路径 |
| 液态时间筛选 + 数据过渡 | `components/LiquidTimeFilter.tsx` + `TrendChart.tsx` | SVG `feGaussianBlur + feColorMatrix` gooey filter；GSAP 分裂液态滴；数字与图表平滑过渡；不刷新页面 |
| 浮动放大 Dock | `components/DashboardDock.tsx` | 共享指针位置计算距离，当前图标与左右邻居呈高斯衰减放大；玻璃 Tooltip；当前页铜色圆点 |

## 文件结构

```text
src/dashboard/
├── DashboardPage.tsx          # 页面编排、顶部栏、Hero、健康度球、主看板
├── DashboardPage.css          # 全部看板样式、响应式与动效关键帧
├── dashboardData.ts           # 日 / 周 / 月三套数据与格式化工具
├── icons.tsx                  # 看板补充图标，并统一导出已有图标
├── moduleMeta.ts              # 模块标题、色调、图标与缩略图摘要文案
├── numberMemory.ts            # 数字跨挂载读数缓存（避免关详情时重新计数）
└── components/
    ├── AnimatedNumber.tsx     # GSAP 数字滚动；可跨组件卸载保留读数
    ├── DashboardDock.tsx      # 底部 macOS 风格放大 Dock
    ├── GlassNav.tsx           # 玻璃胶囊滑动菜单
    ├── LiquidTimeFilter.tsx   # 液态时间筛选器
    ├── ModuleCards.tsx        # 卡片 / 详情 / 缩略图内容
    ├── ModuleOverlay.tsx      # 共享布局详情浮层与底部缩略图条
    ├── TiltCard.tsx           # 光斑、边缘高光与 3D 倾斜玻璃表面
    └── TrendChart.tsx         # 渐变圆头柱状图、目标线、悬停提示
```

## 数据与扩展

三套周期数据集中在 `dashboardData.ts` 的 `DASHBOARD_DATA` 中：

- 指标数字使用真实数值（非字符串），方便 Count-up。
- 图表 `values`、`target`、`composition` 会随周期切换插值。
- 知识源、AI 洞察、最近沉淀都按周期分别定义。
- 新增看板模块：在 `ModuleKey` 中加入 id，补 `MODULE_META` 与内容组件，再把 id 加到 `MODULE_ORDER`。

## 性能与可访问性

- 动画主体只改 `transform` 与 `opacity`；图表柱体用 `scaleY`，Dock 用 `scale/y`。
- 数字动画直接写文本节点，不触发 React 每帧渲染；跨卸载用内存值避免详情关闭时重复计数。
- 卡片光斑使用 transform 驱动的径向光斑；边框高光使用 mask，避免重排。
- 支持 `prefers-reduced-motion`：关闭轨道旋转与装饰动画，数字直接落值。
- 详情浮层使用 `role="dialog"`、焦点圈定、Esc 关闭、关闭后焦点回到原卡片，并锁定背景滚动。
- 数字统一 `font-variant-numeric: tabular-nums`。
- 背景与材质在 Chrome / Edge 的 `backdrop-filter` 不受支持时有半透明实色回退。

## 运行

```bash
cd frontend
npm install
npm run dev
```

构建：

```bash
npm run build
```
