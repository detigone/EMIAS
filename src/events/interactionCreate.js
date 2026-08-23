'use strict';

const { Events } = require('discord.js');
const { errorEmbed } = require('../utils/embed');
const { audit, logger } = require('../utils/logger');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Автодополнение (autocomplete) — только предложения, без права на ответ.
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command && typeof command.autocomplete === 'function') {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          logger.error(`[AUTO] Ошибка автодополнения ${interaction.commandName}:`, { message: err.message });
          try {
            await interaction.respond([]);
          } catch (_) { /* ignore */ }
        }
      }
      return;
    }

    // Обработка slash-команд.
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        await interaction.reply({
          embeds: [errorEmbed('Команда не найдена в системе ЕМИАС.')],
          ephemeral: true,
        });
        return;
      }

      try {
        await command.execute(interaction);
      } catch (err) {
        logger.error(`[CMD] Ошибка выполнения /${interaction.commandName}:`, { message: err.message, stack: err.stack });
        audit({ action: 'COMMAND_ERROR', discordId: interaction.user.id, command: interaction.commandName, error: err.message });
        const payload = { embeds: [errorEmbed('Произошла внутренняя ошибка при выполнении операции.')], ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      }
      return;
    }

    // Обработка кнопок.
    if (interaction.isButton()) {
      const handler = interaction.client.buttons.get(interaction.customId.split('_')[0]);
      if (handler) {
        try {
          await handler(interaction);
        } catch (err) {
          logger.error(`[BTN] Ошибка обработки кнопки ${interaction.customId}:`, err);
          await interaction.reply({ embeds: [errorEmbed('Ошибка обработки действия.')], ephemeral: true });
        }
      }
      return;
    }

    // Обработка выпадающих меню.
    if (interaction.isStringSelectMenu()) {
      const handler = interaction.client.selectMenus.get(interaction.customId.split('_')[0]);
      if (handler) {
        try {
          await handler(interaction);
        } catch (err) {
          logger.error(`[SELECT] Ошибка обработки меню ${interaction.customId}:`, err);
        }
      }
      return;
    }

    // Обработка модальных окон.
    if (interaction.isModalSubmit()) {
      const handler = interaction.client.modals.get(interaction.customId.split('_')[0]);
      if (handler) {
        try {
          await handler(interaction);
        } catch (err) {
          logger.error(`[MODAL] Ошибка обработки модалки ${interaction.customId}:`, err);
          if (!interaction.replied) {
            await interaction.reply({ embeds: [errorEmbed('Ошибка обработки формы.')], ephemeral: true });
          }
        }
      }
      return;
    }
  },
};