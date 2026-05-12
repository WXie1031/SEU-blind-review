function createDaemonRunner(config, runOnce) {
  let lastTriggeredSlot = null;

  return async function daemon() {
    while (true) {
      const slot = currentMatchingSlot(config.schedule.timezone, config.schedule.times);
      if (slot && slot !== lastTriggeredSlot) {
        try {
          await runOnce();
        } catch (error) {
          console.error(`[daemon] ${error.message}`);
        }
        lastTriggeredSlot = slot;
      }

      await sleep(config.schedule.pollIntervalSeconds * 1000);
    }
  };
}

function currentMatchingSlot(timezone, times) {
  const now = new Date();
  const zoned = formatZoned(now, timezone);
  const time = `${zoned.hour}:${zoned.minute}`;

  if (!times.includes(time)) {
    return null;
  }

  return `${zoned.year}-${zoned.month}-${zoned.day} ${time}`;
}

function formatZoned(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return values;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createDaemonRunner,
};
