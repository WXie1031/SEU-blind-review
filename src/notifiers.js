const { Buffer } = require("buffer");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

async function sendNotifications(notifierConfigs, event) {
  const errors = [];
  const enabledNotifiers = notifierConfigs.filter((item) => item && item.enabled !== false);

  for (const notifierConfig of enabledNotifiers) {
    try {
      await sendSingleNotification(notifierConfig, event);
    } catch (error) {
      errors.push(`[${notifierConfig.type}] ${error.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Notification failed: ${errors.join("; ")}`);
  }
}

async function sendSingleNotification(config, event) {
  switch (config.type) {
    case "console":
      console.log(event.message);
      return;
    case "webhook":
      await sendWebhook(config, event);
      return;
    case "twilio-sms":
      await sendTwilioSms(config, event);
      return;
    case "windows-msg":
      await sendWindowsMsg(config, event);
      return;
    default:
      throw new Error(`Unsupported notifier type: ${config.type}`);
  }
}

async function sendWebhook(config, event) {
  if (!config.url) {
    throw new Error("webhook.url is required");
  }

  const response = await fetch(config.url, {
    method: config.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    },
    body: JSON.stringify({
      source: "catchScore",
      ...event,
    }),
  });

  if (!response.ok) {
    throw new Error(`webhook responded ${response.status}`);
  }
}

async function sendTwilioSms(config, event) {
  if (!config.accountSid || !config.authToken || !config.from || !config.to) {
    throw new Error("twilio-sms requires accountSid, authToken, from and to");
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const body = new URLSearchParams({
    From: config.from,
    To: config.to,
    Body: event.message,
  });
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`twilio responded ${response.status}: ${text}`);
  }
}

async function sendWindowsMsg(config, event) {
  const args = [config.target || "*"];

  if (config.server) {
    args.push(`/SERVER:${config.server}`);
  }
  if (Number.isInteger(config.timeoutSeconds) && config.timeoutSeconds > 0) {
    args.push(`/TIME:${config.timeoutSeconds}`);
  }
  if (config.verbose) {
    args.push("/V");
  }
  if (config.waitForAck) {
    args.push("/W");
  }

  args.push(event.message);

  try {
    await execFileAsync("msg.exe", args, {
      timeout: config.processTimeoutMs || 10000,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(`windows-msg failed: ${detail}`);
  }
}

module.exports = {
  sendNotifications,
};
