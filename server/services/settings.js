const { prisma } = require('../db/connection');

const DEFAULT_GUILD = '';

const DEFAULTS = {
  'webhook.appointments': { value: '', label: 'Вебхук — записи (талоны)' },
  'webhook.cards':        { value: '', label: 'Вебхук — медкарты (форум)' },
  'webhook.cards_forum':  { value: '', label: 'ID канала-форума (импорт)' },
  'log.staff_channel':    { value: '', label: 'Канал логов персонала' },
};

function guildIdOf() {
  return DEFAULT_GUILD;
}

async function initDefaults() {
  for (const [key, def] of Object.entries(DEFAULTS)) {
    await prisma.settings.upsert({
      where: { guildId_key: { guildId: guildIdOf(), key } },
      update: {},
      create: { guildId: guildIdOf(), key, value: def.value, label: def.label },
    });
  }
}

async function getAll() {
  const rows = await prisma.settings.findMany({ orderBy: { key: 'asc' } });
  const result = {};
  for (const r of rows) result[r.key] = r;
  return result;
}

async function get(key) {
  const row = await prisma.settings.findUnique({
    where: { guildId_key: { guildId: guildIdOf(), key } },
    select: { value: true },
  });
  return row ? row.value : (DEFAULTS[key] && DEFAULTS[key].value) || '';
}

async function set(key, value) {
  const label = (DEFAULTS[key] && DEFAULTS[key].label) || key;
  await prisma.settings.upsert({
    where: { guildId_key: { guildId: guildIdOf(), key } },
    update: { value: value || '', label },
    create: { guildId: guildIdOf(), key, value: value || '', label },
  });
}

async function del(key) {
  await prisma.settings.delete({ where: { guildId_key: { guildId: guildIdOf(), key } } });
}

module.exports = { initDefaults, getAll, get, set, del, DEFAULTS };
