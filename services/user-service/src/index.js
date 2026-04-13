require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const prisma = require("./db");
const userRoutes = require("./routes/user.routes");
const { errorHandler } = require("./middleware/Error.middleware");
const logger = require("./logger");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet()); // security headers
app.use(cors()); // allow cross-origin
app.use(express.json()); // parse JSON bodies
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.use("/api/users", userRoutes);

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      service: "user-service",
      db: "connected",
      uptime: Math.floor(process.uptime()),
    });
  } catch (err) {
    res.status(503).json({
      status: "error",
      service: "user-service",
      db: "disconnected",
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

app.use(errorHandler);

async function start() {
  try {
    await prisma.$connect();
    logger.info("Database connected");

    app.listen(PORT, () => {
      logger.info(`User service running`, {
        port: PORT,
        env: process.env.NODE_ENV,
      });
    });
  } catch (err) {
    logger.error("Failed to start user service", { error: err.message });
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
