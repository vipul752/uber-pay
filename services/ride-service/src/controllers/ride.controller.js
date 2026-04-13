const rideService = require("../services/ride.service");

// POST /api/rides
async function requestRide(req, res, next) {
  try {
    const {
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      pickupAddress,
      dropoffAddress,
    } = req.body;

    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return res
        .status(400)
        .json({ error: "pickup and dropoff coordinates are required" });
    }

    const ride = await rideService.requestRide({
      riderId: req.user.userId,
      pickupLat: parseFloat(pickupLat),
      pickupLng: parseFloat(pickupLng),
      dropoffLat: parseFloat(dropoffLat),
      dropoffLng: parseFloat(dropoffLng),
      pickupAddress,
      dropoffAddress,
    });

    res.status(201).json(ride);
  } catch (err) {
    next(err);
  }
}

// GET /api/rides/:rideId
async function getRide(req, res, next) {
  try {
    const ride = await rideService.getRide(req.params.rideId);
    res.json(ride);
  } catch (err) {
    next(err);
  }
}

// GET /api/rides  (rider or driver history)
async function getRideHistory(req, res, next) {
  try {
    const { limit, offset, status } = req.query;
    const result = await rideService.getRideHistory(
      req.user.userId,
      req.user.role,
      {
        limit: parseInt(limit) || 20,
        offset: parseInt(offset) || 0,
        status,
      },
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/rides/:rideId/match
// Called internally by Location Service — not exposed to riders/drivers
async function matchDriver(req, res, next) {
  try {
    const { driverId } = req.body;
    if (!driverId)
      return res.status(400).json({ error: "driverId is required" });

    const ride = await rideService.matchDriver(req.params.rideId, driverId);
    res.json(ride);
  } catch (err) {
    next(err);
  }
}

// POST /api/rides/:rideId/accept
async function acceptRide(req, res, next) {
  try {
    const ride = await rideService.acceptRide(
      req.params.rideId,
      req.user.userId,
    );
    res.json(ride);
  } catch (err) {
    next(err);
  }
}

// POST /api/rides/:rideId/start
async function startRide(req, res, next) {
  try {
    const ride = await rideService.startRide(
      req.params.rideId,
      req.user.userId,
    );
    res.json(ride);
  } catch (err) {
    next(err);
  }
}

// POST /api/rides/:rideId/complete
async function completeRide(req, res, next) {
  try {
    const { fare, distanceKm } = req.body;
    if (!fare) return res.status(400).json({ error: "fare is required" });

    const result = await rideService.completeRide(
      req.params.rideId,
      req.user.userId,
      { fare: parseFloat(fare), distanceKm },
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/rides/:rideId/cancel
async function cancelRide(req, res, next) {
  try {
    const ride = await rideService.cancelRide(
      req.params.rideId,
      req.user.userId,
    );
    res.json(ride);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requestRide,
  getRide,
  getRideHistory,
  matchDriver,
  acceptRide,
  startRide,
  completeRide,
  cancelRide,
};
