'use strict';

const { SlashCommandBuilder } = require('discord.js');
const view = require('./view');
const history = require('./history');
const addDiagnosis = require('./addDiagnosis');
const prescribe = require('./prescribe');
const generateForm = require('./generateForm');
const sickLeave = require('./sickLeave');
const { errorEmbed } = require('../../utils/embed');

/**
 * Команда /emr — агрегатор подкоманд модуля ЭМК.
 */
const data = new SlashCommandBuilder()
  .setName('emr')
  .setDescription('Электронная медицинская карта (ЭМК).')
  .addSubcommand(view.build)
  .addSubcommand(history.build)
  .addSubcommand(addDiagnosis.build)
  .addSubcommand(prescribe.build)
  .addSubcommand(generateForm.build)
  .addSubcommand(sickLeave.build);

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'view':
      return view.execute(interaction);
    case 'history':
      return history.execute(interaction);
    case 'add-diagnosis':
      return addDiagnosis.execute(interaction);
    case 'prescribe':
      return prescribe.execute(interaction);
    case 'generate-form':
      return generateForm.execute(interaction);
    case 'sick-leave':
      return sickLeave.execute(interaction);
    default:
      await interaction.reply({ embeds: [errorEmbed('Неизвестная подкоманда /emr.')], ephemeral: true });
  }
}

/**
 * Прокси autocomplete к соответствующей подкоманде.
 */
async function autocomplete(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'add-diagnosis' && typeof addDiagnosis.autocomplete === 'function') {
    return addDiagnosis.autocomplete(interaction);
  }
  await interaction.respond([]);
}

module.exports = { data, execute, autocomplete };