'use strict';

const { getDb } = require('../database/connection');
const { rescheduleTicket, findTicketByNumber } = require('../commands/registry/ticketService');
const { ticketEmbed, errorEmbed, successEmbed, infoEmbed } = require('../utils/embed');
const { parseDate, parseTime } = require('../utils/validate');
const { audit, logger } = require('../utils/logger');

/**
 * Обработчик модального окна переноса приёма.
 * customId: moveModal_<номер талона>
 */
async function moveModalHandler(interaction) {
  const ticketNumberValue = interaction.customId.split('_')[1];
  const oldTicket = findTicketByNumber(ticketNumberValue);
  if (!oldTicket) {
    await interaction.reply({ embeds: [errorEmbed('Талон не найден.')], ephemeral: true });
    return;
  }

  const d = parseDate(interaction.fields.getTextInputValue('newDate'));
  if (!d.ok) {
    await interaction.reply({ embeds: [errorEmbed(d.reason)], ephemeral: true });
    return;
  }
  const t = parseTime(interaction.fields.getTextInputValue('newTime'));
  if (!t.ok) {
    await interaction.reply({ embeds: [errorEmbed(t.reason)], ephemeral: true });
    return;
  }

  const result = rescheduleTicket(ticketNumberValue, {
    date: d.value,
    time: t.value,
    specialty: oldTicket.doctorSpecialty,
  });

  if (!result.ok) {
    await interaction.reply({ embeds: [errorEmbed(result.reason)], ephemeral: true });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.*, p.fullName AS patientName, p.discordId AS patientDiscordId
       FROM tickets t LEFT JOIN patients p ON p.patient_id = t.patientId
       WHERE t.ticketNumber = ?`,
    )
    .get(result.ticket.ticketNumber);

  const embed = ticketEmbed(row, row.patientName, row.doctorName);
  await interaction.update({ embeds: [embed], components: [] });

  await interaction.followUp({
    embeds: [successEmbed(
      'ПРИЁМ ПЕРЕНЕСЁН',
      `Талон **${ticketNumberValue}** перенесён.\nНовый талон: **${result.ticket.ticketNumber}** на ${d.display} ${t.value}.`,
      result.ticket.ticketNumber,
    )],
    ephemeral: true,
  });

  audit({
    action: 'APPOINTMENT_MOVE_OK',
    discordId: interaction.user.id,
    oldTicket: ticketNumberValue,
    newTicket: result.ticket.ticketNumber,
  });
  logger.info(`[REGISTRY] Перенос ${ticketNumberValue} -> ${result.ticket.ticketNumber}`);

  // Уведомление пациенту в ЛС.
  if (row.patientDiscordId) {
    try {
      const user = await interaction.client.users.fetch(row.patientDiscordId);
      await user.send({
        embeds: [infoEmbed(
          '🔄 ПРИЁМ ПЕРЕНЕСЁН',
          `Уважаемый(ая) **${row.patientName}**!\n\nВаш приём перенесён на **${d.display} ${t.value}**.\nНовый талон: **${result.ticket.ticketNumber}**.`,
        )],
      }).catch(() => null);
    } catch (err) {
      logger.warn('[REGISTRY] Не удалось отправить уведомление о переносе:', { message: err.message });
    }
  }
}

module.exports = { id: 'moveModal', handler: moveModalHandler };