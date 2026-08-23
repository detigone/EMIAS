'use strict';

const { loginUser } = require('../../commands/auth/authService');
const { createSuccessEmbed, createErrorEmbed } = require('../../templates/documentTemplates');
const { audit } = require('../../utils/logger');

/**
 * Обработчик модального окна входа в систему
 */
async function handleLoginModal(interaction) {
  const username = interaction.fields.getTextInputValue('username');
  const password = interaction.fields.getTextInputValue('password');

  const result = loginUser({
    username,
    password,
    discordId: interaction.user.id,
  });

  if (!result.ok) {
    audit({ action: 'LOGIN_FAIL', discordId: interaction.user.id, reason: result.reason });
    
    const errorEmbed = createErrorEmbed(
      'Не удалось войти в систему',
      result.reason
    );
    
    await interaction.reply({
      embeds: [errorEmbed],
      ephemeral: true,
    });
    return;
  }

  audit({ action: 'LOGIN_OK', discordId: interaction.user.id, username: result.user.username });
  
  const successEmbed = createSuccessEmbed(
    'ВХОД В СИСТЕМУ ВЫПОЛНЕН',
    `**Добро пожаловать, ${result.user.fullName}!**\n\n` +
    `🆔 Логин: \`${result.user.username}\`\n` +
    `👤 Роль: **${result.user.role}**\n` +
    `🔐 Сессия: \`SESS-${result.session.token.slice(0, 8)}\`\n\n` +
    'Теперь вы можете использовать все функции системы ЕМИАС.',
    `SESS-${result.session.token.slice(0, 8)}`
  );

  await interaction.reply({
    embeds: [successEmbed],
    ephemeral: true,
  });
}

// Явно указываем customId для сопоставления
handleLoginModal.customId = 'login-modal';

module.exports = handleLoginModal;
