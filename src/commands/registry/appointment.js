'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { createTicket, listTickets, todayISO } = require('./ticketService');
const { findPatientByUser, patientExists } = require('../emr/patientService');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { ticketEmbed, errorEmbed, infoEmbed } = require('../../utils/embed');
const { parseDate, parseTime } = require('../../utils/validate');
const { formatDate } = require('../../utils/format');
const { audit, logger } = require('../../utils/logger');
const { SPECIALTIES } = require('../../../config/index');

/** Строка для choices специальностей (автодополнение в Slash-команде). */
const specialtyChoices = SPECIALTIES.map((s) => ({ name: s.name, value: s.code }));

function buildTicketRows(ticketNumberValue) {
  const cancel = new ButtonBuilder()
    .setCustomId(`cancel_${ticketNumberValue}`)
    .setLabel('Отменить запись')
    .setStyle(ButtonStyle.Danger);

  const move = new ButtonBuilder()
    .setCustomId(`move_${ticketNumberValue}`)
    .setLabel('Перенести')
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder().addComponents(cancel, move);
}

async function create(interaction) {
  const ok = await requirePermission({
    interaction,
    permission: PERMISSIONS.CREATE_APPOINTMENT,
    commandName: 'appointment create',
  });
  if (!ok) return;

  const patientUser = interaction.options.getUser('patient');
  const specialty = interaction.options.getString('specialty') || 'terapevt';
  const dateInput = interaction.options.getString('date');
  const timeInput = interaction.options.getString('time');

  // Валидация даты и времени.
  const d = parseDate(dateInput);
  if (!d.ok) {
    await interaction.reply({ embeds: [errorEmbed(d.reason)], ephemeral: true });
    return;
  }
  const t = parseTime(timeInput);
  if (!t.ok) {
    await interaction.reply({ embeds: [errorEmbed(t.reason)], ephemeral: true });
    return;
  }

  // Пациент должен быть зарегистрирован в реестре.
  if (!patientExists(patientUser.id)) {
    await interaction.reply({
      embeds: [errorEmbed('Пациент не найден в реестре ЕМИАС.', {
        reason: 'Сначала выполните регистрацию пациента командой /patient register.',
      })],
      ephemeral: true,
    });
    return;
  }

  const patient = findPatientByUser(patientUser);
  const result = createTicket({
    patientId: patient.patient_id,
    specialty,
    date: d.value,
    time: t.value,
  });

  if (!result.ok) {
    audit({ action: 'APPOINTMENT_CREATE_FAIL', discordId: interaction.user.id, reason: result.reason });
    await interaction.reply({ embeds: [errorEmbed(result.reason)], ephemeral: true });
    return;
  }

  audit({
    action: 'APPOINTMENT_CREATE_OK',
    discordId: interaction.user.id,
    ticket: result.ticket.ticketNumber,
    patient: patient.fullName,
  });
  logger.info(`[REGISTRY] Талан создан: ${result.ticket.ticketNumber}`);

  const embed = ticketEmbed(result.ticket, patient.fullName, result.ticket.doctorName);
  const rows = buildTicketRows(result.ticket.ticketNumber);
  await interaction.reply({ embeds: [embed], components: [rows] });

  // Уведомление пациенту в ЛС.
  const dm = await patientUser.send({
    embeds: [
      infoEmbed(
        '🏥 НОВЫЙ ТАЛОН НА ПРИЁМ',
        `Уважаемый(ая) **${patient.fullName}**!\n\n` +
          `Вам назначен приём:\n` +
          `👨‍⚕️ **${result.ticket.doctorName}**\n` +
          `📅 ${d.display} · ${t.value}\n` +
          `🆔 Талон: **${result.ticket.ticketNumber}**`,
      ),
    ],
  }).catch(() => null);
  if (dm) {
    audit({ action: 'APPOINTMENT_DM_SENT', ticket: result.ticket.ticketNumber, patient: patient.fullName });
  }
}

async function list(interaction) {
  const ok = await requirePermission({
    interaction,
    permission: PERMISSIONS.CREATE_APPOINTMENT,
    commandName: 'appointment list',
  });
  if (!ok) return;

  const dateInput = interaction.options.getString('date');
  let date, display;
  if (dateInput) {
    const parsed = parseDate(dateInput);
    if (!parsed.ok) {
      await interaction.reply({ embeds: [errorEmbed(parsed.reason)], ephemeral: true });
      return;
    }
    date = parsed.value;
    display = parsed.display;
  } else {
    date = todayISO();
    display = formatDate(new Date());
  }

  const tickets = listTickets(date);

  audit({
    action: 'APPOINTMENT_LIST',
    discordId: interaction.user.id,
    date,
    count: tickets.length,
  });

  if (tickets.length === 0) {
    await interaction.reply({
      embeds: [infoEmbed('РЕЕСТР ЗАПИСЕЙ', `На ${display} записей нет.`)],
      ephemeral: true,
    });
    return;
  }

  const embed = infoEmbed('РЕЕСТР ЗАПИСЕЙ', `Список талонов на **${display}** — ${tickets.length} шт.`);
  embed.setColor(0x0066cc);
  for (const tk of tickets) {
    embed.addFields({
      name: `${tk.time} · ${tk.ticketNumber}`,
      value: `**${tk.patientName || '—'}** · ${tk.doctorName || ''} · ${tk.status}`,
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('appointment')
    .setDescription('Регистратура: управление записями на приём.')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Создать талон на приём.')
        .addUserOption((o) => o.setName('patient').setDescription('Пациент').setRequired(true))
        .addStringOption((o) => o.setName('date').setDescription('Дата ДД.ММ.ГГГГ').setRequired(true))
        .addStringOption((o) => o.setName('time').setDescription('Время ЧЧ:ММ').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('specialty')
            .setDescription('Специальность врача')
            .setRequired(false)
            .addChoices(...specialtyChoices),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Список записей на дату (по умолчанию — сегодня).')
        .addStringOption((o) => o.setName('date').setDescription('Дата ДД.ММ.ГГГГ').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create(interaction);
    if (sub === 'list') return list(interaction);
    await interaction.reply({ embeds: [errorEmbed('Неизвестная подкоманда.')], ephemeral: true });
  },
};