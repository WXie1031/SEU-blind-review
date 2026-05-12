const fs = require("fs");
const path = require("path");

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function loadConfig(configPath) {
  return loadConfigInternal(configPath, { requireAuthCredentials: true });
}

function loadWebConfig(configPath) {
  return loadConfigInternal(configPath, { requireAuthCredentials: false });
}

function loadConfigInternal(configPath, options) {
  const resolvedPath = path.resolve(configPath || "config.local.json");
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return normalizeConfig(raw, resolvedPath, options);
}

function normalizeConfig(raw, configPath, options = {}) {
  const configDir = path.dirname(configPath);
  const poller = raw.poller || {};
  const targetUrl = poller.targetUrl;

  if (!targetUrl) {
    throw new Error("config.poller.targetUrl is required");
  }

  const method = String(poller.method || "POST").toUpperCase();
  const auth = normalizeAuth(raw.auth || {}, targetUrl, options);
  const logic = {
    notifyEmptyResult: raw.logic?.notifyEmptyResult !== false,
    notifyEmptyEveryTime: raw.logic?.notifyEmptyEveryTime !== false,
    notifyOnlyWhenResultExists: raw.logic?.notifyOnlyWhenResultExists === true,
    dedupeResultNotifications: raw.logic?.dedupeResultNotifications !== false,
    notifyErrors: raw.logic?.notifyErrors === true,
  };
  const schedule = {
    timezone: raw.schedule?.timezone || "Asia/Shanghai",
    times: normalizeTimes(raw.schedule?.times || ["12:00", "18:00"]),
    pollIntervalSeconds: normalizePositiveInteger(raw.schedule?.pollIntervalSeconds, 20),
  };
  const web = normalizeWebConfig(raw.web || {}, configDir);

  return {
    configPath,
    stateFile: path.resolve(configDir, raw.stateFile || "./data/state.json"),
    auth,
    logic,
    schedule,
    web,
    poller: {
      targetUrl,
      method,
      headers: normalizeHeaders(poller.headers, targetUrl),
      bodyType: poller.bodyType || "json",
      body: poller.body ?? {},
      rawBody: poller.rawBody ?? "",
      timeoutMs: normalizePositiveInteger(poller.timeoutMs, 30000),
    },
    notifications: Array.isArray(raw.notifications)
      ? raw.notifications
      : [{ type: "console" }],
  };
}

function normalizeAuth(auth, targetUrl, options) {
  const mode = auth.mode || "none";
  const baseUrl = auth.baseUrl || "https://auth.seu.edu.cn/auth";
  const serviceUrl = auth.serviceUrl || deriveSeuServiceUrl(targetUrl);

  if (
    options.requireAuthCredentials !== false &&
    mode === "seu-account" &&
    (!auth.username || !auth.password)
  ) {
    throw new Error("SEU auth mode requires auth.username and auth.password");
  }

  return {
    mode,
    baseUrl,
    username: auth.username || "",
    password: auth.password || "",
    stage2Code: auth.stage2Code || "",
    autoSendStage2Code: auth.autoSendStage2Code !== false,
    serviceUrl,
    rememberMe: auth.rememberMe === true,
    fingerprint: auth.fingerprint || "catchScore-monitor",
  };
}

function normalizeWebConfig(web, configDir) {
  return {
    host: web.host || "127.0.0.1",
    port: normalizePositiveInteger(web.port, 3050),
    sessionCookieName: web.sessionCookieName || "catchscore_session",
    historyLimit: normalizePositiveInteger(web.historyLimit, 120),
    pendingLoginTtlSeconds: normalizePositiveInteger(web.pendingLoginTtlSeconds, 300),
    refreshIntervalSeconds: normalizePositiveInteger(web.refreshIntervalSeconds, 30),
    stateFile: path.resolve(configDir, web.stateFile || "./data/web-state.json"),
    secretFile: path.resolve(configDir, web.secretFile || "./data/web-secret.json"),
  };
}

function deriveSeuServiceUrl(targetUrl) {
  const parsed = new URL(targetUrl);
  if (parsed.protocol === "https:" && parsed.hostname === "ehall.seu.edu.cn") {
    parsed.protocol = "http:";
    return parsed.toString();
  }
  return targetUrl;
}

function normalizeHeaders(headers, targetUrl) {
  const parsed = new URL(targetUrl);
  const defaults = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: parsed.origin,
    Referer: deriveReferer(targetUrl),
    "User-Agent": DEFAULT_UA,
    "X-Requested-With": "XMLHttpRequest",
  };
  return { ...defaults, ...(headers || {}) };
}

function deriveReferer(targetUrl) {
  const parsed = new URL(targetUrl);
  const match = parsed.pathname.match(/^\/gsapp\/sys\/([^/]+)\//);
  if (!match) {
    return parsed.origin;
  }
  return `${parsed.origin}/gsapp/sys/${match[1]}/*default/index.do`;
}

function normalizeTimes(times) {
  if (!Array.isArray(times) || times.length === 0) {
    throw new Error("config.schedule.times must be a non-empty array");
  }

  return times.map((time) => {
    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new Error(`Invalid time value: ${time}`);
    }
    return time;
  });
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }
  return number;
}

module.exports = {
  DEFAULT_UA,
  loadConfig,
  loadWebConfig,
};
