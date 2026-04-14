const prisma = require("../../db");

// ── Wallet ────────────────────────────────────────────────

async function findWalletByUserId(userId) {
  return prisma.wallet.findUnique({ where: { userId } });
}

async function findWalletById(id) {
  return prisma.wallet.findUnique({ where: { id } });
}

async function createWallet(userId, currency = "INR") {
  return prisma.wallet.create({
    data: { userId, currency },
  });
}

// ── Transactions ─────────────────────────────────────────

async function findTransactionByReference(reference) {
  return prisma.transaction.findUnique({ where: { reference } });
}

async function findTransactionsByWalletId(
  walletId,
  { limit = 20, offset = 0, type } = {},
) {
  const where = { walletId };
  if (type) where.type = type;

  const [transactions, total] = await prisma.$transaction([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { transactions, total };
}

// ── Atomic: debit wallet + create transaction + insert outbox ──
// All three in a single Prisma transaction — if any step fails,
// all are rolled back. This is the core safety guarantee.

async function atomicDebit({
  walletId,
  userId,
  amount,
  balanceAfter,
  reference,
  description,
  rideId,
  outboxEvent,
}) {
  return prisma.$transaction([
    // 1. Deduct balance
    prisma.wallet.update({
      where: { id: walletId },
      data: { balance: balanceAfter },
    }),
    // 2. Immutable ledger entry
    prisma.transaction.create({
      data: {
        walletId,
        type: "DEBIT",
        amount,
        balanceAfter,
        reference,
        description,
        rideId,
      },
    }),
    // 3. Outbox entry — guarantees event reaches Kafka even if app crashes
    prisma.outbox.create({
      data: {
        eventType: outboxEvent.type,
        payload: outboxEvent.payload,
      },
    }),
  ]);
}

async function atomicCredit({
  walletId,
  userId,
  amount,
  balanceAfter,
  reference,
  description,
  rideId,
  outboxEvent,
}) {
  return prisma.$transaction([
    prisma.wallet.update({
      where: { id: walletId },
      data: { balance: balanceAfter },
    }),
    prisma.transaction.create({
      data: {
        walletId,
        type: "CREDIT",
        amount,
        balanceAfter,
        reference,
        description,
        rideId,
      },
    }),
    prisma.outbox.create({
      data: {
        eventType: outboxEvent.type,
        payload: outboxEvent.payload,
      },
    }),
  ]);
}

async function atomicRefund({
  walletId,
  amount,
  balanceAfter,
  reference,
  description,
  rideId,
  outboxEvent,
}) {
  return prisma.$transaction([
    prisma.wallet.update({
      where: { id: walletId },
      data: { balance: balanceAfter },
    }),
    prisma.transaction.create({
      data: {
        walletId,
        type: "REFUND",
        amount,
        balanceAfter,
        reference,
        description,
        rideId,
      },
    }),
    prisma.outbox.create({
      data: {
        eventType: outboxEvent.type,
        payload: outboxEvent.payload,
      },
    }),
  ]);
}

// ── Outbox ────────────────────────────────────────────────

async function getPendingOutboxEvents(batchSize, maxAttempts) {
  return prisma.outbox.findMany({
    where: { status: "PENDING", attempts: { lt: maxAttempts } },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });
}

async function markOutboxSent(id) {
  return prisma.outbox.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
  });
}

async function markOutboxFailed(id, maxAttempts, currentAttempts) {
  return prisma.outbox.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      status: currentAttempts + 1 >= maxAttempts ? "FAILED" : "PENDING",
    },
  });
}

module.exports = {
  findWalletByUserId,
  findWalletById,
  createWallet,
  findTransactionByReference,
  findTransactionsByWalletId,
  atomicDebit,
  atomicCredit,
  atomicRefund,
  getPendingOutboxEvents,
  markOutboxSent,
  markOutboxFailed,
};
