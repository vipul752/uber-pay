const prisma = require("../db");

// ── Read ─────────────────────────────────────────────────

async function findById(id) {
  return prisma.ride.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
}

async function findByRiderId(riderId, { limit = 20, offset = 0, status } = {}) {
  const where = { riderId };
  if (status) where.status = status;

  const [rides, total] = await prisma.$transaction([
    prisma.ride.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.ride.count({ where }),
  ]);

  return { rides, total };
}

async function findByDriverId(
  driverId,
  { limit = 20, offset = 0, status } = {},
) {
  const where = { driverId };
  if (status) where.status = status;

  const [rides, total] = await prisma.$transaction([
    prisma.ride.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.ride.count({ where }),
  ]);

  return { rides, total };
}

async function findActiveByDriver(driverId) {
  return prisma.ride.findFirst({
    where: {
      driverId,
      status: { in: ["MATCHED", "ACCEPTED", "IN_PROGRESS"] },
    },
  });
}

// ── Write ─────────────────────────────────────────────────

async function create({
  riderId,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  pickupAddress,
  dropoffAddress,
}) {
  return prisma.ride.create({
    data: {
      riderId,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      pickupAddress,
      dropoffAddress,
    },
  });
}

async function updateStatus(id, status, extra = {}) {
  // Also log to ride_events for full audit trail
  const [ride] = await prisma.$transaction([
    prisma.ride.update({
      where: { id },
      data: { status, ...extra },
    }),
    prisma.rideEvent.create({
      data: {
        rideId: id,
        eventType: `STATUS_CHANGED`,
        newStatus: status,
        metadata: extra,
      },
    }),
  ]);

  return ride;
}

async function assignDriver(id, driverId) {
  const [ride] = await prisma.$transaction([
    prisma.ride.update({
      where: { id },
      data: { driverId, status: "MATCHED" },
    }),
    prisma.rideEvent.create({
      data: {
        rideId: id,
        eventType: "DRIVER_ASSIGNED",
        newStatus: "MATCHED",
        actorId: driverId,
        metadata: { driverId },
      },
    }),
  ]);

  return ride;
}

async function logEvent(
  rideId,
  { eventType, oldStatus, newStatus, actorId, metadata },
) {
  return prisma.rideEvent.create({
    data: { rideId, eventType, oldStatus, newStatus, actorId, metadata },
  });
}

module.exports = {
  findById,
  findByRiderId,
  findByDriverId,
  findActiveByDriver,
  create,
  updateStatus,
  assignDriver,
  logEvent,
};
