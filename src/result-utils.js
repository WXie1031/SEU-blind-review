function normalizePscj(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function displayResult(value) {
  return value == null ? "未出" : value;
}

function buildDecision(logic, rows, state = {}, timestamp = new Date().toISOString()) {
  const results = rows.map((row) => normalizePscj(row?.PSCJ));
  const hasResult = results.some((value) => value !== null);
  const signature = JSON.stringify(results);

  if (hasResult) {
    return {
      type: "result",
      message: `盲审结果已出：${results.map((value) => displayResult(value)).join("；")}`,
      results,
      signature,
      shouldNotify:
        !logic.dedupeResultNotifications || state.lastResultSignature !== signature,
      timestamp,
    };
  }

  if (logic.notifyOnlyWhenResultExists || !logic.notifyEmptyResult) {
    return {
      type: "waiting",
      message: "盲审结果还未获取，请耐心等待",
      results,
      signature,
      shouldNotify: false,
      timestamp,
    };
  }

  return {
    type: "waiting",
    message: "盲审结果还未获取，请耐心等待",
    results,
    signature,
    shouldNotify: logic.notifyEmptyEveryTime || state.lastEmptySignature !== signature,
    timestamp,
  };
}

function summarizeRows(rows) {
  return rows.map(
    (row, index) => `row${index + 1}.PSCJ=${displayResult(normalizePscj(row?.PSCJ))}`,
  );
}

module.exports = {
  buildDecision,
  displayResult,
  normalizePscj,
  summarizeRows,
};
