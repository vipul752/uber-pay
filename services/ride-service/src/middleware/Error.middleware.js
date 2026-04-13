const { Prisma } = require("@prisma/client");
const logger = require("../logger");

function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.path}`, {
    message: err.message,
    status: err.status,
    code: err.code,
  });

  // Prisma: record not found
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ error: "Record not found", code: "NOT_FOUND" });
    }
    if (err.code === "P2002") {
      return res
        .status(409)
        .json({ error: "Duplicate record", code: "DUPLICATE" });
    }
  }

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
