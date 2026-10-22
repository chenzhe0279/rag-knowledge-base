# RAG Knowledge Base · 前端

基于 **React 19 + TypeScript 5.9 + Vite 8** 的知识库控制台，包含文档管理、Markdown 预览、文本块查看、系统健康检查和 SSE 流式知识问答。

## 技术栈

- **React 19 + TypeScript 5.9**，Vite 8 构建
- **react-markdown + remark-gfm**：渲染 Markdown 原文与问答回答，支持 GFM 表格、任务列表与代码块
- **@microsoft/fetch-event-source**：消费 FastAPI 的 SSE 流式问答
- **openapi-typescript**：从后端 OpenAPI 文档生成精确的接口类型
- **openapi-fetch**：基于生成类型构建类型安全的 API 客户端
- Oxlint 静态检查

## 快速开始

> 首次启动或后端接口发生变化后，需要先生成一次前端类型。

```powershell
# 1. 启动后端（新终端）
cd ..\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# 2. 回到前端目录安装依赖
cd ..\frontend
npm install

# 3. 从正在运行的后端生成 API 类型（需要 backend 已启动）
npm run gen:api

# 4. 启动开发服务器（默认 http://localhost:5173）
npm run dev
```

后端启动后可以访问 `http://127.0.0.1:8000/docs` 查看 Swagger 文档。开发环境下 `/api` 请求由 Vite 代理到 `http://127.0.0.1:8000`，不涉及浏览器跨域。

## 功能

### 知识数据看板

- 液态玻璃风格首页，包含趋势、榜首知识源、AI 洞察与最近沉淀
- 玻璃胶囊菜单、光标光斑 / 3D 倾斜、共享布局详情、液态周期筛选与放大 Dock
- 日 / 周 / 月切换时数字平滑滚动、图表柱体插值，不刷新页面
- 主模块可原位展开为详情，其余模块收起为底部玻璃缩略条

### 文档库

- 上传 PDF、DOCX、PPTX、XLSX、Markdown、HTML，单文件上限 50 MB
- 文档以知识卡片形式展示：首页缩略图、文件类型、状态、大小和更新时间
- 缩略图加载失败或后端尚未生成时，自动回退到带文件类型的渐变占位图
- 支持重命名文档：固定扩展名，校验空白名称、长度、非法字符
- 重命名弹窗可同时上传缩略图：支持 PDF、JPG、JPEG、PNG、WebP，最大 10 MB
- 拖拽或点击选择文件，上传后自动打开文档详情
- 按文档状态筛选：上传中 / 解析中 / 向量化中 / 已就绪 / 处理失败
- 分页浏览；处理中的文档会每 3 秒自动刷新状态
- 失败文档支持重新处理，处理中的文档禁止删除

### 文档详情

- **Markdown 预览**：拉取原始 `.md` 文件，由 `react-markdown` + `remark-gfm` 渲染
- **PDF / HTML 预览**：使用 iframe；HTML 在沙箱中运行，脚本不会执行
- **DOCX / PPTX / XLSX**：浏览器无法内联渲染，提供下载入口
- 展示文件大小、状态、哈希和上传/更新时间
- **文本块**：查看切分统计、分页列表、chunk 摘要及完整内容
- 下载原始文件、重新处理失败文档、删除文档（带二次确认）

### 知识问答

- 基于已入库文档的 RAG 问答，回答通过 **SSE** 流式返回
- 支持 `message_start`、`query_route`、`citations`、`token`、`message_end`、`error` 事件
- 查询路由调试：实时展示 `original` / `rewrite` / `hyde` / `multi_query` 策略
- 每条 assistant 消息可展开路由快照，查看原始问题、实际检索 Query、改写内容、HyDE 假设答案及多路子查询
- 路由快照由后端持久化，刷新页面或恢复历史会话后仍可查看；旧消息无快照时自动隐藏
- 侧栏展示当前查询路由策略、引用匹配度柱状图与来源排行
- 回答渲染 Markdown；引用按 `ordinal` 显示，点击可打开来源文档
- 会话 ID 保存在浏览器本地，刷新后可恢复历史消息
- 支持停止生成、新建对话、Enter 发送 / Shift + Enter 换行

### 系统状态

- 三个独立健康检查卡片：后端 API、PostgreSQL、腾讯云 COS
- 支持单卡重试和全部刷新，展示响应耗时、检测时间和错误原因

## 后端接口

