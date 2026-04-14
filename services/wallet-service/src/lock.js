const redis = require("./redis/client");
const logger = require("./utils/logger");
const { createError } = require("./utils/errros");

const LOCK_TTL_MS = parseInt(process.env.LOCK_TTL_MS || "5000");

/**
 * Acquire a Redis distributed lock for a wallet operation.
 *
 * Uses SET NX PX — a single atomic command:
 *   SET key value NX    → only set if key does NOT exist
 *              PX ttl   → auto-expire after ttl ms (safety net if process crashes)
 *
 * Returns a release() function. Call it in a finally{} block — always.
 *
 * @param {string} userId  - The wallet owner's ID
 * @returns {Function}     - release() async function
 * @throws 409             - if lock is already held by another request
 */
async function acquireLock(userId) {
  const lockKey = `lock:wallet:${userId}`;
  // Unique token per lock acquisition — prevents a slow process from
  // releasing a lock that has already expired and been taken by another
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;

  const acquired = await redis.set(lockKey, token, "NX", "PX", LOCK_TTL_MS);

  if (!acquired) {
    logger.warn("Lock contention", { userId, lockKey });
    throw createError(
      "Another request is processing this wallet. Please retry.",
      409,
      "LOCK_CONTENTION",
    );
  }

  logger.debug("Lock acquired", { userId, lockKey });

  // Return a release function that checks token ownership before deleting
  // This prevents releasing a lock we no longer own (e.g. if TTL expired
  // and another process acquired it)
  const release = async () => {
    try {
      const current = await redis.get(lockKey);
      if (current === token) {
        await redis.del(lockKey);
        logger.debug("Lock released", { userId, lockKey });
      } else {
        logger.warn("Lock already expired or taken — skipping release", {
          userId,
        });
      }
    } catch (err) {
      logger.error("Failed to release lock", { userId, error: err.message });
    }
  };

  return release;
}

module.exports = { acquireLock };
