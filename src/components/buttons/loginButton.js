'use strict';

const { createLoginModal } = require('../modals/index');

/**
 * Обработчик кнопки входа в систему
 */
async function handleLoginButton(interaction) {
  const modal = createLoginModal('login-modal');
  await interaction.showModal(modal);
}

// Явно указываем customId для сопоставления
handleLoginButton.customId = 'login-btn';

module.exports = handleLoginButton;
