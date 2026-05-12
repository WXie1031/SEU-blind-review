const crypto = require("crypto");
const { HttpSession } = require("./http-session");

class Stage2RequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "Stage2RequiredError";
    this.code = "STAGE2_REQUIRED";
  }
}

async function fetchBlindReviewRows(config) {
  const session = new HttpSession({}, config.poller.timeoutMs);

  if (config.auth.mode === "seu-account") {
    await loginWithSeuAccount(session, config.auth, config.poller.targetUrl);
  }

  const response = await session.request(config.poller.targetUrl, {
    method: config.poller.method,
    headers: config.poller.headers,
    body: buildRequestBody(config.poller),
    redirect: "follow",
  });

  const text = await response.text();
  const payload = parseJson(text, "Poll endpoint did not return valid JSON");
  const rows = payload?.datas?.lwssjgcx?.rows;

  if (!Array.isArray(rows)) {
    throw new Error("Response does not contain datas.lwssjgcx.rows");
  }

  return {
    status: response.status,
    rows,
    payload,
  };
}

async function loginWithSeuAccount(session, authConfig, targetUrl) {
  const captchaCheck = await session.request(`${authConfig.baseUrl}/casback/needCaptcha`, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
    },
  });
  const captchaData = parseJson(
    await captchaCheck.text(),
    "SEU needCaptcha response was not valid JSON",
  );

  if (captchaData.code === 4000) {
    throw new Error("SEU auth currently requires a captcha. This flow is not automated.");
  }

  let keyData = await fetchSeuChiperKey(session, authConfig);
  let loginData = await performSeuCasLogin(session, authConfig, keyData.publicKey, "");

  if (loginData.code === 502) {
    let stage2Message = loginData.info || "SEU auth requires second-stage verification.";
    if (authConfig.autoSendStage2Code) {
      const stage2Data = await sendSeuStage2Code(session, authConfig);
      if (stage2Data.code !== 200) {
        throw new Error(
          `SEU auth requires second-stage verification, but sending the code failed: ${stage2Data.info || "unknown error"}`,
        );
      }
      stage2Message = stage2Data.info || stage2Message;
    }

    if (!authConfig.stage2Code) {
      throw new Stage2RequiredError(stage2Message);
    }

    keyData = await fetchSeuChiperKey(session, authConfig);
    loginData = await performSeuCasLogin(
      session,
      authConfig,
      keyData.publicKey,
      authConfig.stage2Code,
    );
  }

  if (!(loginData.success && loginData.code === 200)) {
    throw new Error(`SEU login failed: ${loginData.info || "unknown error"}`);
  }

  await finalizeSeuRedirect(session, authConfig, loginData);
  await warmupSeuAppSession(session, targetUrl);
}

async function performSeuCasLogin(session, authConfig, publicKey, stage2Code) {
  const encryptedStage2Code = stage2Code ? encryptSeuPassword(publicKey, stage2Code) : null;
  const loginPayload = {
    service: authConfig.serviceUrl,
    username: authConfig.username,
    password: encryptSeuPassword(publicKey, authConfig.password),
    captcha: "",
    rememberMe: authConfig.rememberMe,
    loginType: "account",
    wxcode: null,
    wxBinded: null,
    agentId: null,
    mobilePhoneNum: "",
    mobileVerifyCode: encryptedStage2Code || "",
    fingerPrint: authConfig.fingerprint || buildFingerprint(authConfig.username),
  };

  const loginResponse = await session.request(`${authConfig.baseUrl}/casback/casLogin`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(loginPayload),
  });

  return parseJson(await loginResponse.text(), "SEU casLogin response was not valid JSON");
}

async function fetchSeuChiperKey(session, authConfig) {
  const keyResponse = await session.request(`${authConfig.baseUrl}/casback/getChiperKey`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const keyData = parseJson(
    await keyResponse.text(),
    "SEU getChiperKey response was not valid JSON",
  );

  if (!keyData.success || !keyData.publicKey) {
    throw new Error(`SEU getChiperKey failed: ${keyData.info || "unknown error"}`);
  }

  return keyData;
}

async function sendSeuStage2Code(session, authConfig) {
  const response = await session.request(`${authConfig.baseUrl}/casback/sendStage2Code`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: authConfig.username,
    }),
  });

  return parseJson(await response.text(), "SEU sendStage2Code response was not valid JSON");
}

async function finalizeSeuRedirect(session, authConfig, loginData) {
  if (!loginData.redirectUrl) {
    return;
  }

  const redirectUrl = `${authConfig.baseUrl}/casback/loginRedirect?redirectUrl=${loginData.redirectUrl}`;
  await session.request(redirectUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
}

async function warmupSeuAppSession(session, targetUrl) {
  const appEntryUrl = deriveSeuAppEntryUrl(targetUrl);
  if (!appEntryUrl) {
    return;
  }

  await session.request(appEntryUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
}

function deriveSeuAppEntryUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const match = parsed.pathname.match(/^\/gsapp\/sys\/([^/]+)\//);
    if (!match) {
      return null;
    }
    return `${parsed.origin}/gsapp/sys/${match[1]}/*default/index.do`;
  } catch {
    return null;
  }
}

function buildRequestBody(pollerConfig) {
  if (pollerConfig.method === "GET" || pollerConfig.method === "HEAD") {
    return undefined;
  }

  switch (pollerConfig.bodyType) {
    case "none":
      return undefined;
    case "json":
      return JSON.stringify(pollerConfig.body || {});
    case "form":
      return new URLSearchParams(objectToStringMap(pollerConfig.body || {}));
    case "raw":
      return pollerConfig.rawBody || "";
    default:
      throw new Error(`Unsupported poller.bodyType: ${pollerConfig.bodyType}`);
  }
}

function buildFingerprint(username) {
  return crypto.createHash("sha256").update(`catchScore:${username}`).digest("hex");
}

function encryptSeuPassword(publicKey, password) {
  const normalized = publicKey.replace(/_/g, "/").replace(/-/g, "+");
  const pem = [
    "-----BEGIN PUBLIC KEY-----",
    ...(normalized.match(/.{1,64}/g) || [normalized]),
    "-----END PUBLIC KEY-----",
  ].join("\n");

  return crypto
    .publicEncrypt(
      {
        key: pem,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(password, "utf8"),
    )
    .toString("base64");
}

function objectToStringMap(input) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, value == null ? "" : String(value)]),
  );
}

function parseJson(text, message) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${message}. Raw response: ${text.slice(0, 500)}`);
  }
}

function isStage2RequiredError(error) {
  return error instanceof Stage2RequiredError || error?.code === "STAGE2_REQUIRED";
}

module.exports = {
  Stage2RequiredError,
  fetchBlindReviewRows,
  isStage2RequiredError,
};
