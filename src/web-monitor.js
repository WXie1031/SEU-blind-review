const crypto = require("crypto");
const { fetchBlindReviewRows, isStage2RequiredError } = require("./poller");
const { buildDecision } = require("./result-utils");

class WebMonitorService {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.inFlightPolls = new Map();
  }

  async loginUser({ username, password, stage2Code }) {
    return this.runPollWithLock(username, async () =>
      this.executePoll({
        username,
        password,
        stage2Code,
        source: "login",
        persistCredentials: true,
      }),
    );
  }

  async pollUser(username, source = "manual") {
    return this.runPollWithLock(username, async () => {
      const password = this.store.getUserPassword(username);
      if (!password) {
        throw new Error("当前用户没有可用的已保存登录信息，请重新登录。");
      }

      return this.executePoll({
        username,
        password,
        stage2Code: "",
        source,
        persistCredentials: false,
      });
    });
  }

  async pollAllScheduledUsers() {
    const usernames = this.store.listActiveUsernames();
    const results = [];

    for (const username of usernames) {
      try {
        results.push(await this.pollUser(username, "scheduled"));
      } catch (error) {
        results.push({ username, error: error.message });
      }
    }

    return results;
  }

  getUserHistory(username) {
    const user = this.store.getUser(username);
    if (!user) {
      return {
        history: [],
        callbackHistory: [],
        user: null,
      };
    }

    return {
      history: user.history || [],
      callbackHistory: user.callbackHistory || [],
      user: this.store.getPublicUser(username),
    };
  }

  async executePoll({ username, password, stage2Code, source, persistCredentials }) {
    const timestamp = new Date().toISOString();

    try {
      const result = await fetchBlindReviewRows(
        buildRuntimePollConfig(this.config, { username, password, stage2Code }),
      );
      const userState = this.store.getUser(username) || {};
      const decision = buildDecision(this.config.logic, result.rows, userState, timestamp);
      const historyEntry = {
        id: crypto.randomUUID(),
        timestamp,
        source,
        status: "ok",
        outcome: decision.type,
        message: decision.message,
        results: decision.results,
        rows: sanitizeRows(result.rows),
      };

      if (persistCredentials) {
        this.store.upsertUserCredentials(username, password);
      }
      if (source === "login") {
        this.store.recordLoginSuccess(username);
      }
      this.store.appendPollHistory(username, historyEntry);

      const patch = {
        lastPollAt: timestamp,
        lastPollStatus: decision.type,
        lastMessage: decision.message,
        lastResults: decision.results,
        lastResultSignature:
          decision.type === "result" ? decision.signature : userState.lastResultSignature || null,
        lastEmptySignature:
          decision.type === "waiting" ? decision.signature : userState.lastEmptySignature || null,
      };

      let callbackEntry = null;
      if (decision.type === "result" && decision.shouldNotify) {
        callbackEntry = {
          id: crypto.randomUUID(),
          timestamp,
          source,
          message: decision.message,
          results: decision.results,
          historyId: historyEntry.id,
        };
        this.store.appendCallbackHistory(username, callbackEntry);
        patch.lastCallbackSignature = decision.signature;
      }

      this.store.updatePollState(username, patch);

      return {
        username,
        decision,
        historyEntry,
        callbackEntry,
        user: this.store.getPublicUser(username),
      };
    } catch (error) {
      if (!isStage2RequiredError(error) && this.store.getUser(username)) {
        const errorEntry = {
          id: crypto.randomUUID(),
          timestamp,
          source,
          status: "error",
          outcome: "error",
          message: error.message,
          results: [],
          rows: [],
        };
        this.store.appendPollHistory(username, errorEntry);
        this.store.updatePollState(username, {
          lastPollAt: timestamp,
          lastPollStatus: "error",
          lastMessage: error.message,
          lastResults: [],
        });
      }

      throw error;
    }
  }

  async runPollWithLock(username, handler) {
    if (this.inFlightPolls.has(username)) {
      return this.inFlightPolls.get(username);
    }

    const promise = handler().finally(() => {
      this.inFlightPolls.delete(username);
    });
    this.inFlightPolls.set(username, promise);
    return promise;
  }
}

function buildRuntimePollConfig(config, credentials) {
  return {
    ...config,
    auth: {
      ...config.auth,
      mode: "seu-account",
      username: credentials.username,
      password: credentials.password,
      stage2Code: credentials.stage2Code || "",
      autoSendStage2Code: true,
      fingerprint: config.auth.fingerprint || "catchScore-monitor",
    },
  };
}

function sanitizeRows(rows) {
  return rows.map((row) => ({
    PSCJ: row?.PSCJ ?? null,
    PYSMC: row?.PYSMC ?? null,
    XWSQBWID: row?.XWSQBWID ?? null,
    SWSPYWID: row?.SWSPYWID ?? null,
  }));
}

module.exports = {
  WebMonitorService,
};
