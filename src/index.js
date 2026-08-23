'use strict';

const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { registerCommands } = require('./core/commandLoader');
const { registerButtons } = require('./core/buttonLoader');
const { registerModals } = require('./core/modalLoader');
const { loadEvents } = require('./core/eventLoader');
const initDatabase = require('./db/init');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
client.buttons = new Collection();
client.modals = new Collection();
client.selectMenus = new Collection();

async function bootstrap() {
  // Инициализация БД
  initDatabase();
  
  // Загрузка модулей
  await registerCommands(client);
  await registerButtons(client);
  await registerModals(client);
  await loadEvents(client);

  // Вход в Discord
  if (!process.env.DISCORD_TOKEN) {
    console.error('[FATAL] Переменная окружения DISCORD_TOKEN не установлена');
    process.exit(1);
  }
  
  client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('[FATAL] Ошибка авторизации бота:', err.message);
    process.exit(1);
  });
}

bootstrap();

module.exports = client;
