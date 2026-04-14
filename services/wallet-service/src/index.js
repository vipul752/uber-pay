require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const prisma = require("../db");
const redis = require("./lock");
const walletRoutes = require("./routes/wallet.routes");
const { errorHandler } = require("./middleware/error.middleware");
const { startOutboxRelay, stopOutboxRelay } = require("./outbox/outbox.relay");
const { disconnect: disconnectKafka } = require("./kafka/producer");
const logger = require("./utils/logger");

const app = express();
const PORT = process.env.PORT || 3003;

app.use(helmet());
app.use(cors());
app.use(express.json());
if (process.env.NODE_ENV === "development") app.use(morgan("dev"));

app.use("/api/wallet", walletRoutes);

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisPing = await redis.ping();
    res.json({
      status: "ok",
      service: "wallet-service",
      db: "connected",
      redis: redisPing === "PONG" ? "connected" : "error",
      uptime: Math.floor(process.uptime()),
    });
  } catch {
    res.status(503).json({ status: "error", service: "wallet-service" });
  }
});

app.use((req, res) =>
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }),
);
app.use(errorHandler);

async function start() {
  try {
    await prisma.$connect();
    logger.info("Database connected");
    await startOutboxRelay();
    app.listen(PORT, () =>
      logger.info("Wallet service running", { port: PORT }),
    );
  } catch (err) {
    logger.error("Failed to start", { error: err.message });
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} — shutting down`);
  await stopOutboxRelay();
  await disconnectKafka();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
