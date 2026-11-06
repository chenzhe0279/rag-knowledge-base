# rag-knowledge-base

企业知识库 RAG 系统，由 **FastAPI 后端**和 **React 控制台**组成，位于同一个仓库：

- **后端**（`backend/`）：把 PDF / Office / Markdown / HTML 文档异步入库为可检索的文本块，基于「向量 + 中文全文」混合检索、Rerank 精排和 Agentic 多轮检索回答问题，答案附带可溯源引用，证据不足时拒答，并按 RBAC + 文档权限标签隔离数据。
- **前端**（`frontend/`）：面向管理员与普通用户的控制台，覆盖登录鉴权、知识数据看板、文档管理与预览、SSE 流式问答、评测中心和系统健康检查。

前端不直连数据库、Redis 或对象存储，全部业务能力通过后端的 REST 与 SSE 接口消费。

**阅读指引**

| 想了解 | 直接看 |
| --- | --- |
| 系统能做什么 | 第 1–2 章 |
| 本地跑起来 | 第 6 章 |
| 环境变量与配置 | 第 7 章 |
| 接口与 SSE 事件协议 | 9.3、第 11 章 |
| 前端页面功能 | 第 10 章 |
| 常见问题排查 | 第 15 章 |

## 1. 项目简介

面向企业内部制度、手册、流程类文档的问答场景。管理员上传文档后，Celery Worker 负责解析、切分、向量化与写库；用户通过会话（conversation）提问，服务端用 LangGraph 编排查询改写、检索、观察与重排，再以 SSE 流式返回答案、引用（citation）和调试信息。系统内置答案校验、语义缓存、滑动窗口限流、RAGAS 离线评测与 LangSmith 链路追踪。

整体链路：

1. 管理员在控制台上传文档，后端校验后写入 COS，并把入库任务投递给 Celery。
2. Worker 用 docling 解析文档、切分、分批 embedding，把文本块写入 PostgreSQL（pgvector）。
3. 用户在「知识问答」页创建会话并提问，前端以 SSE 消费 `POST /api/conversations/{id}/chat`。
4. 服务端做权限过滤、混合召回、rerank、Agent 多轮决策与答案校验，逐 token 推回答案和引用。
5. 管理端可在评测中心跑 RAGAS 评测、查看 Bad Case 并人工归因。

## 2. 核心能力

### 2.1 知识库管理

- 支持 PDF、DOCX、PPTX、XLSX、Markdown、HTML 上传，单文件默认上限 50 MB，按文件 SHA256 秒传去重
- Celery 异步入库，`ingestion_tasks` 记录任务状态机与 `progress_total / progress_done` 逐批进度
- 失败文档一键重试；上传新版本时按 `chunk_hash` 对齐做增量 reindex，文档 `version` +1
- 文档重命名（校验扩展名、非法字符、长度）、手动上传缩略图、文本块（chunk）分页与统计
- 控制台以知识卡片展示文档，处理中的文档每 3 秒轮询任务进度，缩略图缺失时回退为渐变占位图
- 支持按状态筛选与分页；处理中的文档禁止删除

### 2.2 检索问答

- 向量（pgvector HNSW，余弦）+ 中文全文（jieba 预分词 + tsvector / GIN）双路并发召回，RRF 融合
- `qwen3-rerank` 精排，Top1 分数低于阈值走统一拒答
- 查询路由：`original` / `rewrite` / `hyde` / `multi_query` / `rewrite_multi_query`；多轮对话先做指代消解
- Agentic RAG：每轮检索后观察上下文是否足够，LLM 规划下一步（改写 / 切换路由 / 拒答），最多 `AGENT_MAX_ROUNDS` 轮
- 答案校验：LLM 判断答案是否有检索片段支撑，不通过整段替换为拒答文案
- 控制台逐轮展示 Agent 决策轨迹、五种查询路由、引用排名（两路 rank / RRF 分 / 精排分）、`verify_result` 与 LangSmith `trace_id`

### 2.3 权限与安全

- JWT（HS256）+ bcrypt；每个请求回查用户，禁用立即生效
- RBAC：用户 ↔ 角色多对多，角色持有 `permission_tags`，`*` 为通配
- 文档级权限在 SQL 层过滤；无权文档按 404 返回，不暴露资源存在性
- 语义缓存按「权限集合哈希」隔离；上传 / reindex / 问答挂 Redis 滑动窗口限流
- 控制台把 token 存于 `localStorage`，401 统一清空会话并回登录页；非管理员隐藏上传、重命名、重新处理、删除、评测中心等入口

### 2.4 评测与可观测性

- 评测集（`app/evaluation/datasets/*.jsonl`）一键跑批，计算 RAGAS 四项指标 + 引用命中率 + 拒答准确率 + 延迟
- 规则自动归因 Bad Case（12 类 + other），支持人工覆盖
- LangSmith `@traceable` 覆盖检索与问答链路，`trace_id` 随 SSE 下发并落库
- 统一异常体 `{"code", "message"}`，统一 stdout 日志格式
- 控制台的评测中心支持发起 run、轮询进度、按 Bad Case 归因筛选、查看 case 详情并人工覆盖归因

### 2.5 控制台页面

| 页面 | 主要能力 |
| --- | --- |
| 登录 | JWT 登录、刷新后通过 `GET /api/auth/me` 恢复会话 |
| 知识数据看板 | 知识脉搏、知识域趋势、AI 洞察、健康光球、周期切换与 Dock 动效 |
| 文档库 | 上传、卡片列表、状态筛选、分页、轮询任务进度、重命名与缩略图 |
| 文档详情 | Markdown / PDF / HTML 预览、入库任务卡片、版本重建、文本块、下载与删除 |
| 知识问答 | SSE 流式问答、Agent 轨迹、引用面板、语义缓存标记、TRACE 入口、会话历史 |
| 评测中心 | 数据集、评测 run、RAGAS 指标、case 明细与 Bad Case 归因 |
| 权限管理 | 用户分页与 CRUD、角色与权限标签维护 |
| 系统状态 | 后端 API / PostgreSQL / COS 三个健康检查卡片 |

## 3. 技术栈与选型

### 3.1 选型一览

版本约束以 `backend/pyproject.toml`、`backend/uv.lock` 和 `frontend/package.json` 为准。

| 端 | 领域 | 选型 |
| --- | --- | --- |
| 前端 | 框架 / 构建 | React 19 + TypeScript 5.9，Vite 8 |
| 前端 | Markdown 渲染 | react-markdown + remark-gfm（GFM 表格、任务列表、代码块） |
| 前端 | SSE 客户端 | @microsoft/fetch-event-source |
| 前端 | 类型同步 | openapi-typescript（从后端 OpenAPI 生成接口类型） |
| 前端 | 动效 | framer-motion（仅用于数据看板的布局、弹簧数字与 Dock 放大） |
| 前端 | 样式 | 原生 CSS 变量设计系统（暖桃 / 铜 / 奶油液态玻璃），Manrope 可变字体 |
| 前端 | 静态检查 | Oxlint |
| 后端 | 语言 / 包管理 | Python >= 3.12，uv |
| 后端 | Web 框架 | FastAPI + Uvicorn，Pydantic v2 + pydantic-settings |
| 后端 | 数据库 / ORM | PostgreSQL + pgvector，SQLAlchemy >= 2.1 异步 + asyncpg，Alembic |
| 后端 | 检索 | pgvector HNSW（`vector_cosine_ops`）+ PostgreSQL 全文检索（`simple` 配置 + GIN），jieba 预分词，RRF，qwen3-rerank |
| 后端 | LLM / 编排 | LangGraph，LangChain Core / langchain-openai，DeepSeek chat（OpenAI 兼容），DashScope `text-embedding-v3`（1024 维） |
| 后端 | 异步任务 | Celery（Redis broker / result backend） |
| 后端 | 缓存 / 限流 | Redis + RedisVL 语义缓存，Redis ZSET 滑动窗口 |
| 后端 | 文档解析 | docling（转 Markdown），Pillow 生成缩略图 |
| 后端 | 对象存储 | 腾讯云 COS（cos-python-sdk-v5） |
| 后端 | 评测 | RAGAS + 自定义指标与规则归因 |
| 后端 | 认证 | PyJWT + bcrypt |
| 后端 | 可观测性 | LangSmith |

### 3.2 后端关键取舍

