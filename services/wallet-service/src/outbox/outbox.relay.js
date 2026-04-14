const walletRepo = require("../repositories/wallet.repository");
const { publish } = require("../kafka/producer");
const logger = require("../utils/logger");

const POLL_INTERVAL_MS = parseInt(
  process.env.OUTBOX_POLL_INTERVAL_MS || "1000",
);
const BATCH_SIZE = parseInt(process.env.OUTBOX_BATCH_SIZE || "50");
const MAX_ATTEMPTS = parseInt(process.env.OUTBOX_MAX_ATTEMPTS || "5");

let relayInterval = null;
let isProcessing = false; // prevent overlapping batches

/**
 * Outbox Relay — the background process that guarantees
 * every committed DB write eventually reaches Kafka.
 *
 * Why this matters:
 *   Without the outbox, you'd do:
 *     1. UPDATE wallets  ✅
 *     2. publish to Kafka  💥 crash
 *   → Money debited but no event published → downstream services never notified.
 *
 *   With the outbox:
 *     1. UPDATE wallets + INSERT outbox  ✅  (atomic, same transaction)
 *     2. App crashes — outbox row survives
 *     3. Relay starts, finds PENDING row, publishes to Kafka ✅
 *     → Guaranteed at-least-once delivery.
 *
 * The relay is idempotent — duplicate publishes are safe because
 * Kafka consumers use the `reference` field for their own idempotency.
 */
async function startOutboxRelay() {
  logger.info("Outbox relay starting", {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
  });

  relayInterval = setInterval(processBatch, POLL_INTERVAL_MS);
}

async function stopOutboxRelay() {
  if (relayInterval) {
    clearInterval(relayInterval);
    relayInterval = null;
    logger.info("Outbox relay stopped");
  }
}

async function processBatch() {
  // Skip this tick if the previous batch is still running
  // (e.g. Kafka is slow and taking > POLL_INTERVAL_MS)
  if (isProcessing) return;
  isProcessing = true;

  try {
    const events = await walletRepo.getPendingOutboxEvents(
      BATCH_SIZE,
      MAX_ATTEMPTS,
    );

    if (events.length === 0) {
      isProcessing = false;
      return;
    }

    logger.debug("Outbox relay processing batch", { count: events.length });

    for (const event of events) {
      await processEvent(event);
    }
  } catch (err) {
    logger.error("Outbox relay batch error", { error: err.message });
  } finally {
    isProcessing = false;
  }
}

async function processEvent(event) {
  try {
    // Publish to Kafka — use userId as partition key so
    // all events for the same wallet arrive in order
    const partitionKey = event.payload?.userId || event.id;

    await publish(event.eventType, event.payload, partitionKey);

    // Mark as sent ONLY after successful publish
    await walletRepo.markOutboxSent(event.id);

    logger.debug("Outbox event published", {
      id: event.id,
      eventType: event.eventType,
    });
  } catch (err) {
    logger.error("Outbox event publish failed", {
      id: event.id,
      eventType: event.eventType,
      attempts: event.attempts,
      error: err.message,
    });

    // Increment attempts. If at max, mark FAILED — dead-letter.
    // A FAILED event needs manual intervention or a separate DLQ consumer.
    await walletRepo.markOutboxFailed(event.id, MAX_ATTEMPTS, event.attempts);

    if (event.attempts + 1 >= MAX_ATTEMPTS) {
      logger.error("Outbox event exceeded max attempts — marked FAILED", {
        id: event.id,
        eventType: event.eventType,
      });
      // In production: alert PagerDuty / Slack here
    }
  }
}

module.exports = { startOutboxRelay, stopOutboxRelay };
