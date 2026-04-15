require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { redis, subscriber } = require("./redis/client");
const locationRoutes = require("./routes/location.routes");
const {
  initSocketHandlers,
  getSocketStats,
} = require("./socket/location.socket");
const { startConsumer, stopConsumer } = require("./kafka/consumer");
const { errorHandler } = require("./middleware/error.middleware");
const geoService = require("./services/geohash.service");
const logger = require("./utils/logger");

const app = express();
const server = http.createServer(app); // raw http.Server wraps Express
const PORT = process.env.PORT || 3004;

// ── Socket.io setup ──────────────────────────────────────
// Attach Socket.io to the same HTTP server so both HTTP and WebSocket
// run on a single port — simpler infra, single load balancer rule
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Ping every 25s, disconnect after 60s of no response
  pingTimeout: 60000,
  pingInterval: 25000,
  // Allow both websocket and long-polling transports
  transports: ["websocket", "polling"],
});

// ── Global HTTP middleware ───────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ── HTTP Routes ──────────────────────────────────────────
app.use("/api/location", locationRoutes);

// Health check — includes Redis ping and WebSocket stats
app.get("/health", async (req, res) => {
  try {
    const redisPing = await redis.ping();
    const socketStats = getSocketStats();
    const onlineDrivers = await geoService.getOnlineDriverCount();

    res.json({
      status: "ok",
      service: "location-service",
      redis: redisPing === "PONG" ? "connected" : "error",
      onlineDrivers,
      websocket: socketStats,
      uptime: Math.floor(process.uptime()),
    });
  } catch (err) {
    res.status(503).json({
      status: "error",
      service: "location-service",
      error: err.message,
    });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use(errorHandler);

// ── Boot ─────────────────────────────────────────────────
async function start() {
  try {
    // 1. Verify Redis is reachable
    await redis.ping();
    logger.info("Redis connected");

    // 2. Attach Socket.io handlers + Redis pub/sub bridge
    initSocketHandlers(io);

    // 3. Start Kafka consumer (inject geoService to avoid circular imports)
    await startConsumer(geoService);

    // 4. Start HTTP + WebSocket server
    server.listen(PORT, () => {
      logger.info("Location service running", {
        port: PORT,
        env: process.env.NODE_ENV,
        note: "HTTP and WebSocket on same port",
      });
    });
  } catch (err) {
    logger.error("Failed to start location service", { error: err.message });
    process.exit(1);
  }
}

// ── Graceful shutdown ────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);

  // Stop accepting new connections
  server.close(async () => {
    try {
      await stopConsumer();
      await subscriber.quit();
      await redis.quit();
      logger.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error("Error during shutdown", { error: err.message });
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
