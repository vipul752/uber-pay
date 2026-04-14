const router = require("express").Router();
const ctrl = require("../controllers/wallet.controller");
const { authMiddleware } = require("../middleware/auth.middleware");

// Wallet management
router.post("/", authMiddleware, ctrl.createWallet);
router.get("/", authMiddleware, ctrl.getWallet);

// CQRS read side
router.get("/balance", authMiddleware, ctrl.getBalance);
router.get("/balance/:userId", ctrl.getBalance); // internal
router.get("/transactions", authMiddleware, ctrl.getTransactions);
router.get("/transactions/:userId", ctrl.getTransactions); // internal

// CQRS write side — called by Ride Service SAGA
router.post("/debit", ctrl.debit);
router.post("/credit", ctrl.credit);
router.post("/refund", ctrl.refund);

// Dev/admin only
router.post("/topup", authMiddleware, ctrl.topUp);

module.exports = router;
