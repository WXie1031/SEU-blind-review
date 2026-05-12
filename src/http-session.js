const { CookieJar } = require("./cookie-jar");

class HttpSession {
  constructor(defaultHeaders = {}, timeoutMs = 30000) {
    this.defaultHeaders = defaultHeaders;
    this.timeoutMs = timeoutMs;
    this.cookieJar = new CookieJar();
  }

  async request(url, options = {}) {
    return this.requestWithRedirects(url, options, 0);
  }

  async requestWithRedirects(url, options, redirectCount) {
    const headers = new Headers({
      ...this.defaultHeaders,
      ...(options.headers || {}),
    });
    const cookieHeader = this.cookieJar.headerFor(url);
    if (cookieHeader && !headers.has("Cookie")) {
      headers.set("Cookie", cookieHeader);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`Request timed out after ${this.timeoutMs}ms`)),
      options.timeoutMs || this.timeoutMs,
    );

    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
      });
      this.cookieJar.storeFromResponse(response, url);

      if (options.redirect === "manual") {
        return response;
      }

      if (!isRedirectResponse(response.status)) {
        return response;
      }

      if (redirectCount >= 10) {
        throw new Error("Too many redirects");
      }

      const location = response.headers.get("location");
      if (!location) {
        return response;
      }

      const nextUrl = new URL(location, url).toString();
      const nextOptions = nextRedirectOptions(options, response.status);
      return this.requestWithRedirects(nextUrl, nextOptions, redirectCount + 1);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isRedirectResponse(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function nextRedirectOptions(options, status) {
  if (status === 303) {
    return {
      ...options,
      method: "GET",
      body: undefined,
    };
  }

  if ((status === 301 || status === 302) && options.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) {
    return {
      ...options,
      method: "GET",
      body: undefined,
    };
  }

  return {
    ...options,
  };
}

module.exports = {
  HttpSession,
};
