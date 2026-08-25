'use strict';

/**
 * Журнал аудита: фиксирует значимые действия (кто / когда / что).
 * Пишется на уровне API-шлюза — единственной точки доступа к данным.
 */

function audit(db, { actorId = null, action, entityType = null, entityId = null, details = null, ip = null }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(actorId, action, entityType, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, ip);
  } catch (err) {
    // Аудит не должен ломать основной сценарий, но факт ошибки логируем.
    console.error('[audit] ошибка записи:', err.message);
  }
}

function recent(db, limit = 50) {
  return db
    .prepare(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.ip, a.created_at,
              u.full_name AS actor_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.id DESC
        LIMIT ?`
    )
    .all(limit);
}

module.exports = { audit, recent };
