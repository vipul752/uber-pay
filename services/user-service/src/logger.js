
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function log(level, message, meta = {}) {
  if (LEVELS[level] > LEVELS[LOG_LEVEL]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "user-service",
    message,
    ...meta,
  };

  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

const logger = {
  error: (msg, meta) => log("error", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  info: (msg, meta) => log("info", msg, meta),
  debug: (msg, meta) => log("debug", msg, meta),
};

module.exports = logger;
