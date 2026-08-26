const { prisma } = require('../db/connection');

const DEFAULTS = {
  'webhook.appointments': { value: '', label: 'Вебхук — записи (талоны)' },
  'webhook.cards':        { value: '', label: 'Вебхук — медкарты (форум)' },
  'webhook.cards_forum':  { value: '', label: 'ID канала-форума (импорт)' },
  'log.staff_channel':    { value: '', label: 'Канал логов персонала' },
};

async function initDefaults() {
  for (const [key, def] of Object.entries(DEFAULTS)) {
    await prisma.settings.upsert({
      where: { key },
      update: {},
      create: { key, value: def.value, label: def.label },
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
  const row = await prisma.settings.findUnique({ where: { key }, select: { value: true } });
  return row ? row.value : (DEFAULTS[key] && DEFAULTS[key].value) || '';
}

async function set(key, value) {
  const label = (DEFAULTS[key] && DEFAULTS[key].label) || key;
  await prisma.settings.upsert({
    where: { key },
    update: { value: value || '', label },
    create: { key, value: value || '', label },
  });
}

async function del(key) {
  await prisma.settings.delete({ where: { key } });
}

module.exports = { initDefaults, getAll, get, set, del, DEFAULTS };
