'use strict';

const { createRegisterModal } = require('../modals/index');

/**
 * Обработчик кнопки регистрации сотрудника
 */
async function handleRegisterButton(interaction) {
  const modal = createRegisterModal('register-modal');
  await interaction.showModal(modal);
}

handleRegisterButton.customId = 'register-btn';

module.exports = handleRegisterButton;
