'use strict';

const { buildPayload } = require('../commands/registry/queue');
const { audit } = require('../utils/logger');

/**
 * Обработчик кнопок пагинации очереди приёма.
 * customId: queue_<pageIndex>_<date YYYY-MM-DD>
 */
async function queuePaginationHandler(interaction) {
  const parts = interaction.customId.split('_');
  const pageIndex = Number(parts[1]);
  const date = parts.slice(2).join('_');

  audit({ action: 'QUEUE_PAGE', discordId: interaction.user.id, date, page: pageIndex });

  const payload = buildPayload(pageIndex, date);
  await interaction.update(payload);
}

module.exports = { id: 'queue', handler: queuePaginationHandler };