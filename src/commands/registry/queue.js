'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { listTickets, todayISO } = require('./ticketService');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { documentHeader, errorEmbed, infoEmbed } = require('../../utils/embed');
const { parseDate } = require('../../utils/validate');
const { formatDate } = require('../../utils/format');
const { audit } = require('../../utils/logger');

const PAGE_SIZE = 6;

/**
 * Команда /queue status — очередь приёма на дату с пагинацией.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Очередь приёма.')
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Текущая очередь приёма.')
        .addStringOption((o) => o.setName('date').setDescription('Дата ДД.ММ.ГГГГ (по умолчанию — сегодня)').setRequired(false)),
    ),

  async execute(interaction) {
    const ok = await requirePermission({ interaction, permission: PERMISSIONS.CREATE_APPOINTMENT, commandName: 'queue status' });
    if (!ok) return;

    let date, display;
    const dateInput = interaction.options.getString('date');
    if (dateInput) {
      const p = parseDate(dateInput);
      if (!p.ok) {
        await interaction.reply({ embeds: [errorEmbed(p.reason)], ephemeral: true });
        return;
      }
      date = p.value;
      display = p.display;
    } else {
      date = todayISO();
      display = formatDate(new Date());
    }

    const tickets = listTickets(date);
    audit({ action: 'QUEUE_STATUS', discordId: interaction.user.id, date, count: tickets.length });

    if (tickets.length === 0) {
      await interaction.reply({
        embeds: [infoEmbed('ОЧЕРЕДЬ ПРИЁМА', `На **${display}** пациентов в очереди нет.`)],
        ephemeral: true,
      });
      return;
    }

    const payload = buildPage(0, date, display, tickets.length, tickets);
    await interaction.reply(payload);
  },
};

module.exports.buildPayload = buildPayload;

/** Формирование страницы очереди. */
function buildPage(pageIndex, date, display, totalCount, tickets) {
  const totalPages = Math.ceil(tickets.length / PAGE_SIZE);
  const clamped = Math.max(0, Math.min(pageIndex, totalPages - 1));

  const embed = documentHeader({
    title: 'ОЧЕРЕДЬ ПРИЁМА',
    docNumber: `${display} · ${totalCount} записей`,
  });
  embed.setDescription(`Страница **${clamped + 1}** из **${totalPages}**.`);

  const slice = tickets.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);
  let position = clamped * PAGE_SIZE + 1;
  for (const tk of slice) {
    embed.addFields({
      name: `№${position} · ${tk.time}`,
      value: `**${tk.patientName || '—'}**\n${tk.doctorName || ''} · ${tk.ticketNumber}`,
      inline: false,
    });
    position += 1;
  }

  const prev = new ButtonBuilder()
    .setCustomId(`queue_${clamped - 1}_${date}`)
    .setLabel('◀ Назад')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(clamped === 0);

  const next = new ButtonBuilder()
    .setCustomId(`queue_${clamped + 1}_${date}`)
    .setLabel('Вперёд ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(clamped >= totalPages - 1);

  const row = new ActionRowBuilder().addComponents(prev, next);
  return { embeds: [embed], components: [row] };
}

/** Для обработчика кнопок пагинации очереди. */
function buildPayload(pageIndex, date) {
  const tickets = listTickets(date);
  const display = date.split('-').reverse().join('.');
  if (tickets.length === 0) {
    return { embeds: [infoEmbed('ОЧЕРЕДЬ ПРИЁМА', `На **${display}** пациентов в очереди нет.`)], components: [] };
  }
  return buildPage(pageIndex, date, display, tickets.length, tickets);
}