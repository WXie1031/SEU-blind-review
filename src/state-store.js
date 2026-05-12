const fs = require("fs");
const path = require("path");

function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

function saveState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
}

module.exports = {
  loadState,
  saveState,
};
