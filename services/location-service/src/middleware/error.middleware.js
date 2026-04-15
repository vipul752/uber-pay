const logger = require("../utils/logger");

function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.path}`, {
    message: err.message,
    status: err.status,
    code: err.code,
  });

  if (err.status) {
    return res
      .status(err.status)
      .json({ error: err.message, code: err.code || "ERROR" });
  }

  res
    .status(500)
    .json({ error: "Internal server error", code: "INTERNAL_ERROR" });
}

module.exports = { errorHandler };
