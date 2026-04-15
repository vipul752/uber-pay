const { redis } = require("../redis/client");
const logger = require("../utils/logger");

// Redis key that holds ALL online driver positions as a geo sorted set
const DRIVERS_GEO_KEY = "drivers:online";

// TTL for the "driver is active" sentinel key
// If a driver stops sending updates for this many seconds, they're considered offline
const DRIVER_TTL_SECS = parseInt(process.env.DRIVER_LOCATION_TTL_SECS || "30");

// Default search config
const DEFAULT_RADIUS_KM = parseFloat(
  process.env.NEARBY_SEARCH_RADIUS_KM || "5",
);
const DEFAULT_MAX_DRIVERS = parseInt(
  process.env.NEARBY_SEARCH_MAX_DRIVERS || "5",
);

/**
 * Store a driver's current position.
 *
 * Redis GEOADD stores coordinates as a geohash inside a sorted set.
 * This lets GEOSEARCH do radius queries in O(N+log M) time — extremely
 * fast even with thousands of drivers because it only scans cells
 * within the search radius.
 *
 * Also:
 *   - Sets a TTL sentinel key so stale drivers auto-expire
 *   - Publishes to a Redis channel so WebSocket rooms get the update
 *
 * @param {string} driverId
 * @param {number} lat
 * @param {number} lng
 */
async function updateDriverLocation(driverId, lat, lng) {
  const pipeline = redis.pipeline();

  // Store geo position — GEOADD takes (key, lng, lat, member)
  // Note: Redis uses lng THEN lat (longitude first) — opposite of most APIs
  pipeline.geoadd(DRIVERS_GEO_KEY, lng, lat, driverId);

  // Refresh the active sentinel — auto-removed after TTL if no more updates
  pipeline.setex(`driver:${driverId}:active`, DRIVER_TTL_SECS, "1");

  // Cache the raw coordinates for fast single-driver lookup
  pipeline.setex(
    `driver:${driverId}:pos`,
    DRIVER_TTL_SECS + 5,
    JSON.stringify({ lat, lng, updatedAt: Date.now() }),
  );

  // Publish to pub/sub channel — Socket.io subscriber picks this up
  // and broadcasts to any rider rooms watching this driver
  pipeline.publish(
    `driver:${driverId}:location`,
    JSON.stringify({ driverId, lat, lng, ts: Date.now() }),
  );

  await pipeline.exec();

  logger.debug("Driver location updated", { driverId, lat, lng });
}

/**
 * Find available drivers within a radius of a pickup point.
 *
 * Uses Redis GEOSEARCH (replaces deprecated GEORADIUS in Redis 6.2+):
 *   GEOSEARCH key FROMLONLAT lng lat BYRADIUS radius KM ASC COUNT n WITHDIST
 *
 * Results are already sorted by distance ASC — nearest driver is index 0.
 * Each result is [ [driverId, distanceKm], ... ]
 *
 * @returns {Array<{driverId, distanceKm}>}
 */
async function findNearbyDrivers(
  lat,
  lng,
  radiusKm = DEFAULT_RADIUS_KM,
  maxCount = DEFAULT_MAX_DRIVERS,
) {
  // GEOSEARCH returns a nested array when WITHDIST is used:
  // [ ['driver1', '1.23'], ['driver2', '2.45'], ... ]
  const results = await redis.call(
    "GEOSEARCH",
    DRIVERS_GEO_KEY,
    "FROMLONLAT",
    lng,
    lat, // search center (lng first!)
    "BYRADIUS",
    radiusKm,
    "KM", // search radius
    "ASC", // sort by distance ascending
    "COUNT",
    maxCount, // limit results
    "WITHDIST", // include distance in results
  );

  if (!results || results.length === 0) return [];

  // Filter out stale drivers (sentinel key expired = offline)
  const nearby = [];

  for (const [driverId, distanceStr] of results) {
    const isActive = await redis.exists(`driver:${driverId}:active`);
    if (isActive) {
      nearby.push({
        driverId,
        distanceKm: parseFloat(parseFloat(distanceStr).toFixed(2)),
      });
    }
  }

  logger.info("Nearby drivers found", {
    lat,
    lng,
    radiusKm,
    total: results.length,
    active: nearby.length,
  });

  return nearby;
}

/**
 * Get the last known position of a single driver.
 * Used to show estimated ETA on the rider's screen.
 */
async function getDriverPosition(driverId) {
  // Check cached raw position first (more precise than geo sorted set)
  const cached = await redis.get(`driver:${driverId}:pos`);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through to GEOPOS
    }
  }

  // Fallback: read from geo sorted set
  const positions = await redis.geopos(DRIVERS_GEO_KEY, driverId);
  if (!positions || !positions[0]) return null;

  const [lngStr, latStr] = positions[0];
  return {
    lat: parseFloat(latStr),
    lng: parseFloat(lngStr),
    updatedAt: null, // GEOPOS doesn't store timestamp
  };
}

/**
 * Get distance between two geo points using Redis GEODIST.
 * Handy for fare calculation or ETA estimation.
 */
async function getDistanceKm(driverId, riderLat, riderLng) {
  // Add rider as a temporary member, calculate distance, then remove
  const tempKey = `rider:temp:${Date.now()}`;
  await redis.geoadd(DRIVERS_GEO_KEY, riderLng, riderLat, tempKey);
  const dist = await redis.geodist(DRIVERS_GEO_KEY, driverId, tempKey, "KM");
  await redis.zrem(DRIVERS_GEO_KEY, tempKey);
  return dist ? parseFloat(parseFloat(dist).toFixed(2)) : null;
}

/**
 * Mark a driver as offline — remove from geo index and clear sentinel.
 */
async function removeDriver(driverId) {
  const pipeline = redis.pipeline();
  pipeline.zrem(DRIVERS_GEO_KEY, driverId);
  pipeline.del(`driver:${driverId}:active`);
  pipeline.del(`driver:${driverId}:pos`);
  await pipeline.exec();
  logger.info("Driver removed from geo index", { driverId });
}

/**
 * Check if a driver is currently online (active sentinel exists).
 */
async function isDriverOnline(driverId) {
  const exists = await redis.exists(`driver:${driverId}:active`);
  return exists === 1;
}

/**
 * Get all currently online driver IDs.
 * Used for admin dashboards / analytics.
 */
async function getOnlineDriverCount() {
  return redis.zcard(DRIVERS_GEO_KEY);
}

module.exports = {
  updateDriverLocation,
  findNearbyDrivers,
  getDriverPosition,
  getDistanceKm,
  removeDriver,
  isDriverOnline,
  getOnlineDriverCount,
};
