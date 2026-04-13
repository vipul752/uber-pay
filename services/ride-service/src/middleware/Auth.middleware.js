const jwt = require("jsonwebtoken");


function authMiddleware(req, res, next) {
  // Mode 1: Gateway-injected headers (preferred in production)
  const userId = req.headers["x-user-id"];
  const role = req.headers["x-user-role"];

  if (userId && role) {
    req.user = { userId, role };
    return next();
  }

  // Mode 2: Direct Bearer token
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Not authenticated", code: "NO_TOKEN" });
  }

  try {
    const token = header.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { userId: payload.userId, role: payload.role };
    next();
  } catch (err) {
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
        error: `Access denied. Required: ${roles.join(" or ")}`,
        code: "FORBIDDEN",
      });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
