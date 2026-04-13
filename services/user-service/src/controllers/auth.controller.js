const authService = require('../services/auth.service')

async function register(req, res, next) {
  try {
    const { name, email, password, role } = req.body
    const result = await authService.register({ name, email, password, role })
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body
    const result = await authService.login({ email, password })
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}

async function getMe(req, res, next) {
  try {
    const user = await authService.getProfile(req.user.userId)
    res.json(user)
  } catch (err) {
    next(err)
  }
}

async function updateMe(req, res, next) {
  try {
    const { name, email } = req.body
    const user = await authService.updateProfile(req.user.userId, { name, email })
    res.json(user)
  } catch (err) {
    next(err)
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body
    const result = await authService.changePassword(req.user.userId, {
      currentPassword,
      newPassword,
    })
    res.json(result)
  } catch (err) {
    next(err)
  }
}

async function setOnline(req, res, next) {
  try {
    const { isOnline } = req.body
    if (typeof isOnline !== 'boolean') {
      return res.status(400).json({ error: 'isOnline must be a boolean' })
    }
    const result = await authService.setDriverOnline(req.user.userId, isOnline)
    res.json(result)
  } catch (err) {
    next(err)
  }
}


async function verifyToken(req, res, next) {
  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ error: 'token is required' })
    const result = await authService.verifyToken(token)
    res.json(result)
  } catch (err) {
    next(err)
  }
}


async function getUserById(req, res, next) {
  try {
    const user = await authService.getProfile(req.params.id)
    res.json(user)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  register,
  login,
  getMe,
  updateMe,
  changePassword,
  setOnline,
  verifyToken,
  getUserById,
}