| 页面 | 方法 | 接口 | 用途 |
| --- | --- | --- | --- |
| 文档库 | `GET` | `/api/documents` | 分页、按状态筛选文档 |
| 文档库 | `POST` | `/api/documents` | 上传文档（multipart/form-data） |
| 文档库 | `PATCH` | `/api/documents/{id}` | 重命名文档（body: `{"name": "新名称.ext"}`） |
| 文档库 | `GET` | `/api/documents/{id}/thumbnail` | 首页缩略图（WebP） |
| 文档库 | `PUT` | `/api/documents/{id}/thumbnail` | 上传/替换缩略图（multipart/form-data） |
| 文档详情 | `GET` | `/api/documents/{id}` | 文档详情与状态轮询 |
| 文档详情 | `DELETE` | `/api/documents/{id}` | 删除文档 |
| 文档详情 | `POST` | `/api/documents/{id}/retry` | 重试失败文档 |
| 文档详情 | `GET` | `/api/documents/{id}/file?download=0` | 原始文件预览 |
| 文档详情 | `GET` | `/api/documents/{id}/chunks` | 文本块分页与统计 |
| 文档详情 | `GET` | `/api/documents/{id}/chunks/{chunk_id}` | 单个文本块完整内容 |
| 知识问答 | `POST` | `/api/conversations` | 创建会话（body: `{"title": "..."}`） |
| 知识问答 | `GET` | `/api/conversations/{id}` | 会话详情与历史消息 |
| 知识问答 | `POST` | `/api/conversations/{id}/chat` | SSE 流式问答（body: `{"question": "..."}`） |
| 系统状态 | `GET` | `/api/health`、`/api/health/db`、`/api/health/cos` | 依赖健康检查 |

## 同步后端类型

`src/types/schema.d.ts` 由后端 OpenAPI 规范自动生成，已加入 `.gitignore`，不提交到仓库。

```bash
# 先保证后端运行在 127.0.0.1:8000
npm run gen:api
```

- 后端新增/修改接口后重新执行即可。
- `npm run build` 依赖该文件；新克隆项目或 CI 环境需要在构建前启动后端并执行 `gen:api`。
- `openapi-typescript` 当前 peer 依赖 TypeScript 5.x，因此项目 TypeScript 固定为 5.9.x。

## 配置

复制 `.env.example` 为 `.env.local` 后按需修改：

```ini
# 留空时使用同源 /api（开发环境走 Vite 代理）
VITE_API_BASE_URL=

# Vite 开发代理目标
API_PROXY_TARGET=http://127.0.0.1:8000
```

- **开发环境**：保持 `VITE_API_BASE_URL` 为空，由 Vite 代理解决跨域。
- **生产部署**：如果前端与后端不同源，将 `VITE_API_BASE_URL` 设置为后端地址（例如 `https://api.example.com`），并把该地址加入后端 `.env` 的 `CORS_ORIGINS`。
- `npm run gen:api` 默认从 `http://127.0.0.1:8000/openapi.json` 拉取；如后端地址不同，请修改 `package.json` 中的脚本地址。

### 健康状态说明

- `ok`：正常
- `error`：接口可访问，但依赖服务异常（例如数据库连接失败）
- `not_configured`：相关配置缺失（例如 COS 凭据未填写）
- 网络错误、非 2xx、超时（10 秒）或响应结构不合法：显示「连接失败」及具体原因

## 常用脚本

```bash
npm run dev       # 启动开发服务器
npm run gen:api   # 从后端 OpenAPI 重新生成类型（需要后端运行）
npm run build     # TypeScript 类型检查 + 生产构建
npm run preview   # 预览生产构建产物
npm run lint      # Oxlint 静态检查
```

## 目录结构

```
frontend/
├─ src/
│  ├─ api/              # 健康检查、文档 API、聊天 SSE 与 openapi-fetch 客户端
│  ├─ components/       # 状态卡片、上传弹窗、查询路由调试面板、通用 UI
│  ├─ dashboard/        # 液态玻璃数据看板、图表与 5 个高阶交互组件
│  ├─ data/             # 健康检查项元数据
│  ├─ hooks/            # 健康检查、文档列表/详情轮询
│  ├─ lib/              # 状态映射、文件类型、查询路由元数据、格式化工具
│  ├─ pages/            # 文档库、文档详情、知识问答、系统状态
│  ├─ types/            # 健康/文档/聊天类型；schema.d.ts 由 gen:api 生成
│  ├─ App.tsx           # 应用外壳与视图切换
│  ├─ App.css           # 通用布局、导航、按钮、弹窗
│  └─ index.css         # 主题变量与全局样式
├─ vite.config.ts       # /api 开发代理
└─ .env.example
```
