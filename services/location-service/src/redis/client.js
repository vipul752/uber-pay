const Redis = require("ioredis");
const logger = require("../utils/logger");

// Primary client — used for GEOADD, GEOSEARCH, SET, GET, PUBLISH
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Subscriber client — used exclusively for SUBSCRIBE / PSUBSCRIBE.
// A Redis client in subscribe mode can ONLY do pub/sub commands —
// any other command (GEOADD, GET, etc.) will throw an error.
// This is why we need a SEPARATE client for subscribing.
const subscriber = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  },
);

redis.on("connect", () => logger.info("Redis (primary) connected"));
redis.on("error", (e) =>
  logger.error("Redis (primary) error", { error: e.message }),
);

subscriber.on("connect", () => logger.info("Redis (subscriber) connected"));
subscriber.on("error", (e) =>
  logger.error("Redis (subscriber) error", { error: e.message }),
);

module.exports = { redis, subscriber };
