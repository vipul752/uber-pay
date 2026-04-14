module.exports = {
  // Topics this service PRODUCES (via outbox relay)
  PAYMENT_COMPLETED: "payment.completed",
  PAYMENT_FAILED: "payment.failed",
  CREDIT_APPLIED: "payment.credit_applied",
  REFUND_PROCESSED: "payment.refund_processed",

  // Topics this service CONSUMES
  RIDE_COMPLETED: "ride.completed",
};
