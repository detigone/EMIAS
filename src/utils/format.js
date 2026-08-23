'use strict';

/**
 * Утилиты форматирования дат, номеров документов и данных.
 */

/** Номер карты ЭМК: ЕМК-YYYY-XXXXXX */
function cardNumber(year, seq) {
  const y = year || new Date().getFullYear();
  return `ЕМК-${y}-${String(seq).padStart(6, '0')}`;
}

/** Номер талона: Т-YYYY-MM-DD-NNNN */
function ticketNumber(dateStr, seq) {
  return `Т-${dateStr}-${String(seq).padStart(4, '0')}`;
}

/** Дата в формате ДД.ММ.ГГГГ */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** Дата+время для истории обращений: ДД.ММ.ГГГГ ЧЧ:ММ */
function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(d)} ${hh}:${mm}`;
}

/** Группа крови в человекочитаемом виде. */
function bloodGroup(value) {
  const map = {
    '0(I)': '0 (I) Rh+',
    '0(I)-': '0 (I) Rh−',
    'A(II)': 'A (II) Rh+',
    'A(II)-': 'A (II) Rh−',
    'B(III)': 'B (III) Rh+',
    'B(III)-': 'B (III) Rh−',
    'AB(IV)': 'AB (IV) Rh+',
    'AB(IV)-': 'AB (IV) Rh−',
  };
  return map[value] || value || 'Не указана';
}

/** Склонение слова «запись» по числу. */
function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

module.exports = { cardNumber, ticketNumber, formatDate, formatDateTime, bloodGroup, plural };