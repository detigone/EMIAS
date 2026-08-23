'use strict';

const { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js');
const { registerUser } = require('../../commands/auth/authService');
const { createSuccessEmbed, createErrorEmbed } = require('../../templates/documentTemplates');
const { audit } = require('../../utils/logger');
const { validateUsername, validatePassword, validateFullName } = require('../../utils/validate');

/**
 * Модальное окно регистрации сотрудника в системе ЕМИАС
 */
function createRegisterModal(customId = 'register-modal') {
  const usernameInput = new TextInputBuilder()
    .setCustomId('username')
    .setLabel('Логин пользователя')
    .setPlaceholder('ivanov_ai')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(50);

  const passwordInput = new TextInputBuilder()
    .setCustomId('password')
    .setLabel('Пароль')
    .setPlaceholder('Минимум 8 символов')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
    .setMaxLength(100);

  const fullNameInput = new TextInputBuilder()
    .setCustomId('fullName')
    .setLabel('ФИО сотрудника')
    .setPlaceholder('Иванов Иван Иванович')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(150);

  const specialtyInput = new TextInputBuilder()
    .setCustomId('specialty')
    .setLabel('Специальность (опционально)')
    .setPlaceholder('Терапевт, Хирург и т.д.')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  const row1 = new ActionRowBuilder().addComponents(usernameInput);
  const row2 = new ActionRowBuilder().addComponents(passwordInput);
  const row3 = new ActionRowBuilder().addComponents(fullNameInput);
  const row4 = new ActionRowBuilder().addComponents(specialtyInput);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle('🆕 РЕГИСТРАЦИЯ СОТРУДНИКА')
    .addComponents(row1, row2, row3, row4);

  return modal;
}

/**
 * Обработчик модального окна регистрации
 */
async function handleRegisterModal(interaction) {
  const username = interaction.fields.getTextInputValue('username');
  const password = interaction.fields.getTextInputValue('password');
  const fullName = interaction.fields.getTextInputValue('fullName');
  const specialty = interaction.fields.getTextInputValue('specialty') || null;

  // Валидация
  const checks = [
    validateUsername(username),
    validatePassword(password),
    validateFullName(fullName),
  ];
  for (const c of checks) {
    if (!c.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('Ошибка валидации', c.reason)],
        ephemeral: true,
      });
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
    
    await interaction.reply({
      embeds: [createErrorEmbed('Не удалось зарегистрировать сотрудника', result.reason)],
      ephemeral: true,
    });
    return;
  }

  audit({
    action: 'REGISTER_OK',
    discordId: interaction.user.id,
    username: interaction.user.username,
    newUser: result.user.username,
  });

  const successEmbed = createSuccessEmbed(
    'РЕГИСТРАЦИЯ ВЫПОЛНЕНА',
    `**Сотрудник успешно зарегистрирован в системе ЕМИАС**\n\n` +
    `👤 ФИО: **${result.user.fullName}**\n` +
    `🆔 Логин: \`${result.user.username}\`\n` +
    `🧑‍⚕️ Специальность: ${result.user.specialty || '—'}\n` +
    `🪪 Роль: **${result.user.role}**\n` +
    `✅ Статус: Активна`,
    `УЗ-${result.user.userId}`
  );

  await interaction.reply({
    embeds: [successEmbed],
    ephemeral: true,
  });
}

handleRegisterModal.customId = 'register-modal';

module.exports = { createRegisterModal, handleRegisterModal };
