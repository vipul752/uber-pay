const walletRepo = require("../../repositories/wallet.repository");
const redis = require("../../redis/client");
const { createError } = require("../../utils/errros");
const logger = require("../../utils/logger");

const BALANCE_CACHE_TTL = parseInt(process.env.BALANCE_CACHE_TTL || "300");

/**
 * GET balance — CQRS read model.
 *
 * Read path:
 *   1. Check Redis cache (sub-millisecond)
 *   2. On cache miss → read Postgres + repopulate cache
 *
 * This keeps read latency < 1ms in the happy path while staying
 * consistent — the cache is always updated after every write command.
 *
 * Returns: { balance, currency, source: 'cache' | 'db' }
 */
async function getBalanceQuery(userId) {
  // ── 1. Try Redis cache first ───────────────────────────
  try {
    const cached = await redis.get(`balance:${userId}`);
    if (cached !== null) {
      logger.debug("Balance served from cache", { userId });
      return {
        userId,
        balance: parseFloat(cached),
        currency: "INR",
        source: "cache",
      };
    }
  } catch (e) {
    // Redis down — fall through to Postgres
    logger.warn("Redis unavailable — falling back to DB", { error: e.message });
  }

  // ── 2. Cache miss → read from Postgres ────────────────
  const wallet = await walletRepo.findWalletByUserId(userId);
  if (!wallet) {
    throw createError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  const balance = parseFloat(wallet.balance);

  // Repopulate cache for next request
  redis
    .setex(`balance:${userId}`, BALANCE_CACHE_TTL, balance.toFixed(2))
    .catch((e) =>
      logger.warn("Cache repopulation failed", { error: e.message }),
    );

  logger.debug("Balance served from DB", { userId });

  return {
    userId,
    balance,
    currency: wallet.currency,
    source: "db",
  };
}

/**
 * GET transaction history — always from Postgres (paginated, no cache).
 */
async function getTransactionsQuery(
  userId,
  { limit = 20, offset = 0, type } = {},
) {
  const wallet = await walletRepo.findWalletByUserId(userId);
  if (!wallet) {
    throw createError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  const { transactions, total } = await walletRepo.findTransactionsByWalletId(
    wallet.id,
    { limit, offset, type },
  );

  return {
    userId,
    transactions,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

module.exports = { getBalanceQuery, getTransactionsQuery };
