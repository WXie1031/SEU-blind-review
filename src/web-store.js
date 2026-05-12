const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

class WebStore {
  constructor(config) {
    this.stateFile = config.web.stateFile;
    this.secretFile = config.web.secretFile;
    this.historyLimit = config.web.historyLimit;
    this.secretKey = loadOrCreateSecretKey(this.secretFile);
  }

  listActiveUsernames() {
    return Object.values(this.readState().users)
      .filter((user) => user.monitoringEnabled !== false && user.passwordSecret)
      .map((user) => user.username);
  }

  getUser(username) {
    return this.readState().users[username] || null;
  }

  getPublicUser(username) {
    const user = this.getUser(username);
    return user ? sanitizeUser(user) : null;
  }

  getUserPassword(username) {
    const user = this.getUser(username);
    if (!user?.passwordSecret) {
      return null;
    }
    return decryptText(this.secretKey, user.passwordSecret);
  }

  upsertUserCredentials(username, password) {
    return this.updateUser(username, (user) => ({
      ...user,
      username,
      monitoringEnabled: true,
      passwordSecret: encryptText(this.secretKey, password),
      createdAt: user.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  recordLoginSuccess(username) {
    return this.updateUser(username, (user) => ({
      ...user,
      username,
      monitoringEnabled: true,
      lastLoginAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  appendPollHistory(username, entry) {
    return this.updateUser(username, (user) => ({
      ...user,
      username,
      history: trimHistory([entry, ...(user.history || [])], this.historyLimit),
      updatedAt: new Date().toISOString(),
    }));
  }

  appendCallbackHistory(username, entry) {
    return this.updateUser(username, (user) => ({
      ...user,
      username,
      callbackHistory: trimHistory([entry, ...(user.callbackHistory || [])], this.historyLimit),
      updatedAt: new Date().toISOString(),
    }));
  }

  updatePollState(username, patch) {
    return this.updateUser(username, (user) => ({
      ...user,
      username,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  }

  updateUser(username, updater) {
    const state = this.readState();
    const current = state.users[username] || createEmptyUser(username);
    state.users[username] = normalizeUserRecord(updater(current));
    this.writeState(state);
    return state.users[username];
  }

  readState() {
    if (!fs.existsSync(this.stateFile)) {
      return createEmptyState();
    }

    const raw = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    return normalizeState(raw);
  }

  writeState(state) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(normalizeState(state), null, 2), "utf8");
  }
}

function createEmptyState() {
  return {
    version: 1,
    users: {},
  };
}

function normalizeState(raw) {
  const base = createEmptyState();
  const users = raw?.users || {};

  return {
    ...base,
    ...raw,
    users: Object.fromEntries(
      Object.entries(users).map(([username, user]) => [username, normalizeUserRecord(user)]),
    ),
  };
}

function normalizeUserRecord(user) {
  return {
    username: user.username,
    monitoringEnabled: user.monitoringEnabled !== false,
    passwordSecret: user.passwordSecret || null,
    createdAt: user.createdAt || new Date().toISOString(),
    updatedAt: user.updatedAt || new Date().toISOString(),
    lastLoginAt: user.lastLoginAt || null,
    lastPollAt: user.lastPollAt || null,
    lastPollStatus: user.lastPollStatus || null,
    lastResultSignature: user.lastResultSignature || null,
    lastEmptySignature: user.lastEmptySignature || null,
    lastCallbackSignature: user.lastCallbackSignature || null,
    lastMessage: user.lastMessage || "",
    lastResults: Array.isArray(user.lastResults) ? user.lastResults : [],
    history: Array.isArray(user.history) ? user.history : [],
    callbackHistory: Array.isArray(user.callbackHistory) ? user.callbackHistory : [],
  };
}

function createEmptyUser(username) {
  return normalizeUserRecord({
    username,
    createdAt: new Date().toISOString(),
  });
}

function trimHistory(items, limit) {
  return items.slice(0, limit);
}

function sanitizeUser(user) {
  return {
    username: user.username,
    monitoringEnabled: user.monitoringEnabled !== false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    lastPollAt: user.lastPollAt,
    lastPollStatus: user.lastPollStatus,
    lastMessage: user.lastMessage,
    lastResults: user.lastResults,
    historyCount: user.history.length,
    callbackCount: user.callbackHistory.length,
  };
}

function loadOrCreateSecretKey(secretFile) {
  if (fs.existsSync(secretFile)) {
    const raw = JSON.parse(fs.readFileSync(secretFile, "utf8"));
    if (raw?.key) {
      return Buffer.from(raw.key, "base64");
    }
  }

  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, JSON.stringify({ key: key.toString("base64") }, null, 2), "utf8");
  return key;
}

function encryptText(secretKey, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptText(secretKey, payload) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    secretKey,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

module.exports = {
  WebStore,
};
