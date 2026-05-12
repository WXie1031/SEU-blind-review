# catchScore

`catchScore` 是一个本地运行的 Web 应用，用来监控东南大学 eHall 盲审结果接口，并把轮询历史和“结果已出”的回调记录展示在页面上。

当前实现的核心目标：

- 用户在页面中输入 SEU 用户名和密码登录
- 如学校触发短信二次验证，可继续输入验证码完成登录
- 系统每天 `12:00` 和 `18:00` 自动轮询盲审结果接口
- 页面展示完整轮询历史
- 仅当 `PSCJ` 出现非空值时，生成一条“回调记录”

## 功能概览

- 打通 SEU 统一认证登录链路
- 支持短信二次验证码补录
- 自动解析 `datas.lwssjgcx.rows[*].PSCJ`
- 保留每次轮询的历史记录
- 对非空结果做去重，避免同一结果重复写入回调记录
- 保留 CLI 模式，方便命令行调试和单次查询

## 技术栈

- Node.js
- Express
- 原生前端页面
- 本地 JSON 持久化

## 快速开始

安装依赖：

```powershell
npm install
```

启动 Web 应用：

```powershell
npm run web
```

默认访问地址：

```text
http://127.0.0.1:3050
```

## 页面使用流程

1. 打开首页，输入 SEU 用户名和密码。
2. 如果学校要求二次验证，页面会提示输入短信验证码。
3. 登录成功后，系统会立即执行一次轮询。
4. 后续系统会在每天 `12:00` 和 `18:00` 自动轮询。
5. 页面中会展示：
   - 轮询历史：所有成功、失败、空结果记录
   - 回调记录：只有 `PSCJ` 非空时才出现

## 配置说明

默认配置文件为 `config.local.json`。

### Web 配置

```json
{
  "web": {
    "host": "127.0.0.1",
    "port": 3050,
    "sessionCookieName": "catchscore_session",
    "historyLimit": 120,
    "pendingLoginTtlSeconds": 300,
    "refreshIntervalSeconds": 30,
    "stateFile": "./data/web-state.json",
    "secretFile": "./data/web-secret.json"
  }
}
```

### 轮询配置

```json
{
  "schedule": {
    "timezone": "Asia/Shanghai",
    "times": ["12:00", "18:00"],
    "pollIntervalSeconds": 20
  },
  "poller": {
    "targetUrl": "https://ehall.seu.edu.cn/gsapp/sys/wddbsqappseu/modules/xsbdjcsq/lwssjgcx.do"
  }
}
```

### 认证配置

Web 模式下，用户会在页面输入账号密码，因此 `auth.username` 和 `auth.password` 可以留空。

CLI 模式下如果仍想直接通过命令行轮询，需要在配置中填写：

```json
{
  "auth": {
    "mode": "seu-account",
    "username": "your-seu-username",
    "password": "your-seu-password"
  }
}
```

## 本地数据文件

项目运行过程中会在 `data/` 下生成本地数据：

- `data/web-state.json`
  - 保存用户监控状态、轮询历史、回调历史
- `data/web-secret.json`
  - 保存本地加密密钥，用于加密保存登录密码
- `data/state.json`
  - CLI 模式状态文件

`data/`、`config.local.json`、`node_modules/` 已在 `.gitignore` 中忽略。

## CLI 模式

单次轮询：

```powershell
npm run run
```

调试接口，不发送通知：

```powershell
npm run debug
```

常驻轮询：

```powershell
npm run daemon
```

## 项目结构

```text
catchScore/
├─ public/                # Web 页面
├─ src/
│  ├─ main.js             # CLI / Web 启动入口
│  ├─ web-server.js       # Web 服务与 API
│  ├─ web-monitor.js      # 登录、轮询、历史记录协调层
│  ├─ web-store.js        # 本地持久化
│  ├─ poller.js           # SEU 登录与接口查询
│  ├─ result-utils.js     # 结果解析与文案逻辑
│  └─ ...
├─ config.example.json    # 配置模板
└─ README.md
```

## 已验证状态

目前已经完成并验证：

- SEU 登录成功后可以正常访问盲审查询接口
- Web API 登录链路正常
- `/api/history` 可返回历史记录
- `/api/poll-now` 可正常触发即时轮询
- 当前实测账号下，两条 `PSCJ` 都还是 `null`

## 已知限制

- 这是本地部署工具，不是公网托管服务
- 浏览器页面依赖本机服务常驻运行
- 当前版本的“回调”展示在 Web 页面中，还没有接入短信、邮件或企业微信等外部通知渠道
- 如果不希望本地保存加密后的登录密码，需要再改成“仅内存保存”模式

## License

ISC
