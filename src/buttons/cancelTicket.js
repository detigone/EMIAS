'use strict';

const { getDb } = require('../database/connection');
const { cancelTicket, findTicketByNumber } = require('../commands/registry/ticketService');
const { ticketEmbed, errorEmbed, successEmbed, infoEmbed } = require('../utils/embed');
const { audit, logger } = require('../utils/logger');

/**
 * Обработчик кнопки «Отменить запись».
 * customId: cancel_<номер талона>
 */
async function cancelHandler(interaction) {
  const ticketNumberValue = interaction.customId.split('_')[1];
  const ticket = findTicketByNumber(ticketNumberValue);

  if (!ticket) {
    await interaction.reply({ embeds: [errorEmbed('Талон не найден.')], ephemeral: true });
    return;
  }
  if (ticket.status === 'cancelled') {
    await interaction.reply({ embeds: [errorEmbed('Запись уже отменена.')], ephemeral: true });
    return;
  }
  if (ticket.status === 'completed') {
    await interaction.reply({ embeds: [errorEmbed('Нельзя отменить завершённый приём.')], ephemeral: true });
    return;
  }

  const result = cancelTicket(ticketNumberValue);
  if (!result.ok) {
    await interaction.reply({ embeds: [errorEmbed(result.reason)], ephemeral: true });
    return;
  }

  // Обновляем исходное сообщение с талоном.
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.*, p.fullName AS patientName, p.discordId AS patientDiscordId
       FROM tickets t LEFT JOIN patients p ON p.patient_id = t.patientId
       WHERE t.ticketNumber = ?`,
    )
    .get(ticketNumberValue);

  const updated = ticketEmbed(row, row.patientName, row.doctorName);
  await interaction.update({ embeds: [updated], components: [] });

  await interaction.followUp({
    embeds: [successEmbed('ЗАПИСЬ ОТМЕНЕНА', `Талон **${ticketNumberValue}** отменён.`, ticketNumberValue)],
    ephemeral: true,
  });

  audit({ action: 'APPOINTMENT_CANCEL_OK', discordId: interaction.user.id, ticket: ticketNumberValue });
  logger.info(`[REGISTRY] Талан отменён: ${ticketNumberValue}`);

  // Уведомление пациенту в ЛС.
  if (row.patientDiscordId) {
    try {
      const user = await interaction.client.users.fetch(row.patientDiscordId);
      await user.send({
        embeds: [infoEmbed(
          '❌ ЗАПИСЬ ОТМЕНЕНА',
          `Уважаемый(ая) **${row.patientName}**!\n\nПриём на **${row.date} ${row.time}** отменён.\nТалон: **${ticketNumberValue}**.`,
        )],
      }).catch(() => null);
    } catch (err) {
      logger.warn('[REGISTRY] Не удалось отправить уведомление об отмене:', { message: err.message });
    }
  }
}

module.exports = { id: 'cancel', handler: cancelHandler };