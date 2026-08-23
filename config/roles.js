'use strict';

/**
 * Модель ролей и прав доступа (RBAC).
 * Роли Discord используются как источник прав; дополнительные роли
 * персонала зарезервированы для будущего развития модуля кадров.
 */

const ROLES = {
  /** Базовая роль, дающая доступ к привилегированным командам. */
  MEDICAL_STAFF: 'ROLE_MEDICAL_STAFF',
  ADMIN: 'ROLE_ADMIN',

  /** Зарезервированные роли персонала (для будущего расширения). */
  HEAD_PHYSICIAN: 'Главный врач',
  DEPARTMENT_HEAD: 'Заведующий отделением',
  PHYSICIAN: 'Врач',
  NURSE: 'Медсестра',
  REGISTRAR: 'Регистратор',
};

/**
 * Кэш прав пользователя в рамках одной сессии.
 * Формат: Map<discordId, Set<permission>>
 */
const PERMISSIONS = {
  REGISTER: 'auth:register',
  LOGIN: 'auth:login',
  VIEW_EMR: 'emr:view',
  CREATE_APPOINTMENT: 'registry:create_appointment',
  MANAGE_APPOINTMENT: 'registry:manage_appointment',
  PRESCRIBE: 'emr:prescribe',
};

/**
 * Возвращает значение роли из окружения (.env).
 * @param {string} roleKey ключ роли (см. ROLES)
 * @returns {string|null}
 */
function getRoleId(roleKey) {
  const key = ROLES[roleKey];
  if (!key) return null;
  return process.env[key] || null;
}

module.exports = { ROLES, PERMISSIONS, getRoleId };