const state = {
  refreshIntervalSeconds: 30,
  refreshTimer: null,
  pendingToken: null,
};

const elements = {
  authPanel: document.getElementById("auth-panel"),
  dashboard: document.getElementById("dashboard"),
  loginForm: document.getElementById("login-form"),
  stage2Form: document.getElementById("stage2-form"),
  stage2Code: document.getElementById("stage2-code"),
  stage2Tip: document.getElementById("stage2-tip"),
  cancelStage2: document.getElementById("cancel-stage2"),
  pollNow: document.getElementById("poll-now"),
  logout: document.getElementById("logout"),
  notice: document.getElementById("notice"),
  dashboardTitle: document.getElementById("dashboard-title"),
  statusText: document.getElementById("status-text"),
  latestResults: document.getElementById("latest-results"),
  latestPolledAt: document.getElementById("latest-polled-at"),
  callbackCount: document.getElementById("callback-count"),
  historyBody: document.getElementById("history-body"),
  callbackList: document.getElementById("callback-list"),
};

boot();

async function boot() {
  bindEvents();
  await restoreSession();
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", handleLoginSubmit);
  elements.stage2Form.addEventListener("submit", handleStage2Submit);
  elements.cancelStage2.addEventListener("click", resetStage2State);
  elements.pollNow.addEventListener("click", handlePollNow);
  elements.logout.addEventListener("click", handleLogout);
}

async function restoreSession() {
  const data = await api("/api/me");
  state.refreshIntervalSeconds = data.refreshIntervalSeconds || 30;

  if (!data.authenticated) {
    showAuthOnly();
    return;
  }

  showDashboard(data.user);
  await refreshHistory();
  startAutoRefresh();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.loginForm);
  const payload = {
    username: String(formData.get("username") || "").trim(),
    password: String(formData.get("password") || ""),
  };

  toggleFormBusy(elements.loginForm, true);
  setNotice("正在验证 SEU 账号…", "info");

  try {
    const response = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (response.requiresStage2) {
      state.pendingToken = response.pendingToken;
      elements.stage2Tip.textContent =
        response.message || "系统已向你的 SEU 预留手机号发送验证码，请输入后继续。";
      elements.stage2Form.classList.remove("hidden");
      elements.loginForm.classList.add("hidden");
      elements.stage2Code.focus();
      setNotice("需要短信验证码，请继续完成验证。", "info");
      return;
    }

    state.pendingToken = null;
    elements.loginForm.reset();
    elements.stage2Form.reset();
    showDashboard(response.user);
    renderHistory(response.history || []);
    renderCallbacks(response.callbackHistory || []);
    setNotice("登录成功，监控已启动。", "success");
    startAutoRefresh();
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    toggleFormBusy(elements.loginForm, false);
  }
}

async function handleStage2Submit(event) {
  event.preventDefault();
  if (!state.pendingToken) {
    setNotice("验证码会话已失效，请重新登录。", "error");
    resetStage2State();
    return;
  }

  toggleFormBusy(elements.stage2Form, true);
  setNotice("正在提交验证码…", "info");

  try {
    const response = await api("/api/verify-stage2", {
      method: "POST",
      body: JSON.stringify({
        pendingToken: state.pendingToken,
        stage2Code: elements.stage2Code.value.trim(),
      }),
    });

    state.pendingToken = null;
    elements.stage2Form.reset();
    showDashboard(response.user);
    renderHistory(response.history || []);
    renderCallbacks(response.callbackHistory || []);
    setNotice("验证完成，监控已启动。", "success");
    startAutoRefresh();
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    toggleFormBusy(elements.stage2Form, false);
  }
}

async function handlePollNow() {
  toggleButtonBusy(elements.pollNow, true, "轮询中…");
  try {
    const response = await api("/api/poll-now", {
      method: "POST",
    });
    renderDashboardSummary(response.result.user);
    renderHistory(response.history || []);
    renderCallbacks(response.callbackHistory || []);
    setNotice(response.result.decision.message, "success");
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    toggleButtonBusy(elements.pollNow, false, "立即轮询");
  }
}

