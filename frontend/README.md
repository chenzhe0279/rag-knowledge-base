# RAG Knowledge Base · 前端

基于 **React 19 + TypeScript + Vite 8** 的前端工程，首页以三张状态卡片展示后端健康检查结果。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（默认 http://localhost:5173）
npm run dev
```

首页会自动请求以下三个接口，请求失败时可在卡片中单独重试：

| 卡片 | 后端接口 | 检查内容 |
| --- | --- | --- |
| 后端服务 | `GET /api/health` | FastAPI 进程与路由是否可用 |
| PostgreSQL | `GET /api/health/db` | 执行 `SELECT 1` 验证数据库连接 |
| 腾讯云 COS | `GET /api/health/cos` | 校验 COS 凭据与存储桶连通性 |

开发环境下 `/api` 请求由 Vite 代理到 `http://127.0.0.1:8000`，因此不涉及浏览器跨域。

## 启动后端

```powershell
cd ..\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

或使用 uv：

```bash
uv run uvicorn app.main:app --reload --port 8000
```

后端启动后可以访问 `http://127.0.0.1:8000/docs` 查看 Swagger 文档。

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

### 状态说明

卡片根据接口返回的 `status` 字段展示：

- `ok`：正常
- `error`：接口可访问，但依赖服务异常（例如数据库连接失败）
- `not_configured`：相关配置缺失（例如 COS 凭据未填写）
- 网络错误、非 2xx、超时（10 秒）或响应结构不合法：显示「连接失败」及具体原因

## 常用脚本

```bash
npm run dev       # 启动开发服务器
npm run build     # TypeScript 类型检查 + 生产构建
npm run preview   # 预览生产构建产物
npm run lint      # Oxlint 静态检查
```

## 目录结构

```
frontend/
├─ src/
│  ├─ api/            # 健康检查请求封装
│  ├─ components/     # 状态卡片与图标
│  ├─ data/           # 三个检查项的元数据
│  ├─ hooks/          # 并行检测与刷新逻辑
│  ├─ lib/            # 状态展示映射、格式化工具
│  ├─ types/          # 健康接口类型定义
│  ├─ App.tsx         # 首页
│  ├─ App.css
│  └─ index.css
├─ vite.config.ts     # /api 开发代理
└─ .env.example
```
