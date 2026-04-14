const walletService = require("../services/wallet.service");

// POST /api/wallet
async function createWallet(req, res, next) {
  try {
    const userId = req.user.userId;
    const wallet = await walletService.createWallet(userId);
    res.status(201).json(wallet);
  } catch (err) {
    next(err);
  }
}

// GET /api/wallet
async function getWallet(req, res, next) {
  try {
    const wallet = await walletService.getWallet(req.user.userId);
    res.json(wallet);
  } catch (err) {
    next(err);
  }
}

// GET /api/wallet/balance
// CQRS read — served from Redis cache first
async function getBalance(req, res, next) {
  try {
    const userId = req.params.userId || req.user.userId;
    const result = await walletService.getBalance(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// GET /api/wallet/transactions
async function getTransactions(req, res, next) {
  try {
    const userId = req.params.userId || req.user.userId;
    const { limit, offset, type } = req.query;
    const result = await walletService.getTransactions(userId, {
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
      type,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/wallet/debit
async function debit(req, res, next) {
  try {
    const { amount, reference, description, rideId } = req.body;
    const userId =
      req.headers["x-user-id"] || req.user?.userId || req.body.userId;

    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!amount) return res.status(400).json({ error: "amount is required" });
    if (!reference)
      return res.status(400).json({ error: "reference is required" });

    const result = await walletService.debit({
      userId,
      amount: parseFloat(amount),
      reference,
      description,
      rideId,
    });

    // 200 if already processed (idempotent), 201 if new
    res.status(result.alreadyProcessed ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/wallet/credit
async function credit(req, res, next) {
  try {
    const { amount, reference, description, rideId } = req.body;
    const userId =
      req.headers["x-user-id"] || req.user?.userId || req.body.userId;

    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!amount) return res.status(400).json({ error: "amount is required" });
    if (!reference)
      return res.status(400).json({ error: "reference is required" });

    const result = await walletService.credit({
      userId,
      amount: parseFloat(amount),
      reference,
      description,
      rideId,
    });

    res.status(result.alreadyProcessed ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/wallet/refund
async function refund(req, res, next) {
  try {
    const { amount, reference, description, rideId } = req.body;
    const userId =
      req.headers["x-user-id"] || req.user?.userId || req.body.userId;

    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!amount) return res.status(400).json({ error: "amount is required" });
    if (!reference)
      return res.status(400).json({ error: "reference is required" });

    const result = await walletService.refund({
      userId,
      amount: parseFloat(amount),
      reference,
      description,
      rideId,
    });

    res.status(result.alreadyProcessed ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/wallet/topup  (dev/admin only)
async function topUp(req, res, next) {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Valid amount required" });
    }
    const result = await walletService.topUp(
      req.user.userId,
      parseFloat(amount),
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createWallet,
  getWallet,
  getBalance,
  getTransactions,
  debit,
  credit,
  refund,
  topUp,
};
