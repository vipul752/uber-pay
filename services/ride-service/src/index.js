require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const prisma = require("./db");
const rideRoutes = require("./routes/ride.routes");
const { errorHandler } = require("./middleware/Error.middleware");
const { disconnect: disconnectKafka } = require("./kafka/producer");
const logger = require("./logger");

const app = express();
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors());
app.use(express.json());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.use("/api/rides", rideRoutes);

// Health check
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      service: "ride-service",
      db: "connected",
      uptime: Math.floor(process.uptime()),
    });
  } catch {
    res
      .status(503)
      .json({ status: "error", service: "ride-service", db: "disconnected" });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use(errorHandler);

async function start() {
  try {
    await prisma.$connect();
    logger.info("Database connected");

    app.listen(PORT, () => {
      logger.info("Ride service running", {
        port: PORT,
        env: process.env.NODE_ENV,
      });
    });
  } catch (err) {
    logger.error("Failed to start ride service", { error: err.message });
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} — shutting down`);
  await disconnectKafka();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
