# SEU-blind-review

`catchScore` 是一个本地运行的 Web 应用，用来监控东南大学 eHall 盲审结果接口。

当前支持：

- 在浏览器中输入 SEU 用户名和密码登录
- 如学校要求短信二次验证，可继续输入验证码完成登录
- 每天 `12:00` 和 `18:00` 自动轮询盲审结果接口
- 在页面中展示完整轮询历史
- 仅当 `PSCJ` 变为非空时，生成一条“回调记录”

## 功能概览

- 打通 SEU 统一认证登录链路
- 支持短信二次验证码补录
- 解析 `datas.lwssjgcx.rows[*].PSCJ`
- 持久化保存轮询历史
- 对重复的非空结果做去重，避免重复生成回调记录
- 保留 CLI 模式，便于单次查询和调试

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
   - 轮询历史：所有成功、空结果和失败记录
   - 回调记录：只有 `PSCJ` 非空时才会出现

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

Web 模式下，`auth.username` 和 `auth.password` 可以留空，因为用户会在页面登录。

CLI 模式下，如果想直接通过命令行轮询，需要填写：

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

运行时数据保存在 `data/` 下：

- `data/web-state.json`：用户监控状态、轮询历史、回调历史
- `data/web-secret.json`：本地加密密钥，用于加密保存登录密码
- `data/state.json`：CLI 模式状态文件

以下内容已被 git 忽略：

- `data/`
- `config.local.json`
- `node_modules/`

## CLI 模式

单次运行：

```powershell
npm run run
```

只调试接口，不发送通知：

```powershell
npm run debug
```

启动常驻轮询：

```powershell
npm run daemon
```

## 项目结构

```text
catchScore/
├─ public/
├─ src/
│  ├─ main.js
│  ├─ web-server.js
│  ├─ web-monitor.js
│  ├─ web-store.js
│  ├─ poller.js
│  ├─ result-utils.js
│  └─ ...
├─ config.example.json
└─ README.md
```

## 已验证

- SEU 登录后可以正常访问盲审查询接口
- Web 登录 API 可正常工作
- `/api/history` 可返回已保存的历史记录
- `/api/poll-now` 可触发一次即时轮询
- 对测试账号而言，验证时两条 `PSCJ` 都还是 `null`

## 已知限制

- 这是一个本地部署工具，不是公网托管服务
- 浏览器页面依赖本机服务持续运行
- 当前“回调结果”仅展示在 Web 页面中，尚未接入短信、邮件或企业微信等外部渠道
- 如果不希望本地保存加密后的登录密码，可以再改成仅内存保存模式

## License

Apache-2.0
