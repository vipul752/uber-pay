const router = require("express").Router();
const ctrl = require("../controllers/ride.controller");
const {
  authMiddleware,
  requireRole,
} = require("../middleware/Auth.middleware");

// ── Rider routes ─────────────────────────────────────────

// Any authenticated user can view ride history and a specific ride
router.get("/", authMiddleware, ctrl.getRideHistory);
router.get("/:rideId", authMiddleware, ctrl.getRide);

// Only riders can request a ride
router.post("/", authMiddleware, requireRole("rider"), ctrl.requestRide);

// Only rider/driver can cancel (service checks ownership)
router.post("/:rideId/cancel", authMiddleware, ctrl.cancelRide);

// ── Driver routes ────────────────────────────────────────

router.post(
  "/:rideId/accept",
  authMiddleware,
  requireRole("driver"),
  ctrl.acceptRide,
);
router.post(
  "/:rideId/start",
  authMiddleware,
  requireRole("driver"),
  ctrl.startRide,
);
router.post(
  "/:rideId/complete",
  authMiddleware,
  requireRole("driver"),
  ctrl.completeRide,
);

// ── Internal route — called by Location Service ──────────
// In production: protect with an internal API key (x-internal-key header)
router.post("/:rideId/match", ctrl.matchDriver);

module.exports = router;
