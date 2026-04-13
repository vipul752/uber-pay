const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/auth.controller");
const {
  authMiddleware,
  requireRole,
} = require("../middleware/auth.middleware");
const {
  validateRegister,
  validateLogin,
  validateUpdateProfile,
  validateChangePassword,
} = require("../middleware/auth.middleware");

// Rate limit login/register to prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Public routes (no auth needed) ──────────────────────
router.post("/register", authLimiter, validateRegister, ctrl.register);
router.post("/login", authLimiter, validateLogin, ctrl.login);
router.post("/verify-token", ctrl.verifyToken);

// ── Protected routes (JWT required) ─────────────────────
router.get("/me", authMiddleware, ctrl.getMe);
router.patch("/me", authMiddleware, validateUpdateProfile, ctrl.updateMe);
router.post(
  "/change-password",
  authMiddleware,
  validateChangePassword,
  ctrl.changePassword,
);

// ── Driver-only routes ───────────────────────────────────
router.post(
  "/driver/online",
  authMiddleware,
  requireRole("driver"),
  ctrl.setOnline,
);

// ── Internal route (called by other microservices) ───────
// In production: protect with internal API key header
router.get("/:id", ctrl.getUserById);

module.exports = router;
