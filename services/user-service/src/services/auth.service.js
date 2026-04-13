const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const userRepo = require('../repositories/user.repository')

const SALT_ROUNDS = 12
const JWT_SECRET = process.env.JWT_SECRET
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d'


async function register({ name, email, password, role }) {
  // 1. Validate role
  if (!['rider', 'driver'].includes(role)) {
    throw createError('Role must be rider or driver', 400)
  }

  // 2. Check duplicate email
  const existing = await userRepo.findByEmail(email)
  if (existing) {
    throw createError('Email already registered', 409)
  }

  // 3. Hash password — never store plain text
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  // 4. Create user
  const user = await userRepo.create({ name, email, passwordHash, role })

  // 5. If driver, create driver profile
  if (role === 'driver') {
    await userRepo.createDriverProfile(user.id)
  }

  // 6. Sign token
  const token = signToken(user)

  return { token, user }
}

// ── Login ────────────────────────────────────────────────

async function login({ email, password }) {
  // 1. Find user — include passwordHash for comparison
  const user = await userRepo.findByEmail(email)
  if (!user) {
    // Always say "invalid credentials" — never reveal if email exists
    throw createError('Invalid credentials', 401)
  }

  // 2. Check account is active
  if (!user.isActive) {
    throw createError('Account has been deactivated', 403)
  }

  // 3. Compare password
  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    throw createError('Invalid credentials', 401)
  }

  // 4. Update last login timestamp (fire and forget)
  userRepo.updateLastLogin(user.id).catch(console.error)

  // 5. Sign token
  const token = signToken(user)

  return { token, user: sanitize(user) }
}

// ── Get profile ──────────────────────────────────────────

async function getProfile(id) {
  const user = await userRepo.findById(id)
  if (!user) throw createError('User not found', 404)
  return sanitize(user)
}

// ── Update profile ───────────────────────────────────────

async function updateProfile(id, { name, email }) {
  // If email is changing, check it's not taken
  if (email) {
    const existing = await userRepo.findByEmail(email)
    if (existing && existing.id !== id) {
      throw createError('Email already in use', 409)
    }
  }

  const data = {}
  if (name) data.name = name
  if (email) data.email = email

  if (Object.keys(data).length === 0) {
    throw createError('No fields to update', 400)
  }

  return userRepo.updateProfile(id, data)
}

// ── Change password ──────────────────────────────────────

async function changePassword(id, { currentPassword, newPassword }) {
  const user = await userRepo.findById(id)
  if (!user) throw createError('User not found', 404)

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) throw createError('Current password is incorrect', 401)

  if (newPassword.length < 8) {
    throw createError('New password must be at least 8 characters', 400)
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await userRepo.updatePassword(id, passwordHash)

  return { message: 'Password updated successfully' }
}

// ── Driver status ────────────────────────────────────────

async function setDriverOnline(userId, isOnline) {
  const user = await userRepo.findById(userId)
  if (!user) throw createError('User not found', 404)
  if (user.role !== 'driver') throw createError('Only drivers can go online', 403)

  await userRepo.setDriverOnline(userId, isOnline)
  return { isOnline, message: isOnline ? 'You are now online' : 'You are now offline' }
}

// ── Verify token (used by gateway) ──────────────────────

async function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = await userRepo.findById(payload.userId)
    if (!user || !user.isActive) throw new Error('User not found or inactive')
    return { valid: true, user: sanitize(user) }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

// ── Helpers ──────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email:  user.email,
      role:   user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  )
}

function sanitize(user) {
  // Strip passwordHash before sending to client
  const { passwordHash, ...safe } = user
  return safe
}

function createError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
  setDriverOnline,
  verifyToken,
}