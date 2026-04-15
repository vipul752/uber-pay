const geoService = require("../services/geohash.service");
const { redis } = require("../redis/client");
const { createError } = require("../utils/errors");
const logger = require("../utils/logger");

// POST /api/location/update
// Called by driver's phone every ~3 seconds while online
async function updateLocation(req, res, next) {
  try {
    const { lat, lng } = req.body;
    const driverId = req.headers["x-user-id"] || req.user?.userId;

    if (!driverId) {
      return res
        .status(400)
        .json({ error: "driverId is required (x-user-id header)" });
    }

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const latF = parseFloat(lat);
    const lngF = parseFloat(lng);

    if (isNaN(latF) || latF < -90 || latF > 90)
      return res.status(400).json({ error: "lat must be between -90 and 90" });
    if (isNaN(lngF) || lngF < -180 || lngF > 180)
      return res
        .status(400)
        .json({ error: "lng must be between -180 and 180" });

    await geoService.updateDriverLocation(driverId, latF, lngF);

    res.json({ ok: true, driverId, lat: latF, lng: lngF, ts: Date.now() });
  } catch (err) {
    next(err);
  }
}

// GET /api/location/nearby?lat=xx&lng=yy&radius=5
// Called by frontend to show nearby driver dots on map
async function getNearbyDrivers(req, res, next) {
  try {
    const { lat, lng, radius, count } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const drivers = await geoService.findNearbyDrivers(
      parseFloat(lat),
      parseFloat(lng),
      radius ? parseFloat(radius) : undefined,
      count ? parseInt(count) : undefined,
    );

    res.json({ drivers, count: drivers.length });
  } catch (err) {
    next(err);
  }
}

// GET /api/location/driver/:driverId
// Get last known position of a specific driver
async function getDriverPosition(req, res, next) {
  try {
    const { driverId } = req.params;

    const position = await geoService.getDriverPosition(driverId);
    if (!position) {
      return res
        .status(404)
        .json({ error: "Driver not found or offline", code: "DRIVER_OFFLINE" });
    }

    const isOnline = await geoService.isDriverOnline(driverId);

    res.json({ driverId, ...position, isOnline });
  } catch (err) {
    next(err);
  }
}

// GET /api/location/distance?driverId=x&lat=xx&lng=yy
// Get distance between a driver and a point (pickup location)
async function getDistance(req, res, next) {
  try {
    const { driverId, lat, lng } = req.query;
    if (!driverId || !lat || !lng) {
      return res
        .status(400)
        .json({ error: "driverId, lat and lng are required" });
    }

    const distanceKm = await geoService.getDistanceKm(
      driverId,
      parseFloat(lat),
      parseFloat(lng),
    );

    if (distanceKm === null) {
      return res.status(404).json({ error: "Driver not found in geo index" });
    }

    res.json({ driverId, distanceKm });
  } catch (err) {
    next(err);
  }
}

// POST /api/location/offline
// Driver marks themselves offline — removes from geo index
async function driverOffline(req, res, next) {
  try {
    const driverId = req.headers["x-user-id"] || req.user?.userId;
    if (!driverId) return res.status(400).json({ error: "driverId required" });

    await geoService.removeDriver(driverId);
    res.json({ ok: true, driverId, message: "Driver marked offline" });
  } catch (err) {
    next(err);
  }
}

// GET /api/location/stats
// Admin endpoint — how many drivers are online
async function getStats(req, res, next) {
  try {
    const onlineCount = await geoService.getOnlineDriverCount();
    res.json({ onlineDrivers: onlineCount });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  updateLocation,
  getNearbyDrivers,
  getDriverPosition,
  getDistance,
  driverOffline,
  getStats,
};
