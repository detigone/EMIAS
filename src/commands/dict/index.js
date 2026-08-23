'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { createInfoEmbed } = require('../../templates/documentTemplates');

/**
 * Команда /dict — главное меню справочников ЕМИАС.
 * Вместо подкоманд используется информационное меню с описанием доступных справочников.
 */
const data = new SlashCommandBuilder()
  .setName('dict')
  .setDescription('Справочники системы ЕМИАС (МКБ-10, специальности).')
  .addStringOption((o) =>
    o.setName('query')
      .setDescription('Поиск диагноза по коду МКБ-10 или тексту')
      .setRequired(false)
  );

async function execute(interaction) {
  const query = interaction.options.getString('query');
  
  // Если есть запрос — выполняем поиск
  if (query) {
    const { search, findByCode } = require('../../../config/mkb10');
    const { infoEmbed } = require('../../utils/embed');
    
    const byCode = findByCode(query);
    if (byCode) {
      const embed = createInfoEmbed(
        '📖 СПРАВОЧНИК МКБ-10',
        `**Код:** \`${byCode.code}\`\n` +
        `**Наименование:** ${byCode.name}`
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const results = search(query, 8);
    if (results.length === 0) {
      await interaction.reply({
        embeds: [infoEmbed('СПРАВОЧНИК МКБ-10', `По запросу «**${query}**» ничего не найдено.`)],
        ephemeral: true,
      });
      return;
    }

    const embed = createInfoEmbed(
      '📖 СПРАВОЧНИК МКБ-10',
      `По запросу «**${query}**» найдено совпадений: **${results.length}**`
    );
    for (const r of results) {
      embed.addFields({ name: `\`${r.code}\``, value: r.name, inline: false });
    }
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Главное меню справочников
  const embed = createInfoEmbed(
    '📖 СПРАВОЧНИКИ ЕМИАС',
    '**Доступные справочники:**\n\n' +
    '🏥 **МКБ-10** — Международная классификация болезней\n' +
    '• Используйте параметр `query` для поиска диагноза\n' +
    '• Пример: `/dict query:J06.9`\n\n' +
    '👨‍⚕️ **Специальности врачей** — список доступных специальностей\n' +
    '• Терапевт, Хирург, Невролог и др.\n' +
    '• Используется при записи на приём'
  );

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

module.exports = { data, execute };
