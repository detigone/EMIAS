'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { search, findByCode } = require('../../../config/mkb10');
const { SPECIALTIES } = require('../../../config/index');
const { documentHeader, errorEmbed, infoEmbed } = require('../../utils/embed');

/**
 * Команда /dict — работа со справочниками (МКБ-10, специальности).
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dict')
    .setDescription('Справочники системы ЕМИАС.')
    .addSubcommand((s) =>
      s
        .setName('find')
        .setDescription('Поиск диагноза по коду МКБ-10 или тексту.')
        .addStringOption((o) => o.setName('query').setDescription('Код (J06.9) или фрагмент названия').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('specialties').setDescription('Список специальностей врачей.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'find') {
      const query = interaction.options.getString('query');
      const byCode = findByCode(query);

      if (byCode) {
        const embed = documentHeader({ title: 'СПРАВОЧНИК МКБ-10', docNumber: byCode.code });
        embed.addFields(
          { name: '🆔 Код', value: `\`${byCode.code}\``, inline: true },
          { name: '📋 Наименование', value: byCode.name, inline: false },
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

      const embed = documentHeader({ title: 'СПРАВОЧНИК МКБ-10', docNumber: 'результаты поиска' });
      embed.setDescription(`По запросу «**${query}**» найдено совпадений: **${results.length}**`);
      for (const r of results) {
        embed.addFields({ name: `\`${r.code}\``, value: r.name, inline: false });
      }
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'specialties') {
      const embed = documentHeader({ title: 'СПЕЦИАЛЬНОСТИ ВРАЧЕЙ', docNumber: SPECIALTIES.length + ' записей' });
      embed.setDescription('Доступные специальности для записи на приём:');
      for (const s of SPECIALTIES) {
        embed.addFields({ name: s.name, value: `\`${s.code}\``, inline: true });
      }
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    await interaction.reply({ embeds: [errorEmbed('Неизвестная подкоманда.')], ephemeral: true });
  },
};