const { prisma } = require('../db/connection');

function audit({ actorId = null, action, entityType = null, entityId = null, details = null, ip = null }) {
  try {
    prisma.auditLog.create({
      data: {
        actorId: actorId || null,
        action,
        entityType: entityType || null,
        entityId: entityId == null ? null : String(entityId),
        details: details ? JSON.stringify(details) : null,
        ip: ip || null,
      },
    });
  } catch (err) {
    console.error('[audit] ошибка записи:', err.message);
  }
}

async function recent(limit = 50) {
  return prisma.auditLog.findMany({
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      details: true,
      ip: true,
      createdAt: true,
      actor: { select: { fullName: true } },
    },
  }).then((rows) =>
    rows.map((r) => ({
      ...r,
      actor_name: r.actor?.fullName ?? null,
      actor: undefined,
    }))
  );
}

module.exports = { audit, recent };
