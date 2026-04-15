const { subscriber, redis } = require("../redis/client");
const logger = require("../utils/logger");

// Track socket ID → userId mapping for cleanup on disconnect
const socketUsers = new Map();

// Track userId → Set of socket IDs (a user can have multiple tabs/devices)
const userSockets = new Map();

/**
 * Initialize all Socket.io event handlers and start the Redis pub/sub bridge.
 *
 * Architecture:
 *   Driver phone → POST /location/update
 *       → GEOADD to Redis geo set
 *       → PUBLISH to Redis channel driver:{id}:location
 *
 *   Redis subscriber → catches published message
 *       → io.to(room) → pushed to rider's socket
 *
 * This decouples the HTTP layer from WebSocket layer — drivers don't need
 * a WebSocket connection, they just POST. The Redis pub/sub bridge handles
 * the fan-out to riders.
 *
 * @param {import('socket.io').Server} io
 */
function initSocketHandlers(io) {
  io.on("connection", (socket) => {
    logger.info("Socket connected", { socketId: socket.id });

    // ── Rider joins a ride room ────────────────────────
    // Rider's app emits this after their ride is matched with a driver.
    // They'll receive real-time location updates until the ride ends.
    socket.on("join:ride", ({ rideId, userId }) => {
      if (!rideId || !userId) return;

      const room = `ride:${rideId}`;
      socket.join(room);
      logger.info("Rider joined ride room", {
        socketId: socket.id,
        userId,
        rideId,
        room,
      });

      // Register socket ↔ user mapping
      socketUsers.set(socket.id, userId);
      if (!userSockets.has(userId)) userSockets.set(userId, new Set());
      userSockets.get(userId).add(socket.id);

      // Acknowledge join
      socket.emit("joined:ride", {
        rideId,
        message: "Tracking driver location...",
      });
    });

    // ── Driver joins their personal room ───────────────
    // Drivers join this so the server can push ride requests to them
    socket.on("join:driver", ({ driverId }) => {
      if (!driverId) return;

      const room = `driver:${driverId}`;
      socket.join(room);
      logger.info("Driver joined room", {
        socketId: socket.id,
        driverId,
        room,
      });

      socketUsers.set(socket.id, driverId);
      if (!userSockets.has(driverId)) userSockets.set(driverId, new Set());
      userSockets.get(driverId).add(socket.id);

      socket.emit("joined:driver", {
        driverId,
        message: "Driver room joined.",
      });
    });

    // ── Leave ride room ────────────────────────────────
    socket.on("leave:ride", ({ rideId }) => {
      socket.leave(`ride:${rideId}`);
      logger.info("Socket left ride room", { socketId: socket.id, rideId });
    });

    // ── Ping / keep-alive ──────────────────────────────
    socket.on("ping", () => socket.emit("pong", { ts: Date.now() }));

    // ── Disconnect cleanup ─────────────────────────────
    socket.on("disconnect", (reason) => {
      const userId = socketUsers.get(socket.id);
      if (userId) {
        const sockets = userSockets.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) userSockets.delete(userId);
        }
        socketUsers.delete(socket.id);
      }
      logger.info("Socket disconnected", {
        socketId: socket.id,
        userId,
        reason,
      });
    });
  });

  // ── Redis pub/sub bridge ───────────────────────────────
  // Subscribe to ALL driver location channels using a pattern.
  // When any driver publishes a location update, this fires.
  subscriber.psubscribe("driver:*:location", (err, count) => {
    if (err) {
      logger.error("Failed to subscribe to driver location channels", {
        error: err.message,
      });
    } else {
      logger.info("Subscribed to driver location channels", {
        subscriptions: count,
      });
    }
  });

  subscriber.on("pmessage", async (pattern, channel, message) => {
    // channel format: "driver:{driverId}:location"
    try {
      const data = JSON.parse(message);
      const { driverId, lat, lng, ts } = data;

      // Extract driverId from channel name
      const parts = channel.split(":");
      const resolvedDriverId = parts[1] || driverId;

      // 1. Push to driver's personal room (for riders watching their driver)
      io.to(`driver:${resolvedDriverId}`).emit("location:update", {
        driverId: resolvedDriverId,
        lat,
        lng,
        ts,
      });

      // 2. Look up which ride this driver is currently on
      //    and push to that ride's room too
      const rideId = await redis.get(`ride:*:driver`).catch(() => null);

      if (rideId) {
        io.to(`ride:${rideId}`).emit("location:update", {
          driverId: resolvedDriverId,
          lat,
          lng,
          ts,
        });
      }
    } catch (err) {
      logger.error("Failed to process Redis pub/sub message", {
        channel,
        error: err.message,
      });
    }
  });

  logger.info("Socket.io handlers initialized");
}

/**
 * Push a ride request notification to a specific driver's socket room.
 * Called when the Kafka consumer matches a driver to a ride.
 */
function notifyDriver(io, driverId, event, data) {
  io.to(`driver:${driverId}`).emit(event, data);
  logger.debug("Driver notified via socket", { driverId, event });
}

/**
 * Push an update to all sockets in a ride room.
 */
function notifyRideRoom(io, rideId, event, data) {
  io.to(`ride:${rideId}`).emit(event, data);
  logger.debug("Ride room notified", { rideId, event });
}

/**
 * Get current WebSocket stats — useful for health checks.
 */
function getSocketStats() {
  return {
    connectedSockets: socketUsers.size,
    connectedUsers: userSockets.size,
  };
}

module.exports = {
  initSocketHandlers,
  notifyDriver,
  notifyRideRoom,
  getSocketStats,
};
