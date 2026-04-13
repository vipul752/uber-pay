const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res
        .status(401)
        .json({ error: "Unauthorized: missing or invalid token" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: "Unauthorized: token verification failed" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "Forbidden: insufficient permissions" });
    }
    next();
  };
}

// Lightweight validation — no extra libraries needed

function validateRegister(req, res, next) {
  const { name, email, password, role } = req.body;
  const errors = [];

  if (!name || name.trim().length < 2) {
    errors.push("name must be at least 2 characters");
  }

  if (!email || !isValidEmail(email)) {
    errors.push("valid email is required");
  }

  if (!password || password.length < 8) {
    errors.push("password must be at least 8 characters");
  }

  if (!role || !["rider", "driver"].includes(role)) {
    errors.push("role must be rider or driver");
  }

  if (errors.length > 0) {
    return res
      .status(400)
      .json({ error: "Validation failed", details: errors });
  }

  // Sanitize
  req.body.name = name.trim();
  req.body.email = email.toLowerCase().trim();

  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body;
  const errors = [];

  if (!email || !isValidEmail(email)) {
    errors.push("valid email is required");
  }

  if (!password) {
    errors.push("password is required");
  }

  if (errors.length > 0) {
    return res
      .status(400)
      .json({ error: "Validation failed", details: errors });
  }

  req.body.email = email.toLowerCase().trim();

  next();
}

function validateUpdateProfile(req, res, next) {
  const { name, email } = req.body;

  if (!name && !email) {
    return res
      .status(400)
      .json({ error: "Provide at least one field to update" });
  }

  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (name) req.body.name = name.trim();
  if (email) req.body.email = email.toLowerCase().trim();

  next();
}

function validateChangePassword(req, res, next) {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword) {
    return res.status(400).json({ error: "currentPassword is required" });
  }

  if (!newPassword || newPassword.length < 8) {
    return res
      .status(400)
      .json({ error: "newPassword must be at least 8 characters" });
  }

  if (currentPassword === newPassword) {
    return res
      .status(400)
      .json({ error: "New password must differ from current password" });
  }

  next();
}


function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = {
  authMiddleware,
  requireRole,
  validateRegister,
  validateLogin,
  validateUpdateProfile,
  validateChangePassword,
};
