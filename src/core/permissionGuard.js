'use strict';

const { ROLES, PERMISSIONS, getRoleId } = require('../../config/roles');
const { errorEmbed } = require('../utils/embed');
const { audit, logger } = require('../utils/logger');

/**
 * RBAC-проверки на основе ролей Discord.
 * Принцип наименьших привилегий: доступ только к тем функциям,
 * которые необходимы для выполнения должностных обязанностей.
 */

/**
 * Проверяет наличие роли «Медицинский персонал» у участника.
 * @param {GuildMember} member
 * @returns {{ok:boolean, reason:string|null}}
 */
function hasMedicalStaffRole(member) {
  const roleId = getRoleId('MEDICAL_STAFF');
  if (!roleId) {
    logger.warn('[RBAC] Роль ROLE_MEDICAL_STAFF не задана в .env');
    return { ok: false, reason: 'Роль «Медицинский персонал» не настроена администратором.' };
  }
  return {
    ok: member.roles.cache.has(roleId),
    reason: 'Требуется роль «Медицинский персонал».',
  };
}

/**
 * Гард для команд, требующих повышенных привилегий.
 * @param {object} params
 * @param {ChatInputCommandInteraction} params.interaction
 * @param {string} params.permission ключ прав (опционально)
 * @param {string} params.commandName имя команды для аудита
 * @returns {Promise<boolean>} true — доступ разрешён; false — отклонено с ответом
 */
async function requirePermission({ interaction, permission = null, commandName }) {
  const member = interaction.member;

  // Базовый проход: наличие роли медперсонала.
  const staffCheck = hasMedicalStaffRole(member);
  if (!staffCheck.ok) {
    audit({
      action: 'ACCESS_DENIED',
      discordId: interaction.user.id,
      username: interaction.user.username,
      command: commandName,
      reason: staffCheck.reason,
    });
    await interaction.reply({ embeds: [errorEmbed('Недостаточно прав для выполнения операции.', { reason: staffCheck.reason })], ephemeral: true });
    return false;
  }

  // Дополнительная проверка прав (зарезервировано для будущих ролей).
  if (permission && !hasPermission(member, permission)) {
    audit({
      action: 'ACCESS_DENIED',
      discordId: interaction.user.id,
      username: interaction.user.username,
      command: commandName,
      reason: `Отсутствует право: ${permission}`,
    });
    await interaction.reply({ embeds: [errorEmbed('Операция недоступна для вашей должности.')], ephemeral: true });
    return false;
  }

  return true;
}

/**
 * Определяет права участника на основе зарезервированных ролей персонала.
 * В текущей реализации базовым правом служит роль «Медицинский персонал»;
 * гранулярные роли (Врач, Регистратор и т.д.) подключаются по мере развития.
 * @param {GuildMember} member
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission(member, permission) {
  // Базовый доступ: все носители роли медперсонала имеют стандартные права.
  const defaultPermissions = new Set([
    PERMISSIONS.LOGIN,
    PERMISSIONS.VIEW_EMR,
    PERMISSIONS.CREATE_APPOINTMENT,
    PERMISSIONS.MANAGE_APPOINTMENT,
    PERMISSIONS.PRESCRIBE,
  ]);

  if (defaultPermissions.has(permission)) {
    return hasMedicalStaffRole(member).ok;
  }

  // Право регистрации сотрудников — отдельная привилегия (администрирование).
  if (permission === PERMISSIONS.REGISTER) {
    const adminId = getRoleId('ADMIN');
    if (adminId && member.roles.cache.has(adminId)) return true;
    return hasMedicalStaffRole(member).ok;
  }

  return false;
}

module.exports = { hasMedicalStaffRole, hasPermission, requirePermission, ROLES, PERMISSIONS };