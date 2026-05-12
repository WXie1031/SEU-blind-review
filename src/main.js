#!/usr/bin/env node

const { loadConfig } = require("./config");
const { sendNotifications } = require("./notifiers");
const { fetchBlindReviewRows } = require("./poller");
const { buildDecision, summarizeRows } = require("./result-utils");
const { createDaemonRunner } = require("./scheduler");
const { loadState, saveState } = require("./state-store");
const { startWebServer } = require("./web-server");

async function main() {
  const { command, configPath } = parseArgs(process.argv.slice(2));

  if (command === "web") {
    startWebServer({ configPath });
    return;
  }

  const config = loadConfig(configPath);

  if (command === "run-once") {
    await runOnce(config, { notify: true, updateState: true });
    return;
  }

  if (command === "debug-fetch") {
    await runOnce(config, { notify: false, updateState: false });
    return;
  }

  if (command === "daemon") {
    const runner = createDaemonRunner(config, () =>
      runOnce(config, { notify: true, updateState: true }),
    );
    console.log("Daemon started.");
    await runner();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

async function runOnce(config, options) {
  const state = loadState(config.stateFile);
  const startedAt = new Date().toISOString();

  try {
    const result = await fetchBlindReviewRows(config);
    const decision = buildDecision(config.logic, result.rows, state, startedAt);

    printSummary(result.rows, decision.message, options.notify);

    if (options.notify && decision.shouldNotify) {
      await sendNotifications(config.notifications, {
        type: decision.type,
        message: decision.message,
        timestamp: startedAt,
        results: decision.results,
        rows: result.rows,
      });
    }

    if (options.updateState) {
      saveState(config.stateFile, {
        ...state,
        lastRunAt: startedAt,
        lastRowsSignature: decision.signature,
        lastResultSignature:
          decision.type === "result" ? decision.signature : state.lastResultSignature,
        lastEmptySignature:
          decision.type === "waiting" && decision.shouldNotify
            ? decision.signature
            : state.lastEmptySignature,
      });
    }
  } catch (error) {
    console.error(error.message);

    if (options.notify && config.logic.notifyErrors) {
      await sendNotifications(config.notifications, {
        type: "error",
        message: `盲审结果轮询失败：${error.message}`,
        timestamp: startedAt,
        results: [],
        rows: [],
      });
    }

    throw error;
  }
}

function printSummary(rows, message, notifyEnabled) {
  console.log(`[rows] ${summarizeRows(rows).join(", ")}`);
  console.log(`[message] ${message}`);
  console.log(`[notify] ${notifyEnabled ? "enabled" : "disabled"}`);
}

function parseArgs(args) {
  const command = args[0];
  let configPath = "config.local.json";

  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--config" && args[index + 1]) {
      configPath = args[index + 1];
      index += 1;
    }
  }

  return {
    command,
    configPath,
  };
}

function printUsage() {
  console.log("Usage:");
  console.log("  node src/main.js run-once --config .\\config.local.json");
  console.log("  node src/main.js debug-fetch --config .\\config.local.json");
  console.log("  node src/main.js daemon --config .\\config.local.json");
  console.log("  node src/main.js web --config .\\config.local.json");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runOnce,
};
