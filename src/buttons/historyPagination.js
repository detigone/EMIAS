'use strict';

const { buildPayload } = require('../commands/emr/history');
const { audit } = require('../utils/logger');

/**
 * Обработчик кнопок пагинации истории обращений.
 * customId: hist_<pageIndex>_<patientId>
 */
async function paginationHandler(interaction) {
  const parts = interaction.customId.split('_');
  const pageIndex = Number(parts[1]);
  const patientId = Number(parts[2]);

  audit({ action: 'EMR_HISTORY_PAGE', discordId: interaction.user.id, patientId, page: pageIndex });

  const payload = buildPayload(pageIndex, patientId);
  await interaction.update(payload);
}

module.exports = { id: 'hist', handler: paginationHandler };