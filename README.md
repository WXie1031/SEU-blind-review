# SEU-blind-review

`catchScore` is a local web app for monitoring the SEU eHall blind review result endpoint.

It supports:

- logging in with an SEU username and password from the browser
- handling SMS second-step verification when required
- polling the blind review result endpoint every day at `12:00` and `18:00`
- showing full polling history in the UI
- recording a callback history only when `PSCJ` becomes non-null

## Features

- SEU unified authentication login flow
- support for stage-2 SMS verification
- parsing `datas.lwssjgcx.rows[*].PSCJ`
- persistent poll history
- deduplicated callback records for repeated non-null results
- CLI mode for one-off fetches and debugging

## Stack

- Node.js
- Express
- plain frontend
- local JSON persistence

## Quick Start

Install dependencies:

```powershell
npm install
```

Start the web app:

```powershell
npm run web
```

Default address:

```text
http://127.0.0.1:3050
```

## Web Flow

1. Open the homepage and enter your SEU username and password.
2. If SEU requires second-step verification, enter the SMS code in the page.
3. After login succeeds, the app immediately performs one poll.
4. The service then keeps polling every day at `12:00` and `18:00`.
5. The dashboard shows:
   - poll history: every success, empty result, and error record
   - callback history: only records where `PSCJ` is non-null

## Configuration

The default config file is `config.local.json`.

### Web

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

### Polling

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

### Auth

In web mode, `auth.username` and `auth.password` can be left empty because the user logs in from the page.

In CLI mode, fill them in directly:

```json
{
  "auth": {
    "mode": "seu-account",
    "username": "your-seu-username",
    "password": "your-seu-password"
  }
}
```

## Local Data

Runtime data is stored under `data/`:

- `data/web-state.json`: user monitor state, poll history, callback history
- `data/web-secret.json`: local encryption key for saved passwords
- `data/state.json`: CLI state

Ignored by git:

- `data/`
- `config.local.json`
- `node_modules/`

## CLI

Run once:

```powershell
npm run run
```

Debug fetch without notification:

```powershell
npm run debug
```

Run the daemon:

```powershell
npm run daemon
```

## Project Layout

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

## Verified

- SEU login can reach the blind review query endpoint
- web login API works
- `/api/history` returns saved history
- `/api/poll-now` triggers an immediate poll
- for the tested account, both `PSCJ` values were still `null` at the time of verification

## Known Limits

- this is a local deployment tool, not a hosted public service
- the browser UI depends on the local service staying online
- callback results are currently shown in the web UI only
- if you do not want locally encrypted password storage, the app can be changed to memory-only mode

## License

Apache-2.0
