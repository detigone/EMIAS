'use strict';

const { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js');

/**
 * Модальные окна для ввода данных в стиле ЕМИАС.
 * Каждый модальный диалог представляет собой форму с полями ввода,
 * стилизованными под официальные бланки Минздрава.
 */

/**
 * Модальное окно входа в систему (LOGIN)
 * @param {string} customId - Уникальный ID для обработки
 * @returns {ModalBuilder}
 */
function createLoginModal(customId = 'login-modal') {
  const usernameInput = new TextInputBuilder()
    .setCustomId('username')
    .setLabel('Логин пользователя')
    .setPlaceholder('Введите ваш логин (например, ivanov_ai)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(50);

  const passwordInput = new TextInputBuilder()
    .setCustomId('password')
    .setLabel('Пароль')
    .setPlaceholder('Введите пароль')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(100);

  const row1 = new ActionRowBuilder().addComponents(usernameInput);
  const row2 = new ActionRowBuilder().addComponents(passwordInput);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle('🔐 ВХОД В СИСТЕМУ ЕМИАС')
    .addComponents(row1, row2);

  return modal;
}

/**
 * Модальное окно регистрации пациента
 * @param {string} customId - Уникальный ID для обработки
 * @returns {ModalBuilder}
 */
function createPatientRegisterModal(customId = 'patient-register-modal') {
  const fullNameInput = new TextInputBuilder()
    .setCustomId('fullName')
    .setLabel('ФИО пациента')
    .setPlaceholder('Иванов Иван Иванович')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(150);

  const birthDateInput = new TextInputBuilder()
    .setCustomId('birthDate')
    .setLabel('Дата рождения')
    .setPlaceholder('ДД.ММ.ГГГГ (например, 15.05.1985)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const omsInput = new TextInputBuilder()
    .setCustomId('omsNumber')
    .setLabel('Номер полиса ОМС')
    .setPlaceholder('1234567890123456 (16 цифр)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(16)
    .setMaxLength(16);

  const bloodInput = new TextInputBuilder()
    .setCustomId('bloodType')
    .setLabel('Группа крови')
    .setPlaceholder('A(I), B(II), AB(III), O(IV) + Rh')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(50);

  const allergiesInput = new TextInputBuilder()
    .setCustomId('allergies')
    .setLabel('Аллергии (через запятую)')
    .setPlaceholder('Пенициллин, Аспирин, Цитрусовые')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  const row1 = new ActionRowBuilder().addComponents(fullNameInput);
  const row2 = new ActionRowBuilder().addComponents(birthDateInput);
  const row3 = new ActionRowBuilder().addComponents(omsInput);
  const row4 = new ActionRowBuilder().addComponents(bloodInput);
  const row5 = new ActionRowBuilder().addComponents(allergiesInput);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle('📋 РЕГИСТРАЦИЯ ПАЦИЕНТА')
    .addComponents(row1, row2, row3, row4, row5);

  return modal;
}

/**
 * Модальное окно записи на приём к врачу
 * @param {string} customId - Уникальный ID для обработки
 * @returns {ModalBuilder}
 */
function createAppointmentModal(customId = 'appointment-modal') {
  const specialtyInput = new TextInputBuilder()
    .setCustomId('specialty')
    .setLabel('Специальность врача')
    .setPlaceholder('Терапевт, Хирург, Невролог и т.д.')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const dateInput = new TextInputBuilder()
    .setCustomId('date')
    .setLabel('Желаемая дата приёма')
    .setPlaceholder('ДД.ММ.ГГГГ')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10);

  const timeInput = new TextInputBuilder()
    .setCustomId('time')
    .setLabel('Желаемое время')
    .setPlaceholder('ЧЧ:ММ (например, 14:30)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(5);

  const complaintInput = new TextInputBuilder()
    .setCustomId('complaint')
    .setLabel('Жалобы (кратко)')
    .setPlaceholder('Опишите основные симптомы')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  const row1 = new ActionRowBuilder().addComponents(specialtyInput);
  const row2 = new ActionRowBuilder().addComponents(dateInput);
  const row3 = new ActionRowBuilder().addComponents(timeInput);
  const row4 = new ActionRowBuilder().addComponents(complaintInput);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle('📅 ЗАПИСЬ НА ПРИЁМ')
    .addComponents(row1, row2, row3, row4);

  return modal;
}

/**
 * Модальное окно добавления диагноза (МКБ-10)
 * @param {string} customId - Уникальный ID для обработки
 * @returns {ModalBuilder}
 */
function createDiagnosisModal(customId = 'diagnosis-modal') {
  const mkbCodeInput = new TextInputBuilder()
    .setCustomId('mkbCode')
    .setLabel('Код МКБ-10')
    .setPlaceholder('Например: J06.9, I10, E11.9')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(10);

  const diagnosisTextInput = new TextInputBuilder()
    .setCustomId('diagnosisText')
    .setLabel('Текст диагноза')
    .setPlaceholder('Расшифровка диагноза')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Примечания врача')
    .setPlaceholder('Дополнительная информация')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  const row1 = new ActionRowBuilder().addComponents(mkbCodeInput);
  const row2 = new ActionRowBuilder().addComponents(diagnosisTextInput);
  const row3 = new ActionRowBuilder().addComponents(notesInput);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle('🏥 ДОБАВЛЕНИЕ ДИАГНОЗА')
    .addComponents(row1, row2, row3);

  return modal;
}

/**
 * Модальное окно назначения рецепта
 * @param {string} customId - Уникальный ID для обработки
 * @returns {ModalBuilder}
 */
function createPrescriptionModal(customId = 'prescription-modal') {
  const medicationInput = new TextInputBuilder()
    .setCustomId('medication')
    .setLabel('Название препарата')
    .setPlaceholder('Международное непатентованное наименование')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const dosageInput = new TextInputBuilder()
    .setCustomId('dosage')
    .setLabel('Дозировка и схема приёма')
    .setPlaceholder('Например: по 1 таблетке 2 раза в день после еды')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  const durationInput = new TextInputBuilder()
    .setCustomId('duration')
    .setLabel('Длительность курса')
    .setPlaceholder('Например: 7 дней, 2 недели')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  const row1 = new ActionRowBuilder().addComponents(medicationInput);
  const row2 = new ActionRowBuilder().addComponents(dosageInput);
  const row3 = new ActionRowBuilder().addComponents(durationInput);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle('💊 НАЗНАЧЕНИЕ РЕЦЕПТА')
    .addComponents(row1, row2, row3);

  return modal;
}

module.exports = {
  createLoginModal,
  createPatientRegisterModal,
  createAppointmentModal,
  createDiagnosisModal,
  createPrescriptionModal,
};
