const Redis = require("ioredis");
const logger = require("../utils/logger");

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (e) => logger.error("Redis error", { error: e.message }));
redis.on("close", () => logger.warn("Redis connection closed"));

module.exports = redis;
