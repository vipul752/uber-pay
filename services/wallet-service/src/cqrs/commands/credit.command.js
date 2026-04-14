const walletRepo = require("../../repositories/wallet.repository");
const redis = require("../../redis/client");
const { createError } = require("../../utils/errros");
const TOPICS = require("../../kafka/topics");
const logger = require("../../utils/logger");

const BALANCE_CACHE_TTL = parseInt(process.env.BALANCE_CACHE_TTL || "300");

/**
 * CREDIT command — add money to a wallet.
 *
 * Credits don't need a distributed lock because adding money
 * has no overdraft risk. We still enforce idempotency to prevent
 * duplicate credits from retried SAGA compensations or network retries.
 *
 * @param {string}  userId
 * @param {number}  amount
 * @param {string}  reference   - Idempotency key
 * @param {string}  description
 * @param {string}  [rideId]
 */
async function creditCommand({
  userId,
  amount,
  reference,
  description = "",
  rideId,
}) {
  if (!amount || parseFloat(amount) <= 0) {
    throw createError(
      "Amount must be a positive number",
      400,
      "INVALID_AMOUNT",
    );
  }

  const amountF = parseFloat(amount);

  // ── Idempotency ────────────────────────────────────────
  const existing = await walletRepo.findTransactionByReference(reference);
  if (existing) {
    logger.info("Duplicate credit request — returning cached result", {
      reference,
    });
    return { alreadyProcessed: true, transaction: existing };
  }

  // ── Load wallet ────────────────────────────────────────
  const wallet = await walletRepo.findWalletByUserId(userId);
  if (!wallet) {
    throw createError("Wallet not found", 404, "WALLET_NOT_FOUND");
  }

  const currentBalance = parseFloat(wallet.balance);
  const balanceAfter = parseFloat((currentBalance + amountF).toFixed(2));

  // ── Atomic DB transaction ──────────────────────────────
  const [, transaction] = await walletRepo.atomicCredit({
    walletId: wallet.id,
    userId,
    amount: amountF,
    balanceAfter,
    reference,
    description,
    rideId,
    outboxEvent: {
      type: TOPICS.CREDIT_APPLIED,
      payload: {
        userId,
        walletId: wallet.id,
        type: "CREDIT",
        amount: amountF,
        balanceAfter,
        reference,
        rideId,
        occurredAt: new Date().toISOString(),
      },
    },
  });

  logger.info("Credit committed", {
    userId,
    amount: amountF,
    balanceAfter,
    reference,
  });

  // ── Update CQRS cache ──────────────────────────────────
  await redis
    .setex(`balance:${userId}`, BALANCE_CACHE_TTL, balanceAfter.toFixed(2))
    .catch((e) =>
      logger.warn("Cache update skipped (non-fatal)", { error: e.message }),
    );

  return { alreadyProcessed: false, transaction, balanceAfter };
}

module.exports = { creditCommand };
