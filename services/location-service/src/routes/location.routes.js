const router = require("express").Router();
const ctrl = require("../controllers/location.controller");
const {
  authMiddleware,
  requireRole,
} = require("../middleware/auth.middleware");

// ── Driver routes ────────────────────────────────────────
// Driver pushes location every 3s — no auth needed per call for performance,
// but x-user-id header is required (injected by gateway or sent by driver app)
router.post("/update", ctrl.updateLocation);
router.post("/offline", ctrl.driverOffline);

// ── Rider / public routes ────────────────────────────────
router.get("/nearby", ctrl.getNearbyDrivers);
router.get("/driver/:driverId", ctrl.getDriverPosition);
router.get("/distance", ctrl.getDistance);

// ── Admin / internal ─────────────────────────────────────
router.get("/stats", ctrl.getStats);

module.exports = router;
