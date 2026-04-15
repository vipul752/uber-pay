const jwt = require("jsonwebtoken");

/**
 * Dual-mode auth — same as other services:
 *   1. Gateway-injected x-user-id / x-user-role headers
 *   2. Direct Bearer token for testing / internal calls
 */
function authMiddleware(req, res, next) {
  const userId = req.headers["x-user-id"];
  const role = req.headers["x-user-role"];

  if (userId && role) {
    req.user = { userId, role };
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res
      .status(401)
      .json({ error: "Not authenticated", code: "NO_TOKEN" });

  try {
    const payload = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    req.user = { userId: payload.userId, role: payload.role };
    next();
  } catch {
    res
      .status(401)
      .json({ error: "Invalid or expired token", code: "INVALID_TOKEN" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Requires role: ${roles.join(" or ")}`,
        code: "FORBIDDEN",
      });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
