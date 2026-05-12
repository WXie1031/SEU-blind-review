const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { loadWebConfig } = require("./config");
const { isStage2RequiredError } = require("./poller");
const { WebMonitorService } = require("./web-monitor");
const { WebStore } = require("./web-store");

function startWebServer(options = {}) {
  const config = loadWebConfig(options.configPath || "config.local.json");
  const store = new WebStore(config);
  const monitor = new WebMonitorService(config, store);
  const app = express();
  const publicDir = path.resolve(__dirname, "..", "public");
  const sessions = new Map();
  const pendingLogins = new Map();
  let lastTriggeredSlot = null;

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const sessionId = parseCookies(req.headers.cookie || "")[config.web.sessionCookieName];
    const session = sessionId ? sessions.get(sessionId) : null;

    if (session) {
      session.lastSeenAt = Date.now();
      req.sessionUser = {
        sessionId,
        username: session.username,
      };
    } else {
      req.sessionUser = null;
    }

    req.appContext = {
      config,
      monitor,
      store,
      sessions,
      pendingLogins,
    };
    next();
  });

  app.get("/api/me", (req, res) => {
    if (!req.sessionUser) {
      res.json({
        authenticated: false,
        refreshIntervalSeconds: config.web.refreshIntervalSeconds,
      });
      return;
    }

    res.json({
      authenticated: true,
      user: store.getPublicUser(req.sessionUser.username),
      refreshIntervalSeconds: config.web.refreshIntervalSeconds,
    });
  });

  app.post("/api/login", async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      res.status(400).json({
        ok: false,
        message: "请输入 SEU 用户名和密码。",
      });
      return;
    }

    try {
      const result = await monitor.loginUser({ username, password, stage2Code: "" });
      establishSession(res, sessions, config.web.sessionCookieName, username);
      res.json({
        ok: true,
        user: result.user,
        history: monitor.getUserHistory(username).history,
        callbackHistory: monitor.getUserHistory(username).callbackHistory,
      });
    } catch (error) {
      if (isStage2RequiredError(error)) {
        const pendingToken = crypto.randomUUID();
        pendingLogins.set(pendingToken, {
          username,
          password,
          createdAt: Date.now(),
        });
        res.status(202).json({
          ok: false,
          requiresStage2: true,
          pendingToken,
          message: error.message,
        });
        return;
      }

      res.status(401).json({
        ok: false,
        message: error.message,
      });
    }
  });

  app.post("/api/verify-stage2", async (req, res) => {
    const pendingToken = String(req.body.pendingToken || "");
    const stage2Code = String(req.body.stage2Code || "").trim();

    if (!pendingToken || !stage2Code) {
      res.status(400).json({
        ok: false,
        message: "请输入验证码。",
      });
      return;
    }

    const pending = pendingLogins.get(pendingToken);
    if (!pending || isPendingLoginExpired(pending, config.web.pendingLoginTtlSeconds)) {
      pendingLogins.delete(pendingToken);
      res.status(410).json({
        ok: false,
        message: "验证码会话已过期，请重新登录。",
      });
      return;
    }

    try {
      const result = await monitor.loginUser({
        username: pending.username,
        password: pending.password,
        stage2Code,
      });
      pendingLogins.delete(pendingToken);
      establishSession(res, sessions, config.web.sessionCookieName, pending.username);
      res.json({
        ok: true,
        user: result.user,
        history: monitor.getUserHistory(pending.username).history,
        callbackHistory: monitor.getUserHistory(pending.username).callbackHistory,
      });
    } catch (error) {
      res.status(401).json({
        ok: false,
        message: error.message,
      });
    }
  });

  app.post("/api/logout", requireAuth, (req, res) => {
    sessions.delete(req.sessionUser.sessionId);
    clearSession(res, config.web.sessionCookieName);
    res.json({ ok: true });
  });

  app.get("/api/history", requireAuth, (req, res) => {
    res.json(monitor.getUserHistory(req.sessionUser.username));
  });

  app.post("/api/poll-now", requireAuth, async (req, res) => {
    try {
      const result = await monitor.pollUser(req.sessionUser.username, "manual");
      res.json({
        ok: true,
        result,
        history: monitor.getUserHistory(req.sessionUser.username).history,
        callbackHistory: monitor.getUserHistory(req.sessionUser.username).callbackHistory,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        message: error.message,
      });
    }
  });

  app.get("/", (req, res) => {
    res.type("html");
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use(express.static(publicDir));

  const server = app.listen(config.web.port, config.web.host, () => {
    console.log(`Web app listening on http://${config.web.host}:${config.web.port}`);
  });

  const timer = setInterval(async () => {
    cleanupPendingLogins(pendingLogins, config.web.pendingLoginTtlSeconds);

    const slot = currentMatchingSlot(config.schedule.timezone, config.schedule.times);
    if (!slot || slot === lastTriggeredSlot) {
      return;
    }

    lastTriggeredSlot = slot;
    try {
      await monitor.pollAllScheduledUsers();
    } catch (error) {
      console.error(`[web-scheduler] ${error.message}`);
    }
  }, config.schedule.pollIntervalSeconds * 1000);

  return {
    app,
    config,
    monitor,
    store,
    close() {
      clearInterval(timer);
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function requireAuth(req, res, next) {
  if (!req.sessionUser) {
    res.status(401).json({
      ok: false,
      message: "请先登录。",
    });
    return;
  }
  next();
}

function establishSession(res, sessions, cookieName, username) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    username,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });
  res.setHeader("Set-Cookie", buildSessionCookie(cookieName, sessionId, 30 * 24 * 60 * 60));
}

function clearSession(res, cookieName) {
  res.setHeader("Set-Cookie", buildSessionCookie(cookieName, "", 0));
}

function buildSessionCookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) {
          return [part, ""];
        }
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function cleanupPendingLogins(pendingLogins, ttlSeconds) {
  for (const [token, entry] of pendingLogins.entries()) {
    if (isPendingLoginExpired(entry, ttlSeconds)) {
      pendingLogins.delete(token);
    }
  }
}

function isPendingLoginExpired(entry, ttlSeconds) {
  return Date.now() - entry.createdAt > ttlSeconds * 1000;
}

function currentMatchingSlot(timezone, times) {
  const now = new Date();
  const zoned = formatZoned(now, timezone);
  const time = `${zoned.hour}:${zoned.minute}`;

  if (!times.includes(time)) {
    return null;
  }

  return `${zoned.year}-${zoned.month}-${zoned.day} ${time}`;
}

function formatZoned(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

module.exports = {
  startWebServer,
};
