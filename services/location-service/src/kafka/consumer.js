const { Kafka, logLevel } = require("kafkajs");
const axios = require("axios");
const logger = require("../utils/logger");
const TOPICS = require("./topics");
const { redis } = require("../redis/client");

// geoService is injected to avoid circular dependency
let geoService = null;

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "location-service",
  brokers: (process.env.KAFKA_BROKER || "localhost:9092").split(","),
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 300, retries: 8 },
});

const consumer = kafka.consumer({ groupId: "location-service-group" });

const RIDE_SERVICE_URL =
  process.env.RIDE_SERVICE_URL || "http://localhost:3002";
const SEARCH_RADIUS_KM = parseFloat(process.env.NEARBY_SEARCH_RADIUS_KM || "5");
const MAX_DRIVERS = parseInt(process.env.NEARBY_SEARCH_MAX_DRIVERS || "5");

async function startConsumer(injectedGeoService) {
  geoService = injectedGeoService;

  await consumer.connect();
  await consumer.subscribe({
    topics: Object.values(TOPICS),
    fromBeginning: false,
  });

  await consumer.run({
    // Manual commit — only after successful processing
    autoCommit: false,

    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      let payload;
      try {
        payload = JSON.parse(message.value.toString());
      } catch {
        logger.error("Failed to parse Kafka message", { topic });
        // Commit offset to skip malformed message — don't block the partition
        await consumer.commitOffsets([
          {
            topic,
            partition,
            offset: (BigInt(message.offset) + 1n).toString(),
          },
        ]);
        return;
      }

      try {
        if (topic === TOPICS.RIDE_REQUESTED) await handleRideRequested(payload);
        if (topic === TOPICS.RIDE_COMPLETED) await handleRideEnded(payload);
        if (topic === TOPICS.RIDE_CANCELLED) await handleRideEnded(payload);

        // Commit ONLY after successful processing
        await consumer.commitOffsets([
          {
            topic,
            partition,
            offset: (BigInt(message.offset) + 1n).toString(),
          },
        ]);

        // Keep consumer session alive during slow processing
        await heartbeat();
      } catch (err) {
        logger.error("Kafka message handler failed", {
          topic,
          error: err.message,
          payload: JSON.stringify(payload),
        });
        // Don't commit — message will be redelivered after session timeout
        // In production: implement retry count + dead-letter after N failures
      }
    },
  });

  logger.info("Kafka consumer started", { topics: Object.values(TOPICS) });
}

// ── Handlers ──────────────────────────────────────────────

async function handleRideRequested({ rideId, riderId, pickup }) {
  logger.info("Ride requested — searching for drivers", { rideId, pickup });

  if (!pickup?.lat || !pickup?.lng) {
    logger.error("Missing pickup coordinates in ride.requested event", {
      rideId,
    });
    return;
  }

  // Find nearby available drivers using Redis GEOSEARCH
  const nearby = await geoService.findNearbyDrivers(
    pickup.lat,
    pickup.lng,
    SEARCH_RADIUS_KM,
    MAX_DRIVERS,
  );

  if (nearby.length === 0) {
    logger.warn("No drivers found near pickup", { rideId, pickup });
    // In production: retry after delay, or publish a "no_drivers_found" event
    return;
  }

  const bestDriver = nearby[0]; // closest available driver
  logger.info("Best driver found", {
    rideId,
    driverId: bestDriver.driverId,
    distanceKm: bestDriver.distanceKm,
  });

  // Tell Ride Service to assign this driver
  try {
    await axios.post(
      `${RIDE_SERVICE_URL}/api/rides/${rideId}/match`,
      { driverId: bestDriver.driverId },
      { timeout: 8000 },
    );

    // Store ride → driver mapping in Redis so the Socket.io layer
    // can route live location updates to the correct rider
    await redis.setex(
      `ride:${rideId}:driver`,
      3600, // 1 hour TTL
      bestDriver.driverId,
    );

    logger.info("Driver matched to ride", {
      rideId,
      driverId: bestDriver.driverId,
    });
  } catch (err) {
    logger.error("Failed to match driver via Ride Service", {
      rideId,
      driverId: bestDriver.driverId,
      error: err.message,
    });
  }
}

async function handleRideEnded({ rideId }) {
  // Clean up ride → driver mapping
  await redis.del(`ride:${rideId}:driver`);
  logger.info("Ride ended — cleaned up mapping", { rideId });
}

async function stopConsumer() {
  await consumer.disconnect();
  logger.info("Kafka consumer disconnected");
}

module.exports = { startConsumer, stopConsumer };