1. **混合检索而不是纯向量**。是什么：两路各召回 Top 20 再融合。为什么：制度文档里大量编号、金额、专有名词（如「一线城市」「500 元」），纯语义召回容易漏字面命中，关键词路正好补位。代价：多一次 SQL 和一份 `content_tokens` 存储，jieba 词典质量直接影响关键词路效果。
2. **RRF 而不是分数相加**。余弦相似度在 [0, 1]，`ts_rank` 无固定上界，直接相加没有意义；RRF 只看排名 `1 / (k + rank)`，与分数尺度无关。代价：丢掉了分数绝对值信息，所以拒答阈值改看 rerank 分 / 向量分，而不是 RRF 分。
3. **权限过滤放在 SQL 层**。过滤条件和向量 / 全文检索在同一条 SQL 的 `WHERE` 中执行，Top-K 截断发生在过滤之后，不会出现「召回 20 条、过滤后剩 2 条」导致的召回量塌缩，也不会让无权数据进入应用内存。代价：权限模型必须能表达成数组运算（`&&` / `cardinality`）。
4. **入库走 Celery，评测走 BackgroundTasks**。入库是高频、耗 CPU（docling 模型推理）的长任务，需要独立进程和可横向扩展的 Worker；评测是管理员低频手动触发，用 FastAPI `BackgroundTasks` 免去额外部署。代价：评测与 API 进程同生命周期，重启即中断（见「已知限制」）。
5. **RedisVL 做语义缓存**。复用已有 Redis，KNN + Tag 过滤一次查询完成「相似度阈值 + 权限范围一致」两个条件。代价：缓存命中依赖 embedding 调用，embedding 失败时直接跳过缓存。

### 3.3 前后端协作约定

