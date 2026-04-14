/**
 * Creates a structured error with HTTP status and optional code.
 * Used throughout the service for consistent error responses.
 */
function createError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

module.exports = { createError };
