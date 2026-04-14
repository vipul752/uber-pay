const walletRepo = require("../../repositories/wallet.repository");
const redis = require("../../redis/client");
const { acquireLock } = require("../../lock");
const { createError } = require("../../utils/errros");
const TOPICS = require("../../kafka/topics");
const logger = require("../../utils/logger");

const BALANCE_CACHE_TTL = parseInt(process.env.BALANCE_CACHE_TTL || "300");

/**
 * DEBIT command — the complete write path.
 *
 * Safety guarantees in order:
 *   1. Distributed lock       → only one debit at a time per wallet
 *   2. Idempotency check      → same reference = same result, no double debit
 *   3. Balance check          → no overdraft
 *   4. Atomic DB transaction  → wallet debit + ledger entry + outbox in ONE commit
 *   5. CQRS cache update      → Redis balance stays in sync for fast reads
 *   6. Lock released          → always in finally{}
 *
 * @param {string}  userId       - Wallet owner
 * @param {number}  amount       - Amount to debit (must be > 0)
 * @param {string}  reference    - Idempotency key (e.g. "ride-{rideId}-debit")
 * @param {string}  description  - Human-readable reason
 * @param {string}  [rideId]     - Optional ride association
 */
async function debitCommand({
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

  // ── Step 1: Acquire distributed lock ──────────────────
  // Prevents two simultaneous requests from both reading the same
  // balance and both thinking they can proceed (TOCTOU race condition)
  const release = await acquireLock(userId);

  try {
    // ── Step 2: Idempotency check ──────────────────────
    // If this reference was already processed, return the existing
    // transaction — client can safely retry on network failure
    const existing = await walletRepo.findTransactionByReference(reference);
    if (existing) {
      logger.info("Duplicate debit request — returning cached result", {
        reference,
      });
      return { alreadyProcessed: true, transaction: existing };
    }

    // ── Step 3: Load wallet and check balance ──────────
    const wallet = await walletRepo.findWalletByUserId(userId);
    if (!wallet) {
      throw createError("Wallet not found", 404, "WALLET_NOT_FOUND");
    }

    const currentBalance = parseFloat(wallet.balance);

    if (currentBalance < amountF) {
      throw createError(
        `Insufficient balance. Available: ₹${currentBalance.toFixed(2)}, Requested: ₹${amountF.toFixed(2)}`,
        422,
        "INSUFFICIENT_BALANCE",
      );
    }

    const balanceAfter = parseFloat((currentBalance - amountF).toFixed(2));

    // ── Step 4: Atomic DB transaction ──────────────────
    // wallet update + transaction record + outbox entry
    // committed in ONE database transaction.
    //
    // If the app crashes after commit, the outbox relay will
    // still find and publish the event → zero event loss.
    const [, transaction] = await walletRepo.atomicDebit({
      walletId: wallet.id,
      userId,
      amount: amountF,
      balanceAfter,
      reference,
      description,
      rideId,
      outboxEvent: {
        type: TOPICS.PAYMENT_COMPLETED,
        payload: {
          userId,
          walletId: wallet.id,
          type: "DEBIT",
          amount: amountF,
          balanceAfter,
          reference,
          rideId,
          transactionId: null, // filled after create
          occurredAt: new Date().toISOString(),
        },
      },
    });

    logger.info("Debit committed", {
      userId,
      amount: amountF,
      balanceAfter,
      reference,
    });

    // ── Step 5: Update CQRS read cache (best effort) ───
    // Non-fatal — if Redis is down, next GET /balance
    // will hit Postgres and repopulate automatically
    await redis
      .setex(`balance:${userId}`, BALANCE_CACHE_TTL, balanceAfter.toFixed(2))
      .catch((e) =>
        logger.warn("Cache update skipped (non-fatal)", { error: e.message }),
      );

    return { alreadyProcessed: false, transaction, balanceAfter };
  } finally {
    // ── Step 6: Always release lock ────────────────────
    await release();
  }
}

module.exports = { debitCommand };