async function handleLogout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    setNotice(error.message, "error");
    return;
  }

  stopAutoRefresh();
  clearNotice();
  resetStage2State();
  elements.loginForm.reset();
  showAuthOnly();
}

async function refreshHistory() {
  const data = await api("/api/history");
  renderDashboardSummary(data.user);
  renderHistory(data.history || []);
  renderCallbacks(data.callbackHistory || []);
}

function renderDashboardSummary(user) {
  if (!user) {
    return;
  }

  elements.dashboardTitle.textContent = `监控状态 · ${user.username}`;
  elements.statusText.textContent = user.lastMessage || "已登录，等待轮询";
  elements.latestResults.textContent =
    Array.isArray(user.lastResults) && user.lastResults.length > 0
      ? user.lastResults.map(displayResult).join(" / ")
      : "-";
  elements.latestPolledAt.textContent = formatDateTime(user.lastPollAt);
  elements.callbackCount.textContent = String(user.callbackCount || 0);
}

function renderHistory(history) {
  if (!history.length) {
    elements.historyBody.innerHTML =
      '<tr><td colspan="5" class="empty-cell">暂无历史记录</td></tr>';
    return;
  }

  elements.historyBody.innerHTML = history
    .map((item) => {
      const statusClass =
        item.outcome === "result" ? "result" : item.outcome === "error" ? "error" : "waiting";
      const results = Array.isArray(item.results) && item.results.length
        ? item.results.map(displayResult).join(" / ")
        : "-";

      return `
        <tr>
          <td>${escapeHtml(formatDateTime(item.timestamp))}</td>
          <td><span class="source">${escapeHtml(item.source || "-")}</span></td>
          <td><span class="tag ${statusClass}">${escapeHtml(item.outcome || item.status || "-")}</span></td>
          <td>${escapeHtml(results)}</td>
          <td>${escapeHtml(item.message || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderCallbacks(callbackHistory) {
  if (!callbackHistory.length) {
    elements.callbackList.innerHTML = '<div class="empty-state">还没有产生回调记录。</div>';
    return;
  }

  elements.callbackList.innerHTML = callbackHistory
    .map(
      (item) => `
        <article class="callback-item">
          <time>${escapeHtml(formatDateTime(item.timestamp))}</time>
          <p>${escapeHtml(item.message || "-")}</p>
        </article>
      `,
    )
    .join("");
}

function showDashboard(user) {
  elements.authPanel.classList.add("hidden");
  elements.dashboard.classList.remove("hidden");
  renderDashboardSummary(user);
}

function showAuthOnly() {
  elements.dashboard.classList.add("hidden");
  elements.authPanel.classList.remove("hidden");
  elements.loginForm.classList.remove("hidden");
  elements.stage2Form.classList.add("hidden");
}

function resetStage2State() {
  state.pendingToken = null;
  elements.stage2Form.reset();
  elements.stage2Form.classList.add("hidden");
  elements.loginForm.classList.remove("hidden");
}

function startAutoRefresh() {
  stopAutoRefresh();
  state.refreshTimer = window.setInterval(async () => {
    try {
      await refreshHistory();
    } catch (error) {
      setNotice(error.message, "error");
    }
  }, state.refreshIntervalSeconds * 1000);
}

function stopAutoRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function setNotice(message, type) {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`;
}

function clearNotice() {
  elements.notice.textContent = "";
  elements.notice.className = "notice hidden";
}

function toggleFormBusy(form, busy) {
  for (const control of form.querySelectorAll("input, button")) {
    control.disabled = busy;
  }
}

function toggleButtonBusy(button, busy, busyText) {
  if (!button.dataset.label) {
    button.dataset.label = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.label;
}

function displayResult(value) {
  return value == null || value === "" ? "未出" : String(value);
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "请求失败。");
  }
  return data;
}
