'use strict';

const { getSessionUser } = require('../auth/sessions');

/**
 * RBAC-посредники. Права проверяются ТОЛЬКО здесь, на уровне API-шлюза,
 * до выполнения запроса — как требуют процессный и юридический стандарты.
 */

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    }
    next();
  };
}

const isAdmin = (user) => user?.role === 'Главный врач';
const isDoctor = (user) => user?.role === 'Врач' || isAdmin(user);

module.exports = { requireAuth, requireRole, isAdmin, isDoctor };
