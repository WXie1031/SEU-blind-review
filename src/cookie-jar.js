class CookieJar {
  constructor() {
    this.cookies = [];
  }

  storeFromResponse(response, requestUrl) {
    const sourceUrl = new URL(requestUrl);
    for (const headerValue of getSetCookieHeaders(response.headers)) {
      const parsed = parseSetCookie(headerValue, sourceUrl);
      if (!parsed) {
        continue;
      }

      this.cookies = this.cookies.filter(
        (item) =>
          !(
            item.name === parsed.name &&
            item.domain === parsed.domain &&
            item.path === parsed.path
          ),
      );
      this.cookies.push(parsed);
    }
  }

  headerFor(url) {
    const target = new URL(url);
    const now = Date.now();

    const matches = this.cookies.filter((cookie) => {
      if (cookie.expiresAt && cookie.expiresAt <= now) {
        return false;
      }
      if (cookie.secure && target.protocol !== "https:") {
        return false;
      }
      if (!domainMatches(target.hostname, cookie.domain)) {
        return false;
      }
      return target.pathname.startsWith(cookie.path);
    });

    return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const raw = headers.get("set-cookie");
  if (!raw) {
    return [];
  }

  return raw.split(/,(?=\s*[^;]+=)/);
}

function parseSetCookie(headerValue, sourceUrl) {
  const parts = headerValue.split(";").map((part) => part.trim());
  const [first, ...attributes] = parts;
  const separator = first.indexOf("=");
  if (separator <= 0) {
    return null;
  }

  const cookie = {
    name: first.slice(0, separator),
    value: first.slice(separator + 1),
    domain: sourceUrl.hostname,
    path: defaultCookiePath(sourceUrl.pathname),
    secure: false,
    expiresAt: null,
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValueParts] = attribute.split("=");
    const name = rawName.trim().toLowerCase();
    const value = rawValueParts.join("=").trim();

    if (name === "domain" && value) {
      cookie.domain = value.replace(/^\./, "").toLowerCase();
    } else if (name === "path" && value) {
      cookie.path = value;
    } else if (name === "secure") {
      cookie.secure = true;
    } else if (name === "expires" && value) {
      const expiresAt = Date.parse(value);
      if (!Number.isNaN(expiresAt)) {
        cookie.expiresAt = expiresAt;
      }
    } else if (name === "max-age" && value) {
      const maxAge = Number(value);
      if (!Number.isNaN(maxAge)) {
        cookie.expiresAt = Date.now() + maxAge * 1000;
      }
    }
  }

  return cookie;
}

function domainMatches(hostname, cookieDomain) {
  const host = hostname.toLowerCase();
  const domain = cookieDomain.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

function defaultCookiePath(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  const lastSlash = pathname.lastIndexOf("/");
  if (lastSlash <= 0) {
    return "/";
  }
  return pathname.slice(0, lastSlash);
}

module.exports = {
  CookieJar,
};
