const axios = require("axios");
const rideRepo = require("../repositories/ride.repository");
const { publish } = require("../kafka/producer");
const TOPICS = require("../kafka/topics");
const logger = require("../logger");

const WALLET_URL = process.env.WALLET_SERVICE_URL || "http://localhost:3003";

const WALLET_TIMEOUT = 10_000;

/**
 * SAGA Orchestrator for ride payment.
 *
 * Runs when a ride transitions to COMPLETED.
 * Each step has a paired compensation that runs in reverse if anything fails.
 *
 * Steps:
 *   1. Debit  rider wallet
 *   2. Credit driver wallet  (80% of fare)
 *   3. Mark ride COMPLETED in DB
 *   4. Publish ride.completed event to Kafka
 *
 * If any step throws, compensations run in reverse for all completed steps.
 * The caller receives the error — HTTP response is NOT blocked (SAGA runs async).
 */
async function runPaymentSaga(rideId) {
  const ride = await rideRepo.findById(rideId);
  if (!ride) throw new Error(`Ride ${rideId} not found`);

  const { riderId, driverId, fare } = ride;
  const fareAmount = parseFloat(fare);
  const driverAmount = parseFloat((fareAmount * 0.8).toFixed(2)); // driver gets 80%
  const completed = []; // track completed steps for compensation

  logger.info("[SAGA] Starting payment saga", { rideId, fare: fareAmount });

  try {
    // ── Step 1: Debit rider ────────────────────────────────
    logger.info("[SAGA] Step 1 — debiting rider", {
      riderId,
      amount: fareAmount,
    });

    await axios.post(
      `${WALLET_URL}/api/wallet/debit`,
      {
        userId: riderId,
        amount: fareAmount,
        reference: `ride-${rideId}-debit`,
        description: `Ride fare for ride ${rideId}`,
      },
      { timeout: WALLET_TIMEOUT },
    );

    completed.push("DEBIT_RIDER");
    logger.info("[SAGA] Step 1 complete", { riderId });

    // ── Step 2: Credit driver ──────────────────────────────
    logger.info("[SAGA] Step 2 — crediting driver", {
      driverId,
      amount: driverAmount,
    });

    await axios.post(
      `${WALLET_URL}/api/wallet/credit`,
      {
        userId: driverId,
        amount: driverAmount,
        reference: `ride-${rideId}-credit`,
        description: `Ride earnings for ride ${rideId}`,
      },
      { timeout: WALLET_TIMEOUT },
    );

    completed.push("CREDIT_DRIVER");
    logger.info("[SAGA] Step 2 complete", { driverId });

    // ── Step 3: Mark ride COMPLETED ────────────────────────
    logger.info("[SAGA] Step 3 — marking ride completed", { rideId });

    await rideRepo.updateStatus(rideId, "COMPLETED", {
      completedAt: new Date(),
    });

    completed.push("UPDATE_RIDE");
    logger.info("[SAGA] Step 3 complete");

    // ── Step 4: Publish event ──────────────────────────────
    logger.info("[SAGA] Step 4 — publishing ride.completed", { rideId });

    await publish(
      TOPICS.RIDE_COMPLETED,
      {
        rideId,
        riderId,
        driverId,
        fare: fareAmount,
        driverShare: driverAmount,
        completedAt: new Date().toISOString(),
      },
      rideId, // partition key
    );

    logger.info("[SAGA] Payment saga completed successfully", { rideId });
  } catch (err) {
    logger.error("[SAGA] Step failed — running compensations", {
      rideId,
      completedSteps: completed,
      error: err.message,
    });

    await runCompensations(completed, {
      rideId,
      riderId,
      driverId,
      fareAmount,
      driverAmount,
      reason: err.message,
    });

    // Re-throw so caller knows the saga failed
    throw err;
  }
}

/**
 * Compensation runner.
 * Runs completed steps in REVERSE order — last-in first-out.
 * Each compensation is wrapped independently so one failure doesn't
 * prevent the others from running.
 */
async function runCompensations(
  completedSteps,
  { rideId, riderId, driverId, fareAmount, driverAmount, reason },
) {
  logger.warn("[SAGA] Running compensations", {
    rideId,
    steps: completedSteps,
  });

  for (const step of [...completedSteps].reverse()) {
    try {
      if (step === "DEBIT_RIDER") {
        logger.info("[SAGA] Compensating DEBIT_RIDER — refunding rider");
        await axios.post(
          `${WALLET_URL}/api/wallet/credit`,
          {
            userId: riderId,
            amount: fareAmount,
            reference: `ride-${rideId}-refund`,
            description: `Refund for failed ride ${rideId}`,
          },
          { timeout: WALLET_TIMEOUT },
        );
        logger.info("[SAGA] DEBIT_RIDER compensated — rider refunded");
      }

      if (step === "CREDIT_DRIVER") {
        logger.info(
          "[SAGA] Compensating CREDIT_DRIVER — reversing driver credit",
        );
        await axios.post(
          `${WALLET_URL}/api/wallet/debit`,
          {
            userId: driverId,
            amount: driverAmount,
            reference: `ride-${rideId}-reverse-credit`,
            description: `Reversal of earnings for failed ride ${rideId}`,
          },
          { timeout: WALLET_TIMEOUT },
        );
        logger.info(
          "[SAGA] CREDIT_DRIVER compensated — driver credit reversed",
        );
      }

      if (step === "UPDATE_RIDE") {
        logger.info("[SAGA] Compensating UPDATE_RIDE — marking ride as FAILED");
        await rideRepo.updateStatus(rideId, "FAILED", {
          failureReason: reason,
        });
        logger.info("[SAGA] UPDATE_RIDE compensated — ride marked FAILED");
      }
    } catch (compErr) {
      // A compensation failing is a critical incident — log loudly
      // In production: alert PagerDuty, write to dead-letter DB, page on-call
      logger.error("[SAGA] CRITICAL: compensation failed", {
        step,
        rideId,
        error: compErr.message,
      });
    }
  }

  // If ride status was never updated, mark it FAILED now
  if (!completedSteps.includes("UPDATE_RIDE")) {
    await rideRepo
      .updateStatus(rideId, "FAILED", { failureReason: reason })
      .catch((e) =>
        logger.error("[SAGA] Could not mark ride FAILED", { error: e.message }),
      );
  }

  // Always publish failure event regardless of compensations
  await publish(
    TOPICS.RIDE_PAYMENT_FAILED,
    { rideId, riderId, driverId, reason },
    rideId,
  ).catch((e) =>
    logger.error("[SAGA] Could not publish payment_failed event", {
      error: e.message,
    }),
  );

  logger.warn("[SAGA] Compensations complete", { rideId });
}

module.exports = { runPaymentSaga };
