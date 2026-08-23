'use strict';

const { ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Кнопки для взаимодействия с системой ЕМИАС.
 * Все кнопки стилизованы в соответствии с цветами и терминологией Минздрава.
 */

/**
 * Кнопка вызова модального окна входа
 */
function createLoginButton() {
  return new ButtonBuilder()
    .setCustomId('login-btn')
    .setLabel('🔐 Войти в систему')
    .setStyle(ButtonStyle.Primary);
}

/**
 * Кнопка вызова модального окна регистрации пациента
 */
function createRegisterPatientButton() {
  return new ButtonBuilder()
    .setCustomId('register-patient-btn')
    .setLabel('📋 Зарегистрировать пациента')
    .setStyle(ButtonStyle.Success);
}

/**
 * Кнопка вызова модального окна записи на приём
 */
function createAppointmentButton() {
  return new ButtonBuilder()
    .setCustomId('appointment-btn')
    .setLabel('📅 Записаться на приём')
    .setStyle(ButtonStyle.Primary);
}

/**
 * Кнопка просмотра ЭМК
 */
function createViewEMRButton() {
  return new ButtonBuilder()
    .setCustomId('view-emr-btn')
    .setLabel('📄 Просмотреть ЭМК')
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Кнопка добавления диагноза
 */
function createAddDiagnosisButton() {
  return new ButtonBuilder()
    .setCustomId('add-diagnosis-btn')
    .setLabel('🏥 Добавить диагноз')
    .setStyle(ButtonStyle.Primary);
}

/**
 * Кнопка назначения рецепта
 */
function createPrescribeButton() {
  return new ButtonBuilder()
    .setCustomId('prescribe-btn')
    .setLabel('💊 Назначить рецепт')
    .setStyle(ButtonStyle.Success);
}

/**
 * Кнопка отмены талона
 */
function createCancelTicketButton() {
  return new ButtonBuilder()
    .setCustomId('cancel-ticket-btn')
    .setLabel('❌ Отменить талон')
    .setStyle(ButtonStyle.Danger);
}

/**
 * Кнопка переноса талона
 */
function createMoveTicketButton() {
  return new ButtonBuilder()
    .setCustomId('move-ticket-btn')
    .setLabel('🔄 Перенести талон')
    .setStyle(ButtonStyle.Secondary);
}

/**
 * Кнопка выхода из системы
 */
function createLogoutButton() {
  return new ButtonBuilder()
    .setCustomId('logout-btn')
    .setLabel('🚪 Выйти из системы')
    .setStyle(ButtonStyle.Danger);
}

/**
 * Кнопка обновления данных
 */
function createRefreshButton() {
  return new ButtonBuilder()
    .setCustomId('refresh-btn')
    .setLabel('🔄 Обновить')
    .setStyle(ButtonStyle.Secondary);
}

module.exports = {
  createLoginButton,
  createRegisterPatientButton,
  createAppointmentButton,
  createViewEMRButton,
  createAddDiagnosisButton,
  createPrescribeButton,
  createCancelTicketButton,
  createMoveTicketButton,
  createLogoutButton,
  createRefreshButton,
};
