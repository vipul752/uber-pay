const rideRepo = require("../repositories/ride.repository");
const { publish } = require("../kafka/producer");
const { runPaymentSaga } = require("../saga/Payment.saga");
const TOPICS = require("../kafka/topics");
const logger = require("../logger");

// Valid status transitions — enforced by the service layer
const VALID_TRANSITIONS = {
  REQUESTED: ["MATCHED", "CANCELLED"],
  MATCHED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

// ── Request ride ─────────────────────────────────────────

async function requestRide({
  riderId,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  pickupAddress,
  dropoffAddress,
}) {
  // Create ride in DB
  const ride = await rideRepo.create({
    riderId,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    pickupAddress,
    dropoffAddress,
  });

  // Publish event — Location Service consumes this to find nearest driver
  await publish(
    TOPICS.RIDE_REQUESTED,
    {
      rideId: ride.id,
      riderId,
      pickup: { lat: parseFloat(pickupLat), lng: parseFloat(pickupLng) },
      dropoff: { lat: parseFloat(dropoffLat), lng: parseFloat(dropoffLng) },
    },
    ride.id,
  );

  logger.info("Ride requested", { rideId: ride.id, riderId });
  return ride;
}

// ── Match driver ─────────────────────────────────────────
// Called by Location Service after GeoSearch finds best driver

async function matchDriver(rideId, driverId) {
  const ride = await getRideOrThrow(rideId);
  assertTransition(ride, "MATCHED");

  // Check driver isn't already on another active ride
  const activeRide = await rideRepo.findActiveByDriver(driverId);
  if (activeRide && activeRide.id !== rideId) {
    throw createError("Driver is already on an active ride", 409);
  }

  const updated = await rideRepo.assignDriver(rideId, driverId);

  await publish(
    TOPICS.RIDE_MATCHED,
    { rideId, driverId, riderId: ride.riderId },
    rideId,
  );

  logger.info("Driver matched", { rideId, driverId });
  return updated;
}

// ── Driver accepts ───────────────────────────────────────

async function acceptRide(rideId, driverId) {
  const ride = await getRideOrThrow(rideId);
  assertDriverOwns(ride, driverId);
  assertTransition(ride, "ACCEPTED");

  const updated = await rideRepo.updateStatus(rideId, "ACCEPTED", {
    acceptedAt: new Date(),
  });

  await publish(
    TOPICS.RIDE_ACCEPTED,
    { rideId, driverId, riderId: ride.riderId },
    rideId,
  );

  logger.info("Ride accepted", { rideId, driverId });
  return updated;
}

// ── Driver starts ride ───────────────────────────────────

async function startRide(rideId, driverId) {
  const ride = await getRideOrThrow(rideId);
  assertDriverOwns(ride, driverId);
  assertTransition(ride, "IN_PROGRESS");

  const updated = await rideRepo.updateStatus(rideId, "IN_PROGRESS", {
    startedAt: new Date(),
  });

  await publish(
    TOPICS.RIDE_STARTED,
    { rideId, driverId, riderId: ride.riderId },
    rideId,
  );

  logger.info("Ride started", { rideId, driverId });
  return updated;
}

// ── Complete ride — triggers SAGA ────────────────────────

async function completeRide(rideId, driverId, { fare, distanceKm }) {
  const ride = await getRideOrThrow(rideId);
  assertDriverOwns(ride, driverId);
  assertTransition(ride, "COMPLETED");

  if (!fare || parseFloat(fare) <= 0) {
    throw createError("Valid fare is required to complete a ride", 400);
  }

  // Persist fare and distance before triggering SAGA
  // SAGA reads these from the DB
  await rideRepo.updateStatus(rideId, "IN_PROGRESS", {
    fare: parseFloat(fare),
    distanceKm: distanceKm ? parseFloat(distanceKm) : null,
  });

  // Fire SAGA asynchronously — don't block the driver's HTTP response
  // The rider will be notified via Kafka → Notification Service when done
  runPaymentSaga(rideId).catch((err) => {
    logger.error("Payment SAGA failed", { rideId, error: err.message });
  });

  logger.info("Ride completed — payment SAGA triggered", { rideId, fare });

  return {
    rideId,
    status: "payment_processing",
    message: "Ride ended. Payment is being processed.",
    fare,
  };
}

// ── Cancel ride ──────────────────────────────────────────

async function cancelRide(rideId, userId) {
  const ride = await getRideOrThrow(rideId);

  // Only rider or driver who owns the ride can cancel
  if (ride.riderId !== userId && ride.driverId !== userId) {
    throw createError("Not authorised to cancel this ride", 403);
  }

  assertTransition(ride, "CANCELLED");

  const updated = await rideRepo.updateStatus(rideId, "CANCELLED", {
    cancelledBy: userId,
  });

  await publish(
    TOPICS.RIDE_CANCELLED,
    {
      rideId,
      cancelledBy: userId,
      riderId: ride.riderId,
      driverId: ride.driverId,
    },
    rideId,
  );

  logger.info("Ride cancelled", { rideId, cancelledBy: userId });
  return updated;
}

// ── Get ride ─────────────────────────────────────────────

async function getRide(rideId) {
  return getRideOrThrow(rideId);
}

async function getRideHistory(userId, role, options) {
  if (role === "rider") {
    return rideRepo.findByRiderId(userId, options);
  }
  return rideRepo.findByDriverId(userId, options);
}

// ── Helpers ──────────────────────────────────────────────

async function getRideOrThrow(rideId) {
  const ride = await rideRepo.findById(rideId);
  if (!ride) throw createError("Ride not found", 404);
  return ride;
}

function assertTransition(ride, targetStatus) {
  const allowed = VALID_TRANSITIONS[ride.status] || [];
  if (!allowed.includes(targetStatus)) {
    throw createError(
      `Cannot transition from ${ride.status} to ${targetStatus}`,
      409,
    );
  }
}

function assertDriverOwns(ride, driverId) {
  if (ride.driverId !== driverId) {
    throw createError("Not authorised to perform this action on the ride", 403);
  }
}

function createError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  requestRide,
  matchDriver,
  acceptRide,
  startRide,
  completeRide,
  cancelRide,
  getRide,
  getRideHistory,
};
