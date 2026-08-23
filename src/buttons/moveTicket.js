'use strict';

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { findTicketByNumber } = require('../commands/registry/ticketService');
const { errorEmbed } = require('../utils/embed');

/**
 * Обработчик кнопки «Перенести» — открывает модальное окно для ввода
 * новых даты и времени. customId: move_<номер талона>
 */
async function moveHandler(interaction) {
  const ticketNumberValue = interaction.customId.split('_')[1];
  const ticket = findTicketByNumber(ticketNumberValue);

  if (!ticket || ticket.status === 'cancelled' || ticket.status === 'completed') {
    await interaction.reply({
      embeds: [errorEmbed('Невозможно перенести запись: талон не найден или неактивен.')],
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`moveModal_${ticketNumberValue}`)
    .setTitle('Перенос приёма');

  const date = new TextInputBuilder()
    .setCustomId('newDate')
    .setLabel('Новая дата (ДД.ММ.ГГГГ)')
    .setPlaceholder('например, 25.08.2026')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const time = new TextInputBuilder()
    .setCustomId('newTime')
    .setLabel('Новое время (ЧЧ:ММ)')
    .setPlaceholder('например, 16:30')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(date),
    new ActionRowBuilder().addComponents(time),
  );

  await interaction.showModal(modal);
}

module.exports = { id: 'move', handler: moveHandler };