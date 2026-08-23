'use strict';

const { Client, GatewayIntentBits, Collection } = require('discord.js');

/**
 * Единственный экземпляр Discord-клиента.
 * Команды и обработчики кнопок хранятся в коллекциях для быстрого доступа.
 */
function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
    ],
  });

  // commandName => команда; customId => обработчик кнопок/меню/модалок
  client.commands = new Collection();
  client.buttons = new Collection();
  client.selectMenus = new Collection();
  client.modals = new Collection();

  return client;
}

module.exports = { createClient };