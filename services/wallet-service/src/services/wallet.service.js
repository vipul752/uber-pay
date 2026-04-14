const walletRepo = require("../repositories/wallet.repository");
const { debitCommand } = require("../cqrs/commands/debit.command");
const { creditCommand } = require("../cqrs/commands/credit.command");
const { refundCommand } = require("../cqrs/commands/refund.command");
const {
  getBalanceQuery,
  getTransactionsQuery,
} = require("../cqrs/queries/balance.query");
const { createError } = require("../utils/errros");
const logger = require("../utils/logger");

// ── Wallet management ─────────────────────────────────────

async function createWallet(userId, currency = "INR") {
  const existing = await walletRepo.findWalletByUserId(userId);
  if (existing) {
    logger.info("Wallet already exists", { userId });
    return existing;
  }
  const wallet = await walletRepo.createWallet(userId, currency);
  logger.info("Wallet created", { userId, walletId: wallet.id });
  return wallet;
}

async function getWallet(userId) {
  const wallet = await walletRepo.findWalletByUserId(userId);
  if (!wallet) throw createError("Wallet not found", 404, "WALLET_NOT_FOUND");
  return wallet;
}

// ── Commands (write side) ────────────────────────────────

async function debit({ userId, amount, reference, description, rideId }) {
  if (!reference)
    throw createError("reference is required for idempotency", 400);
  return debitCommand({ userId, amount, reference, description, rideId });
}

async function credit({ userId, amount, reference, description, rideId }) {
  if (!reference)
    throw createError("reference is required for idempotency", 400);
  return creditCommand({ userId, amount, reference, description, rideId });
}

async function refund({ userId, amount, reference, description, rideId }) {
  if (!reference)
    throw createError("reference is required for idempotency", 400);
  return refundCommand({ userId, amount, reference, description, rideId });
}

// ── Queries (read side) ───────────────────────────────────

async function getBalance(userId) {
  return getBalanceQuery(userId);
}

async function getTransactions(userId, options) {
  return getTransactionsQuery(userId, options);
}

// ── Admin top-up (used in tests / seed) ─────────────────

async function topUp(userId, amount) {
  const reference = `topup-${userId}-${Date.now()}`;
  return creditCommand({
    userId,
    amount,
    reference,
    description: "Wallet top-up",
  });
}

module.exports = {
  createWallet,
  getWallet,
  debit,
  credit,
  refund,
  getBalance,
  getTransactions,
  topUp,
};
