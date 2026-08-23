'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { loginUser } = require('./authService');
const { requirePermission } = require('../../core/permissionGuard');
const { successEmbed, errorEmbed } = require('../../utils/embed');
const { validateUsername } = require('../../utils/validate');
const { audit } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('login')
    .setDescription('Вход в систему ЕМИАС.')
    .addStringOption((o) => o.setName('username').setDescription('Логин').setRequired(true))
    .addStringOption((o) => o.setName('password').setDescription('Пароль').setRequired(true)),

  async execute(interaction) {
    const ok = await requirePermission({ interaction, commandName: 'login' });
    if (!ok) return;

    const username = interaction.options.getString('username');
    const password = interaction.options.getString('password');

    const uCheck = validateUsername(username);
    if (!uCheck.ok) {
      await interaction.reply({ embeds: [errorEmbed(uCheck.reason)], ephemeral: true });
      return;
    }

    const result = loginUser({
      username,
      password,
      discordId: interaction.user.id,
    });

    if (!result.ok) {
      audit({ action: 'LOGIN_FAIL', discordId: interaction.user.id, reason: result.reason });
      await interaction.reply({ embeds: [errorEmbed(result.reason)], ephemeral: true });
      return;
    }

    audit({ action: 'LOGIN_OK', discordId: interaction.user.id, username: result.user.username });
    await interaction.reply({
      embeds: [successEmbed(
        'ВХОД В СИСТЕМУ',
        `Добро пожаловать, **${result.user.fullName}**.\nРоль: **${result.user.role}**\nСессия открыта.`,
        `SESS-${result.session.token.slice(0, 8)}`,
      )],
      ephemeral: true,
    });
  },
};