'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { registerUser } = require('./authService');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { successEmbed, errorEmbed, officialDocument } = require('../../utils/embed');
const { validateUsername, validatePassword, validateFullName } = require('../../utils/validate');
const { audit, logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Регистрация сотрудника в системе ЕМИАС (требует роль «Медицинский персонал»).')
    .addStringOption((o) => o.setName('username').setDescription('Логин для входа').setRequired(true))
    .addStringOption((o) => o.setName('password').setDescription('Пароль (мин. 8 символов)').setRequired(true))
    .addStringOption((o) => o.setName('fullname').setDescription('ФИО сотрудника').setRequired(true))
    .addStringOption((o) => o.setName('specialty').setDescription('Специальность').setRequired(false)),

  async execute(interaction) {
    const ok = await requirePermission({
      interaction,
      permission: PERMISSIONS.REGISTER,
      commandName: 'register',
    });
    if (!ok) return;

    const username = interaction.options.getString('username');
    const password = interaction.options.getString('password');
    const fullName = interaction.options.getString('fullname');
    const specialty = interaction.options.getString('specialty');

    // Валидация входных данных.
    const checks = [
      validateUsername(username),
      validatePassword(password),
      validateFullName(fullName),
    ];
    for (const c of checks) {
      if (!c.ok) {
        await interaction.reply({ embeds: [errorEmbed(c.reason)], ephemeral: true });
        return;
      }
    }

    const result = registerUser({
      username,
      password,
      fullName,
      specialty,
      discordId: interaction.user.id,
    });

    if (!result.ok) {
      audit({ action: 'REGISTER_FAIL', discordId: interaction.user.id, reason: result.reason });
      await interaction.reply({ embeds: [errorEmbed(result.reason)], ephemeral: true });
      return;
    }

    audit({
      action: 'REGISTER_OK',
      discordId: interaction.user.id,
      username: interaction.user.username,
      newUser: result.user.username,
    });
    logger.info(`[AUTH] Регистрация пользователя ${result.user.username}`);

    // Стилизованный документ «Регистрация в системе ЕМИАС».
    const doc = officialDocument({
      title: 'РЕГИСТРАЦИЯ В СИСТЕМЕ ЕМИАС',
      docNumber: `УЗ-${result.user.userId}`,
      color: 0x0066cc,
    });
    doc.addFields(
      { name: '👤 ФИО', value: result.user.fullName, inline: true },
      { name: '🆔 Логин', value: result.user.username, inline: true },
      { name: '🧑‍⚕️ Специальность', value: result.user.specialty || '—', inline: true },
      { name: '🪪 Роль', value: result.user.role, inline: true },
      { name: '✅ Статус', value: 'Активна', inline: true },
    );
    doc.addFields({ name: 'Штамп', value: '✅ УТВЕРЖДЕНО · 🔒 КОНФИДЕНЦИАЛЬНО', inline: false });

    await interaction.reply({ embeds: [doc], ephemeral: true });
  },
};