- 接口统一 `/api` 前缀；除登录、健康检查和文档缩略图外都需要 `Authorization: Bearer <token>`。文档原始文件为兼容 iframe / 新窗口预览，额外支持 `?token=<JWT>`。
- 后端 OpenAPI 是前端类型的唯一来源：`npm run gen:api` 生成 `src/types/schema.d.ts`，该文件被 gitignore，不提交仓库。
- SSE 事件契约见 [9.3](#93-sse-事件协议)，前端按事件增量渲染，不做整段重绘。
- 业务错误统一返回 `{code, message}`；Pydantic 请求校验失败仍是 FastAPI 默认的 422 `{detail: [...]}`。前端 `http.ts` 同时兼容 `{code,message}`、`{detail: string}`、`{detail: [{msg}]}` 三种形态，401 统一触发登出。
- 开发环境前端以同源 `/api` 请求，由 Vite 代理到 `http://127.0.0.1:8000`；生产环境跨域时需设置 `VITE_API_BASE_URL` 并把该地址加入后端 `CORS_ORIGINS`。

## 4. 系统架构

### 4.1 整体拓扑

```mermaid
flowchart LR
    U["浏览器 / React 控制台"] -->|"REST + SSE /api"| API["FastAPI"]
    API --> PG[("PostgreSQL + pgvector")]
    API --> RD[("Redis（缓存 / 限流 / broker）")]
    API --> LLM["DeepSeek / DashScope"]
    API --> COS[("腾讯云 COS")]
    API -->|"投递入库任务"| RD
    W["Celery Worker"] --> RD
    W --> PG
    W --> COS
```

### 4.2 后端分层职责

| 层 | 目录 | 职责 |
| --- | --- | --- |
| API | `app/api/routes`、`app/api/schemas`、`app/api/deps.py` | 参数校验、鉴权依赖（`CurrentUser` / `CurrentAdmin` / `RateLimited`）、ORM → Pydantic 转换 |
| Service | `app/services` | 业务规则与**事务边界**：`commit` 只出现在 service、pipeline 与后台任务中 |
| Repository | `app/db/repositories` | 单表 / 聚合查询，只 `flush` 不 `commit`，权限过滤条件在这里拼进 SQL |
| Model | `app/db/models.py` | ORM 模型、枚举、索引与外键级联策略 |
| 领域模块 | `app/retrieval`、`app/workflows`、`app/llm`、`app/ingestion`、`app/evaluation`、`app/storage` | 检索、编排、模型调用、入库流水线、评测、对象存储 |

请求级 `AsyncSession` 由 `get_session` 依赖注入；SSE 问答、Celery 任务、评测任务和混合检索各自用 `AsyncSessionLocal()` 开独立 session，不与请求生命周期绑定。

### 4.3 问答时序

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as FastAPI
    participant S as ChatService
    participant R as Redis
    participant G as LangGraph
    participant DB as PostgreSQL
    participant LLM as LLM API

    C->>API: POST /api/conversations/{id}/chat
    API->>R: 滑动窗口限流
    API->>S: stream_answer
    S->>DB: 校验会话归属, 加载最近 N 轮历史
    S->>R: 语义缓存 KNN 查询 + 权限 Tag
    alt 缓存命中
        S-->>C: message_start, citations, token, message_end
    else 未命中
        S->>G: ainvoke
        G->>DB: 向量 + 全文双路召回
        G->>LLM: 路由 / 规划 / rerank
        G-->>S: final state
        S->>DB: 提交 user 消息
        S-->>C: message_start, query_route, agent_steps, citations
        S->>LLM: 流式生成
        S-->>C: token x N
        S->>LLM: 答案校验
        S-->>C: verify_result
        S->>DB: assistant 消息 + 引用同事务提交
        S->>R: 写回语义缓存
        S-->>C: message_end
    end
```

### 4.4 入库流程

```mermaid
graph TD
    A["POST /api/documents"] --> B{"MIME 与大小校验"}
    B -- 不通过 --> X["400 validation_error"]
    B -- 通过 --> C{"SHA256 已存在"}
    C -- 是 --> D["返回已有文档"]
    C -- 否 --> E["写入 COS"]
    E --> F["documents uploading + ingestion_tasks pending, commit"]
    F --> G["Celery ingest_document"]
    G --> H["task running, 文档 parsing"]
    H --> I["docling 解析为 Markdown"]
    I --> J["文档 indexing, 切分 600/60"]
    J --> K["分批 embedding, 逐批累加 progress_done"]
    K --> L["写入 document_chunks"]
    L --> M["文档 ready, task success"]
    H -. 异常 .-> N["文档 failed + error_message, task failed"]
    K -. 异常 .-> N
    N --> O["POST retry 重新投递"]
```

### 4.5 前端运行时结构

- `src/api/`：`http.ts` 封装 fetch、JWT 注入与错误归一化，其余文件按资源分别封装文档、会话、评测、权限与健康检查请求
- `src/auth/`：token 存取（`localStorage` + 内存缓存）、401 全局事件、`AuthProvider` / `useAuth`
- `src/app/`：应用外壳、路由（`router.ts` / `AppRoutes.tsx`）、登录门（`AuthGate`）与侧栏 / 顶栏
- `src/pages/`：登录、看板、文档库、文档详情、问答、评测、权限、系统状态八个页面，各自维护页面级状态与样式
- `src/hooks/`、`src/lib/`：轮询、文档标题、格式化、状态映射等复用逻辑
- `src/types/`：手写业务类型与 `schema.d.ts`（由后端 OpenAPI 生成）

## 5. 目录结构

```text
rag-knowledge-base/
├── .env                      # 后端配置（从仓库根读取，不是 backend/.env）
├── .env.example
├── pyproject.toml            # 仅项目元信息，依赖统一在 backend/pyproject.toml
├── backend/
│   ├── app/
│   │   ├── main.py           # create_app 工厂、lifespan 种子管理员、CORS、异常处理、路由挂载
│   │   ├── celery_app.py     # Celery 实例与 worker 配置
│   │   ├── core/             # config / logger / tracing / observability / security / exceptions / redisConfig / rate_limiter
│   │   ├── api/
│   │   │   ├── deps.py       # DbSession / CurrentUser / CurrentAdmin / RateLimited
│   │   │   ├── error_handlers.py
│   │   │   ├── routes/       # health / auth / users / roles / documents / chat / evaluations
│   │   │   └── schemas/      # Pydantic 请求 / 响应模型
│   │   ├── db/
│   │   │   ├── models.py     # 11 张表的 ORM 模型与枚举
│   │   │   ├── session.py    # engine / AsyncSessionLocal / get_session
│   │   │   ├── base.py, seed.py
│   │   │   └── repositories/ # document / chunk / ingestion_task / conversation / citation / user / role / evaluation
│   │   ├── services/         # document / chat / auth / user / role / permission / evaluation / semantic_cache
│   │   ├── retrieval/        # vector / keyword / hybrid(RRF) / tokenizer(jieba) / filters
│   │   ├── workflows/        # rag_state、graph.py、nodes/*（LangGraph 节点）
│   │   ├── llm/              # 模型工厂、prompts、query_rewriter、agent_planner、reranker、answer_verifier
│   │   ├── ingestion/        # parser / splitter / embedder / thumbnail / pipeline / tasks(Celery)
│   │   ├── evaluation/       # dataset 加载、ragas_runner、scoring 与归因规则、datasets/*.jsonl
│   │   └── storage/          # COS 客户端与文件服务
│   ├── alembic/versions/     # 数据库迁移
│   ├── scripts/              # 维护脚本：backfill_content_tokens
│   ├── vendor/jieba/         # jieba 本地 wheel（uv.toml 通过 find-links 引用）
│   └── pyproject.toml, uv.lock, uv.toml, alembic.ini
└── frontend/
    ├── src/
    │   ├── api/              # http 客户端、健康检查、文档、聊天 SSE、评测、权限接口
    │   ├── app/              # 应用外壳、路由、登录门、侧栏与通用链接
    │   ├── auth/             # token 存取、AuthProvider、useAuth
    │   ├── components/       # 状态卡片、上传 / 重命名 / 重建 / 权限标签弹窗、Markdown 预览、分页、Toast
    │   ├── hooks/            # 轮询与文档标题
    │   ├── lib/              # 状态映射、文件类型、格式化工具
    │   ├── pages/            # login / dashboard / documents / document-detail / chat / evaluation / access / status
    │   ├── styles/           # 主题变量与全局样式
    │   ├── types/            # 业务类型；schema.d.ts 由 gen:api 生成
    │   ├── config.ts         # API_BASE_URL / API_DOCS_URL
    │   └── main.tsx
    ├── vite.config.ts        # /api 开发代理
    ├── package.json
    └── .env.example
```

`backend/uv.toml` 把 uv 缓存放在 `backend/.uv-cache2`，默认索引为清华镜像，jieba 从 `vendor/jieba/dist` 的本地 wheel 安装（官方只发 sdist）。`uv` 命令统一在 `backend/` 目录下执行。

## 6. 快速开始

### 6.1 前置依赖

| 依赖 | 说明 |
| --- | --- |
| Python 3.12+ / [uv](https://docs.astral.sh/uv/) | 后端运行与包管理 |
| Node.js + npm | 前端控制台 |
| PostgreSQL + pgvector | 迁移会执行 `CREATE EXTENSION IF NOT EXISTS vector`，数据库用户需有权限 |
| Redis | 应用缓存 / 限流、Celery broker、Celery result 分别使用 db0 / db1 / db2 |
| 腾讯云 COS 存储桶 | 上传、下载、缩略图都依赖 COS，代码中没有本地存储实现 |
| DashScope API Key | embedding + rerank |
| DeepSeek API Key | chat |

### 6.2 环境变量

配置从**仓库根目录**的 `.env` 读取（`app/core/config.py` 中 `PROJECT_ROOT / ".env"`），不是 `backend/.env`。根目录 `.env.example` 只包含少量示例，完整变量见第 7 章。最小可用配置：

```env
DATABASE_URL=postgresql+asyncpg://<db-user>:<db-password>@localhost:5432/<db-name>
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2

JWT_SECRET=<a-long-random-string>
DEFAULT_ADMIN_PASSWORD=<your-admin-password>

COS_SECRET_ID=<your-cos-secret-id>
COS_SECRET_KEY=<your-cos-secret-key>
COS_REGION=ap-guangzhou
COS_BUCKET=<your-bucket-appid>

EMBEDDING_API_KEY=<your-dashscope-api-key>
CHAT_API_KEY=<your-deepseek-api-key>
```

前端另有自己的 `.env.local`（默认留空即可），见 [7.2](#72-前端环境变量)。

### 6.3 启动后端

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

Windows 上也可以直接调用虚拟环境里的解释器：

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### 6.4 启动 Celery Worker

另开终端：

```bash
cd backend
uv run celery -A app.celery_app worker -l info
```

Windows 上 Celery 默认的 prefork pool 不可用，需要加 `--pool=solo`：

```powershell
cd backend
uv run celery -A app.celery_app worker -l info --pool=solo
```

Worker 未启动时，前端仍会显示「排队中」的最新任务，但不会推进进度。

### 6.5 启动前端

以下命令在仓库根目录执行（如果当前在 `backend/`，先 `cd ..`）：

```powershell
# 1. 进入前端目录安装依赖
cd frontend
npm install

# 2. 从正在运行的后端生成 API 类型（必须先启动 backend）
npm run gen:api

# 3. 启动开发服务器（默认 http://localhost:5173）
npm run dev
```

> 首次启动或后端接口发生变化后，需要重新执行一次 `npm run gen:api`；该文件被 gitignore，新克隆的仓库构建前必须先生成。

后端启动后可以访问 `http://127.0.0.1:8000/docs` 查看 Swagger 文档。开发环境下 `/api` 请求由 Vite 代理到 `http://127.0.0.1:8000`，不涉及浏览器跨域。

### 6.6 验证与登录

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/health/db
curl http://127.0.0.1:8000/api/health/cos
```

- Swagger：`http://127.0.0.1:8000/docs`
- 控制台：`http://localhost:5173`

首次打开前端会进入登录页。数据库为空时后端会自动创建默认管理员，默认账号密码为 `admin / admin`，可通过根目录 `.env` 的 `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` 覆盖（仅在数据库无用户时初始化）。登录成功后所有业务请求会自动携带 JWT。

### 6.7 最小可用流程

```bash
# 1. 登录，取出 access_token
curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "<your-admin-password>"}'

export TOKEN=<access_token>

# 2. 上传文档（公开可见），记下返回的 id，轮询 GET /api/documents/{id} 直到 status=ready
curl -s -X POST http://127.0.0.1:8000/api/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./差旅管理制度.md" \
  -F 'permission_tags=["public"]'

# 3. 创建会话，记下返回的 id
curl -s -X POST http://127.0.0.1:8000/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "差旅咨询"}'

# 4. SSE 提问（-N 关闭缓冲，逐事件输出）
curl -N -X POST http://127.0.0.1:8000/api/conversations/<conversation_id>/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question": "主管在一线城市出差，每晚住宿报销上限是多少？"}'
```

## 7. 配置说明

### 7.1 后端环境变量

以下变量与 `app/core/config.py` 一一对应（大小写不敏感，未知变量忽略）。「必填」指不配置时对应功能不可用。

**基础与数据库**

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `APP_NAME` | 否 | `rag-knowledge-base` | FastAPI 标题 |
| `LOG_LEVEL` | 否 | `INFO` | 根日志级别 |
| `DATABASE_URL` | 是 | 空 | 必须使用 `postgresql+asyncpg://` 驱动 |
| `CORS_ORIGINS` | 否 | `http://localhost:5173` | 逗号分隔 |

**对象存储**

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | 是 | 空 | 三项均非空才视为已配置 |
| `COS_BUCKET` | 是 | 空 | 存储桶名（含 APPID） |
| `COS_REGION` | 否 | `ap-guangzhou` | 地域 |

**模型**

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `EMBEDDING_API_KEY` | 是 | 空 | DashScope Key |
| `EMBEDDING_BASE_URL` | 否 | DashScope compatible-mode | OpenAI 兼容地址 |
| `EMBEDDING_MODEL` | 否 | `text-embedding-v3` | |
| `EMBEDDING_DIM` | 否 | `1024` | 必须与 `vector(N)` 列一致 |
| `EMBEDDING_BATCH_SIZE` | 否 | `10` | 每批 embedding 条数，也是进度粒度 |
| `CHAT_API_KEY` | 是 | 空 | DeepSeek Key |
| `CHAT_BASE_URL` | 否 | `https://api.deepseek.com` | |
| `CHAT_MODEL` | 否 | `deepseek-flash` | |
| `RERANK_ENABLED` | 否 | `true` | 关闭后 rerank 节点透传 |
| `RERANK_API_KEY` | 否 | 空 | 留空时回落到 `EMBEDDING_API_KEY` |
| `RERANK_BASE_URL` | 否 | DashScope reranks 端点 | 非标准 OpenAI 接口 |
| `RERANK_MODEL` | 否 | `qwen3-rerank` | |
| `RERANK_MIN_SCORE` | 否 | `0.3` | Top1 rerank 分低于此值拒答 |
| `RERANK_TIMEOUT` | 否 | `8.0` | 秒 |

**切分与检索**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `UPLOAD_MAX_SIZE_MB` | `50` | 单文件上限 |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `600` / `60` | 字符数 |
| `RETRIEVAL_RECALL_TOP_K` | `20` | 每路召回数 |
| `RRF_K` | `60` | RRF 平滑常数 |
| `RETRIEVAL_TOP_K` | `5` | rerank 后保留数 |
| `RETRIEVAL_MIN_SCORE` | `0.6` | 向量相似度阈值（observe / 无 rerank 时的 judge） |
| `CHAT_HISTORY_WINDOW` | `5` | 带入 prompt 的历史轮数 |
| `QUERY_ROUTE_ENABLED` | `true` | 关闭后固定 `original` |
| `MULTI_QUERY_COUNT` | `3` | 子查询数 |
| `AGENT_LOOP_ENABLED` | `true` | 关闭后退化为单轮检索 |
| `AGENT_MAX_ROUNDS` | `3` | 最大检索轮次（含首轮） |
| `VERIFY_ANSWER_ENABLED` | `true` | 答案校验开关 |

**认证**

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `JWT_SECRET` | 是 | 空 | 为空时启动只打 ERROR 日志，登录不可用 |
| `JWT_ALGORITHM` | 否 | `HS256` | |
| `JWT_EXPIRE_MINUTES` | 否 | `1440` | |
| `DEFAULT_ADMIN_USERNAME` | 否 | `admin` | 仅库内无用户时创建 |
| `DEFAULT_ADMIN_PASSWORD` | 否 | `admin` | **生产环境必须覆盖** |
| `DEFAULT_ADMIN_DISPLAY_NAME` | 否 | `管理员` | |

**Redis / Celery / 缓存 / 限流**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379/0` | 语义缓存与限流 |
| `CELERY_BROKER_URL` | `redis://localhost:6379/1` | |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/2` | |
| `SEMANTIC_CACHE_ENABLED` | `true` | |
| `SEMANTIC_CACHE_TTL_SECONDS` | `3600` | |
| `SEMANTIC_CACHE_MIN_SIMILARITY` | `0.92` | 内部换算为距离阈值 `1 - 0.92` |
| `RATE_LIMIT_ENABLED` | `true` | |
| `RATE_LIMIT_PER_MINUTE` | `60` | 按用户，上传 / reindex / 问答共享 |

**LangSmith**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LANGSMITH_TRACING` | `true` | 需同时配置 Key 才生效 |
| `LANGSMITH_API_KEY` | 空 | |
| `LANGSMITH_PROJECT` | `rag-knowledge-base` | |
| `LANGSMITH_ENDPOINT` | `https://api.smith.langchain.com` | |
| `LANGSMITH_RUN_URL_PREFIX` | 空 | 配置后才下发 `trace_url` |

### 7.2 前端环境变量

复制 `frontend/.env.example` 为 `.env.local` 后按需修改：

```ini
# 留空时使用同源 /api（开发环境走 Vite 代理）
VITE_API_BASE_URL=

# Vite 开发代理目标
API_PROXY_TARGET=http://127.0.0.1:8000
```

- **开发环境**：保持 `VITE_API_BASE_URL` 为空，由 Vite 代理解决跨域。
- **生产部署**：如果前端与后端不同源，将 `VITE_API_BASE_URL` 设置为后端地址（例如 `https://api.example.com`），并把该地址加入后端 `.env` 的 `CORS_ORIGINS`；`API_DOCS_URL` 也会基于它拼接，用于从界面跳转 Swagger。
- `npm run gen:api` 默认从 `http://127.0.0.1:8000/openapi.json` 拉取；如后端地址不同，请修改 `package.json` 中的脚本地址。

### 7.3 健康状态语义

| 状态 | 含义 |
| --- | --- |
| `ok` | 正常 |
| `error` | 接口可访问，但依赖服务异常（例如数据库连接失败） |
| `not_configured` | 相关配置缺失（例如 COS 凭据未填写） |
| 连接失败 | 网络错误、非 2xx、超时（10 秒）或响应结构不合法，前端展示具体原因 |

## 8. 数据模型

### 8.1 数据表

| 表 | 作用 |
| --- | --- |
| `documents` | 文档元数据、COS 位置、状态、版本、权限标签、缩略图 key |
| `document_chunks` | 文本块内容、embedding、分词结果、生成列 `content_tsv` |
| `ingestion_tasks` | 入库 / 重建任务状态与进度 |
| `conversations` | 会话，归属用户 |
| `messages` | user / assistant 消息，`metadata` 存路由、Agent 步骤、校验结果、trace_id、cache_hit |
| `answer_citations` | assistant 消息的引用快照 |
| `users` / `roles` / `user_roles` | RBAC |
| `evaluation_runs` / `evaluation_items` | 评测任务与逐条样本结果 |

### 8.2 关键设计

- **向量索引**：`document_chunks.embedding` 为 `vector(1024)`，HNSW + `vector_cosine_ops`。维度来自 `EMBEDDING_DIM`，改维度必须写迁移重建列与索引。
- **全文索引**：`content_tokens` 存 jieba 预分词后以空格连接的文本；`content_tsv` 是 `to_tsvector('simple', content_tokens)` 的持久化生成列 + GIN 索引。用 `simple` 配置是因为 PostgreSQL 内置配置不懂中文分词，分词交给应用层。代价：更换分词规则后要跑 `scripts/backfill_content_tokens.py` 回填。
- **权限标签**：`documents.permission_tags` 为 `text[]`，默认 `{}`。空数组 = 公开；非空数组与用户有效标签做 `&&` 重叠匹配。
- **唯一与版本**：`file_hash` 唯一索引用于秒传；`version` 在 reindex 成功后 +1；`chunk_hash`（内容 MD5）有索引，用于增量对齐。
- **级联策略**：
  - `document_chunks`、`ingestion_tasks` → `documents`：`ON DELETE CASCADE`，删文档一并清理。
  - `messages` → `conversations`、`answer_citations` → `messages`、`evaluation_items` → `evaluation_runs`：`CASCADE`。
  - `documents.created_by`、`conversations.user_id` → `users`：`SET NULL`，删用户不丢文档与会话。
  - `answer_citations.document_id / chunk_id`：`SET NULL`。引用冗余存 `document_name`、`page_no`、`quote`、`retrieval_meta`，原 chunk 被重建或文档被删后，历史会话仍能展示当时的引用原文。
- **任务状态机**：`ingestion_tasks.status` 为 `pending → running → success / failed`，`task_type` 为 `ingest` / `reindex`；文档状态为 `uploading → parsing → indexing → ready / failed`。

### 8.3 数据库迁移与种子数据

```bash
cd backend
uv run alembic upgrade head                                   # 升级到最新
uv run alembic current                                        # 查看当前版本
uv run alembic history                                        # 查看迁移链
uv run alembic revision --autogenerate -m "<describe-change>" # 修改 models.py 后生成迁移
uv run alembic downgrade -1                                   # 回退一个版本
```

- `alembic/env.py` 使用 `settings.database_url`，与应用共享同一份 `.env`。
- autogenerate 对 pgvector 列、HNSW 索引与 `Computed` 生成列的识别不完整，生成后需人工检查。
- 混合检索迁移（`b7c1e2f3a4d5`）为存量 chunk 填空 `content_tokens`，需要回填：

```bash
cd backend
uv run python -m scripts.backfill_content_tokens
```

**种子数据**：`lifespan` 启动时调用 `seed_default_admin()`，仅当 `users` 表为空时创建内置角色 `admin`（标签 `*`）、`user`（标签 `public`）和默认管理员。种子失败只记录异常，不阻断启动。生产环境首次启动前务必设置 `DEFAULT_ADMIN_PASSWORD` 和 `JWT_SECRET`。

## 9. 核心业务流程

### 9.1 文档入库

1. **校验**：扩展名优先于浏览器给的 MIME（`.md` 常被标成 `application/octet-stream`），不支持的类型、空文件、超过 `UPLOAD_MAX_SIZE_MB` 一律 400。
2. **秒传**：按内容 SHA256 查重，命中直接返回已有文档，不重复入库。
3. **落库与投递**：文件写入 COS → 插入 `documents(uploading)` 与 `ingestion_tasks(pending)` → `commit` → `ingest_document_task.delay()`。先提交再投递，Worker 取到任务时数据一定可见。
4. **Worker 执行**（`app/ingestion/pipeline.py::_run_ingest`）：docling 解析 → `RecursiveCharacterTextSplitter`（默认 600 / 60，中文标点分隔符）→ 写 `progress_total` → 按 `EMBEDDING_BATCH_SIZE`（默认 10）分批 embedding，每批独立短事务累加 `progress_done` → 批量写 chunks → `ready` + `success`。每次状态变更都是独立短事务，列表轮询能及时看到进度。
5. **失败与重试**：任一阶段异常 → 文档 `failed` + `error_message`（截断 500 字），任务 `failed`。`POST /{id}/retry` 只接受 `failed` 文档，先清空旧 chunks 再新建任务。
6. **增量 reindex**：要求文档处于 `ready / failed`、MIME 与原文件一致、内容 hash 不同。Worker 按 `chunk_hash` 对齐：旧有新无 → 删除；新旧都有 → 只更新 `chunk_index` / metadata，不重新 embedding；新有旧无 → embedding 后插入，`progress_total` 只计新增数。同一文档内出现重复 `chunk_hash` 时退化为全删全插。成功后 `version` +1。
7. **删除**：处于 `parsing / indexing` 的文档禁止删除。先删 DB 行并提交，再删 COS 对象与缩略图；COS 删除失败只记 warning，以 DB 为准。
8. **列表 N+1 优化**：`GET /documents` 用一条 `SELECT DISTINCT ON (document_id) ... ORDER BY document_id, created_at DESC` 批量取当前页每个文档的最新任务，作为 `latest_task` 返回。

### 9.2 检索问答（LangGraph）

```mermaid
graph LR
    S((START)) --> NQ["normalize_query"]
    NQ --> RQ["route_query"]
    RQ --> PL["plan_retrieval"]
    PL -- refuse --> RF["refuse"]
    PL -- retrieve --> RT["retrieve"]
    RT --> OB["observe_context"]
    OB -- 不足且未达上限 --> PL
    OB -- 足够或达上限 --> RR["rerank"]
    RR --> JC["judge_context"]
    JC -- 足够 --> E((END))
    JC -- 不足 --> RF
    RF --> E
```

| 节点 | 行为 |
| --- | --- |
| `normalize_query` | 有历史时调用 LLM 做指代消解，得到独立可检索的 `query` |
| `route_query` | 选择 `original / rewrite / hyde / multi_query / rewrite_multi_query`，`QUERY_ROUTE_ENABLED=false` 时固定 `original` |
| `plan_retrieval` | 首轮记录 `initial`；后续轮由 agent planner 决定 `proceed / rewrite_query / switch_route / refuse` |
| `retrieve` | 混合检索；`multi_queries` 存在时逐条子查询检索后按 RRF 分去重合并 |
| `observe_context` | Top1 向量相似度 >= `RETRIEVAL_MIN_SCORE` 视为足够，写回本轮 `retrieved_count / top_score / sufficient` |
| `rerank` | 调用 DashScope rerank，截取 `RETRIEVAL_TOP_K`；调用失败降级为原顺序 |
| `judge_context` | 有 rerank 分看 `RERANK_MIN_SCORE`，否则看向量分；唯一的统一拒答闸门 |
| `refuse` | 置 `refused=True`，答案为固定拒答文案 |

**混合检索细节**（`app/retrieval/hybrid_retriever.py`）：

- 向量路 `cosine_distance` 升序取 `RETRIEVAL_RECALL_TOP_K`（默认 20），关键词路 `websearch_to_tsquery('simple', ...)` + `ts_rank` 降序取同样数量。
- 两路用 `asyncio.gather` 并发，**每路独立 session**：`AsyncSession` 不支持并发执行，共用会污染调用方事务。
- 任一路异常返回空列表，另一路结果照常融合。
- RRF：`score = Σ 1 / (RRF_K + rank)`，`RRF_K` 默认 60，保留两路 rank / score 与命中来源，写入引用的 `retrieval_meta`。
- 权限与元数据过滤（MIME、上传时间、文档 ID）在两路 SQL 的 `WHERE` 中完成。

**生成、校验与落库**（`ChatService.stream_answer`）：

- user 消息在图执行后单独提交，首次提问时用问题前 30 字更新会话标题。
- 非拒答路径逐 token 流式输出；`VERIFY_ANSWER_ENABLED=true` 时用 LLM 校验答案是否由引用支撑，不通过则 `verify_result.replacement_answer` 携带拒答文案，落库内容也替换为拒答。
- assistant 消息与全部引用在**同一事务**提交，保证不会出现「有消息无引用」。
- 任何阶段异常：回滚未提交部分，发 `error` 事件；已提交的 user 消息保留，便于排查与重试。

### 9.3 SSE 事件协议

事件顺序：`message_start → query_route → agent_steps → citations → token × N → [verify_result] → message_end`。拒答路径不发 `verify_result`；语义缓存命中时只发 `message_start → citations → token → message_end`。

| 事件 | 触发时机 | data 关键字段 | 前端用途 |
| --- | --- | --- | --- |
| `message_start` | 图执行完、user 消息落库后；缓存命中时立即发送 | `user_message_id`、`trace_id`、`trace_url`、`cache_hit`（仅缓存命中） | 绑定消息、展示 trace 入口与缓存标记 |
| `query_route` | 紧随 `message_start` | `route`、`query`、`rewritten_query`、`hyde_answer`、`multi_queries` | 路由调试面板 |
| `agent_steps` | 紧随 `query_route` | `steps[]`：`round`、`action`、`reason`、`route`、`query`、`retrieved_count`、`top_score`、`sufficient` | Agent 决策轨迹 |
| `citations` | 生成前 | `citations[]`：`ordinal`、`document_id`、`chunk_id`、`document_name`、`page_no`、`quote`、`score`、`retrieval_meta` | 参考资料面板，`[N]` 角标 |
| `token` | 流式生成中多次；拒答时一次性发送拒答文案 | `delta` | 增量渲染答案 |
| `verify_result` | 生成结束且开启校验 | `verified`、`reason`、`replacement_answer`（仅未通过） | 校验状态，未通过时整段替换答案 |
| `message_end` | 落库完成 | `message_id`、`refused` | 结束流、刷新会话列表 |
| `error` | 任意阶段异常 | `code`（`chat_stream_failed`）、`message` | 错误提示 |

前端使用 `@microsoft/fetch-event-source` 消费上述事件；消息头部按 `cache_hit`、`trace_id` / `trace_url` 展示「语义缓存」与 TRACE 入口，Agent 轨迹、路由快照与混合检索排名来自 `metadata` 持久化内容，刷新或恢复历史会话后仍可查看。

### 9.4 权限与数据隔离

| 用户有效标签 | SQL 过滤条件 | 结果 |
| --- | --- | --- |
| 含 `*`（如 admin 角色） | 不加条件 | 全部文档 |
| `['public', 'hr']` | `cardinality(permission_tags) = 0 OR permission_tags && ARRAY['public','hr']` | 公开文档 + 任一标签重叠的文档 |
| `[]`（无角色或角色无标签） | `cardinality(permission_tags) = 0` | 仅公开文档 |

- 有效标签 = 用户所有角色 `permission_tags` 的并集；任一角色含 `*` 直接返回 `['*']`。
- 管理员身份按**角色名 `admin`** 判定（`is_admin`），与 `*` 标签相互独立：文档列表 / 详情 / chunk 接口对管理员传 `None`（不过滤），问答检索使用标签计算结果。
- 详情、chunk、原文件下载都带权限条件查询，无权按「文档不存在」返回 404。
- 会话按 `user_id` 归属，读、写、删除别人的会话同样返回 404。
- 语义缓存的 Tag 是「排序后的权限标签串」的 SHA256，只有权限集合完全相同的用户才会共享缓存。
- 内置角色 `admin`、`user` 不可删除；管理员不能删除自己。

## 10. 前端控制台

### 10.1 页面总览

| 页面 | 关键接口 |
| --- | --- |
| 登录 | `POST /api/auth/login`、`GET /api/auth/me` |
| 知识数据看板 | `GET /api/documents`、`GET /api/health`、`GET /api/health/db` |
| 文档库 | `GET/POST /api/documents`、`PATCH /api/documents/{id}`、`GET/PUT /api/documents/{id}/thumbnail` |
| 文档详情 | `GET/DELETE /api/documents/{id}`、`POST /api/documents/{id}/reindex`、`/retry`、`GET /api/documents/{id}/file`、`/chunks` |
| 知识问答 | `POST/GET/DELETE /api/conversations*`、`POST /api/conversations/{id}/chat`（SSE） |
| 评测中心 | `GET /api/evaluations/datasets`、`GET/POST/DELETE /api/evaluations/runs*`、`PATCH /api/evaluations/items/{id}` |
| 权限管理 | `GET/POST/PATCH/DELETE /api/users*`、`GET/POST/PATCH/DELETE /api/roles*` |
| 系统状态 | `GET /api/health`、`/api/health/db`、`/api/health/cos` |

### 10.2 登录与权限

- JWT 登录页：登录后 token 存于 `localStorage`，刷新页面通过 `GET /api/auth/me` 恢复会话
- 所有受保护接口自动附加 `Authorization: Bearer <token>`；401 统一清空会话并回登录页
- 顶栏 / 看板头部展示当前账号、角色与有效权限标签，支持退出登录
- 管理员账号可从账号菜单进入「用户与角色管理」
- 用户管理：分页查看、创建、改昵称、启用/禁用、重置密码、分配角色、删除用户（不能删除自己）
- 角色管理：创建/编辑/删除自定义角色，维护文档权限标签；内置 `admin` / `user` 角色不可删除
- 文档权限：上传时设置可见范围；详情页展示并支持管理员修改标签；管理员始终可见全部文档
- 非管理员隐藏上传、重命名、重新处理、删除、评测中心等管理员入口
- 未登录访问任何业务页面都会停留在登录页；登录态失效自动退回登录页

### 10.3 知识数据看板

- 液态玻璃风格首页，包含知识脉搏、知识域趋势、洞察、榜首知识源、AI 洞察与最近沉淀
- 玻璃胶囊菜单、指标卡 3D 倾斜、共享布局详情、液态周期筛选与放大 Dock
- 日 / 周 / 月切换时数字弹簧滚动、趋势条平滑插值，不刷新页面
- 模块可原位展开为详情（Esc 返回），其余模块收起为缩略条
- **真实数据**：文档总数、可检索数、失败数与最近沉淀来自 `GET /api/documents`，健康光球来自 `GET /api/health` 与 `/api/health/db`，每 30 秒刷新
- **演示数据**：后端没有看板聚合接口，问答量、命中率、趋势、洞察等为 `src/pages/dashboard/dashboardData.ts` 中的演示数据，界面以「演示数据」标注

### 10.4 文档库

- 上传 PDF、DOCX、PPTX、XLSX、Markdown、HTML，单文件上限 50 MB
- 文档以知识卡片形式展示：首页缩略图、文件类型、状态、大小、内容版本和更新时间
- 展示最近一次 Celery 入库任务的排队 / 运行 / 失败状态与实时进度
- 上传与重新索引后，列表每 3 秒轮询任务进度
- 缩略图加载失败或后端尚未生成时，自动回退到带文件类型的渐变占位图
- 支持重命名文档：固定扩展名，校验空白名称、长度、非法字符
- 重命名弹窗可同时上传缩略图：支持 PDF、JPG、JPEG、PNG、WebP，最大 10 MB
- 拖拽或点击选择文件，上传后自动打开文档详情
- 按文档状态筛选：上传中 / 解析中 / 向量化中 / 已就绪 / 处理失败
- 分页浏览；处理中的文档会每 3 秒自动刷新状态
- 失败文档支持重新处理，处理中的文档禁止删除

### 10.5 文档详情

- **Markdown 预览**：拉取原始 `.md` 文件，由 `react-markdown` + `remark-gfm` 渲染
- **PDF / HTML 预览**：使用 iframe；HTML 在沙箱中运行，脚本不会执行
- **DOCX / PPTX / XLSX**：浏览器无法内联渲染，提供下载入口
- 展示文件大小、状态、哈希、内容版本和上传/更新时间
- **入库任务卡片**：任务类型、状态、进度条、重试次数、起止时间与失败原因
- **上传新版本 / 增量重建**：管理员可上传同 MIME 的新文件；后端按 `chunk_hash` 对齐，仅重新向量化变化 chunk，成功后版本号 +1
- **文本块**：查看切分统计、分页列表、chunk 摘要及完整内容
- 下载原始文件、重新处理失败文档、删除文档（带二次确认）

### 10.6 知识问答

- 基于已入库文档的 RAG 问答，回答通过 **SSE** 流式返回
- **语义缓存**：命中时消息头部展示「语义缓存 · 极速响应」，跳过查询路由、Agent 决策和 LLM 生成；历史消息同样保留该标记
- 支持 `message_start`、`query_route`、`agent_steps`、`citations`、`token`、`verify_result`、`message_end`、`error` 事件
- 接口限流返回 429 时统一展示「请求过于频繁」提示
- **Agentic RAG 决策轨迹**：逐轮展示 `initial` / `proceed` / `rewrite_query` / `switch_route` / `refuse` 动作、决策原因、实际 Query、召回数与 Top 语义相似度
- 支持 `original` / `rewrite` / `hyde` / `multi_query` / `rewrite_multi_query` 五种查询路由
- 支持组合路由 `rewrite_multi_query`：先把口语化或依赖上下文的问题改写为完整问题，再基于改写结果扩展多路子查询
- 组合路由在复用 `rewritten_query` 与 `multi_queries` 两个字段的同时，用「原问题 → 改写 → 多路子查询 → 合并召回」的流程条呈现执行链
- **混合检索调试**：向量语义召回 + 关键词全文召回，按 RRF 融合并由 reranker 精排；可展开查看每条引用的来源、两路排名、RRF 分数与精排分
- **答案可信度校验**：展示 `verify_result`；校验失败时用拒答替换流式答案，并显示失败原因，历史消息同样保留校验状态
- **LangSmith 链路追踪**：`message_start` 中的 `trace_id` / `trace_url` 会显示为消息头部的 TRACE 入口；配置 run URL 前缀时点击直接打开 LangSmith，否则支持复制 trace_id，历史消息同样保留
- **会话历史**：侧栏列出服务端会话、消息数与更新时间，支持切换、删除会话；刷新页面后仍可恢复当前会话
- **检索范围过滤**：按文档类型和上传日期筛选，条件随 `ChatRequest.filters` 发送给后端
- 每条 assistant 消息可展开 Agent 轨迹、路由快照和混合检索快照，查看原始问题、改写内容、HyDE 假设答案、多路子查询及排名
- Agent 轨迹、路由快照、校验结果和精排信息由后端持久化，刷新页面或恢复历史会话后仍可查看
- 侧栏展示当前 Agent 轮次、查询路由策略、最高精排分/向量匹配度柱状图与来源排行
- 回答渲染 Markdown；引用按 `ordinal` 显示，点击可打开来源文档
- 支持停止生成、新建对话、切换历史会话、Enter 发送 / Shift + Enter 换行

### 10.7 评测中心

- 从后端加载 `seed` / `smoke` 等评测集，展示数据集规模
- 发起评测 run：选择评测集、填写任务名称，后台异步执行
- 运行中自动轮询进度，完成后展示 RAGAS 指标、引用命中率、拒答准确率和首 Token/端到端延迟
- case 明细支持分页、只看 Bad Case、按 Bad Case 归因筛选
- 详情抽屉展示期望答案、实际答案、引用、检索片段元数据、Query Route / Agent Steps / Verify Result
- 支持人工覆盖 Bad Case 标记、错误分类和备注
- 支持删除评测任务

### 10.8 系统状态

- 三个独立健康检查卡片：后端 API、PostgreSQL、腾讯云 COS
- 支持单卡重试和全部刷新，展示响应耗时、检测时间和错误原因

### 10.9 前端常用脚本

```bash
npm run dev       # 启动开发服务器
npm run gen:api   # 从后端 OpenAPI 重新生成类型（需要后端运行）
npm run build     # TypeScript 类型检查 + 生产构建
npm run preview   # 预览生产构建产物
npm run lint      # Oxlint 静态检查
```

### 10.10 同步后端类型

`src/types/schema.d.ts` 由后端 OpenAPI 规范自动生成，已加入 `.gitignore`，不提交到仓库。

```bash
# 先保证后端运行在 127.0.0.1:8000
npm run gen:api
```

- 后端新增/修改接口后重新执行即可。
- `npm run build` 依赖该文件；新克隆项目或 CI 环境需要在构建前启动后端并执行 `gen:api`。
- `openapi-typescript` 当前 peer 依赖 TypeScript 5.x，因此项目 TypeScript 固定为 5.9.x。

## 11. API 一览

所有接口前缀 `/api`。权限列：公开 = 无需登录；登录 = Bearer Token；admin = 需 `admin` 角色。「限流」表示挂载 `RateLimited` 依赖（按用户、上传 / reindex / 问答共享 60 次/分钟）。完整字段以 Swagger（`/docs`）为准。

**健康检查**

| 方法 | 路径 | 权限 | 前端页面 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/health` | 公开 | 系统状态 / 看板 | 进程存活 |
| GET | `/health/db` | 公开 | 系统状态 / 看板 | `SELECT 1` |
| GET | `/health/cos` | 公开 | 系统状态 | COS 连通性；未配置返回 `not_configured` |

**认证 / 用户 / 角色**

| 方法 | 路径 | 权限 | 前端页面 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | 公开 | 登录 | 返回 `access_token`、`user`、`permission_tags`、`is_admin` |
| GET | `/auth/me` | 登录 | App 外壳 | 当前用户、有效标签、是否管理员 |
| GET | `/users` | admin | 权限管理 | 分页列表 |
| POST | `/users` | admin | 权限管理 | 创建用户并分配角色 |
| PATCH | `/users/{id}` | admin | 权限管理 | 修改昵称、状态、密码 |
| PUT | `/users/{id}/roles` | admin | 权限管理 | 全量替换角色 |
| DELETE | `/users/{id}` | admin | 权限管理 | 删除用户（不能删自己） |
| GET | `/roles` | admin | 权限管理 | 角色列表（数组，不分页） |
| POST | `/roles` | admin | 权限管理 | 创建角色 |
| PATCH | `/roles/{id}` | admin | 权限管理 | 修改描述 / 权限标签 |
| DELETE | `/roles/{id}` | admin | 权限管理 | 删除自定义角色 |

**文档**

| 方法 | 路径 | 权限 | 前端页面 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/documents` | admin + 限流 | 文档库 | **multipart**：`file`，可选 `permission_tags`（JSON 数组字符串） |
| GET | `/documents` | 登录 | 文档库 | 分页 + `status` 筛选，按权限过滤，附 `latest_task` |
| GET | `/documents/{id}` | 登录 | 文档详情 | 详情 + 最新任务 |
| PATCH | `/documents/{id}` | admin | 文档详情 | 重命名（不可改扩展名） |
| DELETE | `/documents/{id}` | admin | 文档详情 | 删除（处理中禁止） |
| POST | `/documents/{id}/retry` | admin | 文档详情 | 重试失败文档 |
| POST | `/documents/{id}/reindex` | admin + 限流 | 文档详情 | **multipart**：`file`，增量重建 |
| PATCH | `/documents/{id}/permission-tags` | admin | 文档详情 | 修改权限标签 |
| GET | `/documents/{id}/file` | 登录 | 文档详情 | 原文件；支持 `Authorization` 头或 `?token=`，`download=1` 强制下载 |
| GET | `/documents/{id}/chunks` | 登录 | 文档详情 | chunk 分页 + 统计 |
| GET | `/documents/{id}/chunks/{chunk_id}` | 登录 | 文档详情 | 单个 chunk 全文 |
| GET | `/documents/{id}/thumbnail` | 公开 | 文档库 / 详情 | WebP 缩略图（见「已知限制」） |
| PUT | `/documents/{id}/thumbnail` | admin | 文档详情 | **multipart**：PDF / JPG / PNG / WebP，<= 10 MB |

**会话问答**

| 方法 | 路径 | 权限 | 前端页面 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/conversations` | 登录 | 知识问答 | 创建会话 `{"title"}` |
| GET | `/conversations` | 登录 | 知识问答 | 当前用户会话分页，含消息数 |
| GET | `/conversations/{id}` | 登录 | 知识问答 | 会话详情与全部消息、引用 |
| DELETE | `/conversations/{id}` | 登录 | 知识问答 | 删除会话（204） |
| POST | `/conversations/{id}/chat` | 登录 + 限流 | 知识问答 | **SSE**：`{"question", "filters"}`，`filters` 支持 `mime_types`、`created_from`、`created_to`、`document_ids` |

**评测**（整个路由在 router 级挂 `get_current_admin`）

| 方法 | 路径 | 权限 | 前端页面 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/evaluations/datasets` | admin | 评测中心 | 评测集名称与条数 |
| POST | `/evaluations/runs` | admin | 评测中心 | 创建 run `{"name", "dataset_name"}`，后台执行 |
| GET | `/evaluations/runs` | admin | 评测中心 | run 分页 |
| GET | `/evaluations/runs/{id}` | admin | 评测中心 | run 详情与汇总指标 |
| DELETE | `/evaluations/runs/{id}` | admin | 评测中心 | 删除 run（级联 items） |
| GET | `/evaluations/runs/{id}/items` | admin | 评测中心 | case 分页，`bad_case_only`、`category` 筛选 |
| GET | `/evaluations/items/{id}` | admin | 评测中心 | 单条 case 详情 |
| PATCH | `/evaluations/items/{id}` | admin | 评测中心 | 人工覆盖 `is_bad_case`、`bad_case_category`、`bad_case_note` |

## 12. 评测体系

**数据集**：`app/evaluation/datasets/<name>.jsonl`，一行一个 case。仓库自带 `smoke`（5 条）和 `seed`（50 条），需先上传对应文档。

```json
{"id": "smoke_001", "question": "...", "expected_answer": "...", "expected_document_names": ["差旅管理制度.md"], "expected_keywords": ["500", "一线城市"], "should_refuse": false, "tags": ["差旅"]}
```

**生命周期**：

1. `POST /evaluations/runs` 创建 `running` 状态的 run，并通过 `BackgroundTasks` 执行 `execute_evaluation_run`。
2. 逐条调用 `ChatService.answer_for_evaluation`：完整跑图 + 生成 + 校验，**不写会话表**；每条 case 独立事务写一行 `evaluation_items` 并更新 run 进度。
3. 全部跑完后批量调用 RAGAS 计算 `faithfulness`、`answer_relevancy`、`context_precision`、`context_recall` 并回填。
4. 规则归因 + 聚合到 run：四项均值、`citation_hit_rate`、`refusal_accuracy`、`avg_latency_ms`、`avg_first_token_latency_ms`，状态置 `completed`。
5. 主流程异常时 run 置 `failed` + `error_message`，已写入的 items 保留。

**自定义指标**（`app/evaluation/scoring.py`）：

- 引用命中：任一引用的文档名在期望列表中，或任一期望关键词出现在引用原文中；`should_refuse=true` 的 case 不计算。
- 拒答正确：实际是否拒答 == 期望。

**Bad Case 归因**按「越底层越优先」依次判定，指标低于 0.5 视为低：

| 顺序 | 条件 | 归因 |
| --- | --- | --- |
| 1 | 执行异常 | `other` |
| 2 | 该拒未拒 / 不该拒却拒 | `context_judge_too_loose` / `context_judge_too_strict` |
| 3 | 引用未命中 | `embedding_recall_miss` |
| 4 | `context_recall` 低 | `embedding_recall_miss` |
| 5 | `context_precision` 低 | `rerank_order_error` |
| 6 | `faithfulness` 低 | `generation_off_context` |
| 7 | `answer_relevancy` 低 | `prompt_constraint_weak` |

`document_parse_failed`、`chunk_split_bad`、`keyword_recall_miss`、`rrf_fusion_error`、`citation_parse_failed`、`permission_filter_error` 不会被规则自动命中，留给人工通过 `PATCH /evaluations/items/{id}` 归类。传 `bad_case_category` 会自动置 `is_bad_case=true`；传 `is_bad_case=false` 会清空归因。

## 13. 可观测性与错误处理

- **LangSmith**：`configure_observability()` 在 `create_app` 时把配置同步为 `LANGSMITH_*` 环境变量；开关打开且有 Key 才真正上报，否则强制 `LANGSMITH_TRACING=false`。`ChatService.stream_answer`、`HybridRetriever.search` 等用 `@traceable` 包裹。
- **trace_id 传递**：在 root run 内读取 `trace_id`，写进 `message_start` 事件和 assistant 消息 `metadata`；配置了 `LANGSMITH_RUN_URL_PREFIX` 时额外下发 `trace_url`。读取失败返回 `None`，不影响问答。

**统一异常体**

| 异常类 | HTTP | code |
| --- | --- | --- |
| `ValidationError` | 400 | `validation_error` |
| `UnauthorizedError` | 401 | `unauthorized` |
| `PermissionDeniedError` | 403 | `permission_denied` |
| `NotFoundError` | 404 | `not_found` |
| `ConflictError` | 409 | `conflict` |
| `RateLimitedError` | 429 | `rate_limited` |
| `ConfigurationError` | 503 | `configuration_error` |
| 未捕获异常 | 500 | `internal_error`（不回传堆栈） |

```json
{"code": "not_found", "message": "文档不存在"}
```

Pydantic 请求校验失败仍是 FastAPI 默认的 422 `{"detail": [...]}` 格式；前端 `http.ts` 会把这两种形态统一成可展示的中文提示。

**日志**：`configure_logging()` 统一输出到 stdout，格式 `时间 | 级别 | logger 名 | 消息`，uvicorn 日志并入根 logger；未捕获异常、检索单路降级、rerank 降级、缓存读写失败都用 `logger.exception` 记录堆栈。

## 14. 工程细节与性能

- **限流**：Redis ZSET 滑动窗口，pipeline（`transaction=True`）原子执行 `ZREMRANGEBYSCORE → ZCARD → ZADD → EXPIRE`，key 为 `rag:rate_limit:user:<id>`，窗口 60 秒。只挂在写接口，避免列表轮询误伤。
- **语义缓存**：命中时跳过整张图和 LLM；只有「非拒答且校验通过」的答案写回。查询和写入失败都按未命中处理，只记日志。
- **连接与 session**：`create_async_engine(pool_pre_ping=True)`，`expire_on_commit=False`、`autoflush=False`。SSE 问答可能持续数十秒，使用独立 session，请求级 session 只做会话归属校验；混合检索两路各开短 session。
- **Celery 配置**：`task_acks_late=False`、`worker_prefetch_multiplier=1`、JSON 序列化、UTC。任务状态以 `ingestion_tasks` 表为准，不依赖 broker 重投；Worker 内用 `asyncio.run` 运行异步流水线。
- **CPU 密集操作**：docling 解析与缩略图生成通过 `asyncio.to_thread` 执行，手动缩略图设 90 秒超时；`DocumentConverter` 全局单例，避免重复加载模型。
- **N+1**：文档列表用 `DISTINCT ON` 批量取最新任务；`User.roles` 用 `selectin` 加载。
- **索引**：HNSW（向量）、GIN（全文）、`file_hash` 唯一、`chunk_hash`、各外键列。
- **事务边界**：上传、重试、reindex 都是「落库 → commit → 投递任务」；问答中 user 消息与「assistant 消息 + 引用」分两个事务；评测每条 case 一个事务。
- **前端轮询**：上传 / 重新索引后每 3 秒轮询任务进度，处理中的文档同样 3 秒刷新，看板真实数据每 30 秒刷新；健康检查超时 10 秒。

## 15. 常见问题与排障

| 现象 | 原因与处理 |
| --- | --- |
| 迁移报 `type "vector" does not exist` 或无权创建扩展 | 数据库未安装 pgvector，或用户没有 `CREATE EXTENSION` 权限；由 DBA 执行一次 `CREATE EXTENSION vector;` |
| Redis 报 `NOAUTH Authentication required` | 连接串缺密码，改为 `redis://:<password>@host:6379/<db>`，三个 Redis 变量都要改 |
| `uv sync` 卡在 jieba 构建或缓存目录无权限 | 必须在 `backend/` 下执行，让 `uv.toml` 生效（本地 wheel + 项目内缓存） |
| 首次解析很慢或下载失败 | docling 首次运行会从 HuggingFace 下载布局 / OCR 模型；网络受限时在 shell 环境变量中设置 `HF_ENDPOINT` 镜像（写在 `.env` 里不会被导出给 SDK）。`backend/artifacts/` 下有本机已下载的模型，代码中未显式引用该目录 |
| 文档一直 `uploading`，任务 `pending` | Worker 未启动或连不上 broker；Windows 需加 `--pool=solo` |
| 浏览器报 CORS 错误 | 将前端源加入后端 `CORS_ORIGINS`（逗号分隔）；生产环境前后端不同源时同样需要配置该变量 |
| 上传返回 400「文件超过 50 MB 上限」 | 调整 `UPLOAD_MAX_SIZE_MB`；如经反向代理，同时调整代理的请求体上限 |
| 登录返回 401「服务端未配置 JWT secret」 | 在根目录 `.env` 设置 `JWT_SECRET` 后重启 |
| Swagger 调用业务接口返回 401 | 鉴权依赖直接读取 `Authorization` 请求头，没有声明 OpenAPI security scheme，Swagger 页面没有 Authorize 按钮；用 curl / Postman 携带 `Authorization: Bearer <token>` 调试 |
| 关键词路始终无结果 | 跑 `uv run python -m scripts.backfill_content_tokens` 回填 `content_tokens` |
| `npm run gen:api` 失败 | 后端未在 `127.0.0.1:8000` 运行，或 `/openapi.json` 拉取失败；先启动后端再重试，或修改 `package.json` 中的地址 |
| `npm run build` 报找不到 `src/types/schema.d.ts` | 该文件由 `gen:api` 生成且被 gitignore；克隆后先启动后端执行 `npm run gen:api` |
| 前端请求 401 后被踢回登录页 | token 过期（默认 1440 分钟）或后端重启导致密钥变化；重新登录 |
| 看板数字与真实情况不一致 | 看板只有文档数、健康状态是实时的，问答量、命中率、趋势等为演示数据（`src/pages/dashboard/dashboardData.ts`） |
| 上传后文档一直「排队中」 | Celery Worker 未启动，或与 API 连的不是同一个 Redis，见上面「文档一直 uploading」一条 |
| 缩略图显示为渐变占位图 | 文档未生成缩略图（见「已知限制」），可在文档详情上传，或等待后端补齐 |

## 16. 已知限制与后续规划

**现状**

- 仓库没有自动化测试和 CI，也没有 Docker / K8s 编排，按单机部署描述。
- `GET /documents/{id}/thumbnail` 未接入登录与权限校验，知道文档 ID 即可读取缩略图。
- 评测跑批依赖进程内 `BackgroundTasks`：API 重启会中断执行，run 会停留在 `running`；进度只能轮询，没有推送。
- 文档删除、重命名、修改权限等管理操作没有审计日志。
- `REDIS_URL` 等连接串不会自动带密码，连接带密码的实例时需写成 `redis://:<password>@host:6379/0`。
- COS 是唯一的存储实现，未配置时上传、下载、缩略图均不可用（`/health/cos` 返回 `not_configured`）。
- 前端数据看板的问答量、命中率、趋势与洞察为演示数据，后端没有看板聚合接口。
- 前端类型与后端 OpenAPI 强绑定：`schema.d.ts` 不入库，新克隆仓库或 CI 构建前必须先启动后端生成类型。

**代码核对中发现、待修复的问题**

- `ChatService.stream_answer` 调用 `self.get_conversation(conversation_id, user_id=...)`，而方法签名是 `current_user=`，SSE 问答会抛 `TypeError`。
- `stream_answer` 在图执行结束后又调用了一次 `retrieve(state)`，覆盖了 rerank 后的 Top-K，引用与生成实际使用的是 RRF Top 20。
- Celery 入库路径（`pipeline._run_ingest` / `_make_chunk`）没有写入 `content_tokens`，也没有调用 `_attach_thumbnail`；新入库文档关键词路召回为空、没有自动缩略图，需先跑回填脚本。对应逻辑只存在于未被调用的 `ingest_document()` 中。

**建议**

- 把评测执行迁到 Celery，复用 `ingestion_tasks` 式的状态表，解决重启中断。
- 为 `rrf_fuse`、`scoring.classify_bad_case`、`_permission_where`、增量 reindex 对齐逻辑补单元测试。
- 缩略图接口复用 `/file` 的 Header / `?token=` 鉴权并带权限过滤。
- 管理操作写审计表（操作人、对象、前后值）。
- 为看板补后端聚合接口，替换演示数据；为前端补一条 `gen:api` 的前置检查脚本，减少构建失败。

## 相关文档

本 README 由 `backend/README.md` 与 `frontend/README.md` 整合而成，两份子文档继续保留，作为各端更细粒度的参考资料；如与源码有出入，以源码为准。

- 后端细节：`backend/README.md`
- 前端细节：`frontend/README.md`
- 接口定义：后端启动后的 `http://127.0.0.1:8000/docs`
