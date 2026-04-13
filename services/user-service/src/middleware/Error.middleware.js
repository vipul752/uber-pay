const { Prisma } = require("@prisma/client");

function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    message: err.message,
    code: err.code,
    status: err.status,
  });

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({
        error: "A record with this value already exists",
        code: "DUPLICATE_ENTRY",
        field: err.meta?.target,
      });
    }

    if (err.code === "P2025") {
      return res.status(404).json({
        error: "Record not found",
        code: "NOT_FOUND",
      });
    }
  }

  if (err.status) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code || "ERROR",
    });
  }

  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
  });
}

module.exports = { errorHandler };
