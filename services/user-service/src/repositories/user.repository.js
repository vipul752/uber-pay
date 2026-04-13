const prisma = require('../db')

// ── Read ─────────────────────────────────────────────────

async function findById(id) {
  return prisma.user.findUnique({
    where: { id },
    include: { driverProfile: true },
  })
}

async function findByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    include: { driverProfile: true },
  })
}

async function findAll({ role, isActive, limit = 20, offset = 0 } = {}) {
  const where = {}
  if (role) where.role = role
  if (isActive !== undefined) where.isActive = isActive

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        driverProfile: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.user.count({ where }),
  ])

  return { users, total }
}

// ── Write ────────────────────────────────────────────────

async function create({ name, email, passwordHash, role }) {
  return prisma.user.create({
    data: { name, email, passwordHash, role },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  })
}

async function updateLastLogin(id) {
  return prisma.user.update({
    where: { id },
    data: { lastLogin: new Date() },
  })
}

async function updateProfile(id, data) {
  return prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      updatedAt: true,
    },
  })
}

async function updatePassword(id, passwordHash) {
  return prisma.user.update({
    where: { id },
    data: { passwordHash },
  })
}

async function deactivate(id) {
  return prisma.user.update({
    where: { id },
    data: { isActive: false },
  })
}

// ── Driver profile ───────────────────────────────────────

async function createDriverProfile(userId, data = {}) {
  return prisma.driverProfile.create({
    data: { userId, ...data },
  })
}

async function updateDriverProfile(userId, data) {
  return prisma.driverProfile.update({
    where: { userId },
    data,
  })
}

async function setDriverOnline(userId, isOnline) {
  return prisma.driverProfile.update({
    where: { userId },
    data: { isOnline },
  })
}

module.exports = {
  findById,
  findByEmail,
  findAll,
  create,
  updateLastLogin,
  updateProfile,
  updatePassword,
  deactivate,
  createDriverProfile,
  updateDriverProfile,
  setDriverOnline,
}