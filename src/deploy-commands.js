'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { collectCommandData } = require('./core/commandLoader');
const { logger } = require('./utils/logger');

/**
 * Регистрация slash-команд на гильдию (быстрое обновление при разработке).
 */
async function main() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!token || !guildId) {
    logger.error('[DEPLOY] Задайте DISCORD_TOKEN и GUILD_ID в .env');
    process.exit(1);
  }

  const commands = collectCommandData();
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    logger.info(`[DEPLOY] Регистрация ${commands.length} команд...`);
    const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    logger.info(`[DEPLOY] Успешно зарегистрировано команд: ${data.length}`);
  } catch (err) {
    logger.error('[DEPLOY] Ошибка регистрации:', { message: err.message });
    process.exit(1);
  }
}

main();