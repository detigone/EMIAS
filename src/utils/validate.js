'use strict';

/**
 * Валидация пользовательского ввода.
 * Все входные данные нормализуются; некорректные значения отклоняются.
 */

/** Минимальная длина пароля. */
const PASSWORD_MIN_LENGTH = 8;

/** Допустимый формат логина: латиница, цифры, точка, подчёркивание. */
const USERNAME_RE = /^[A-Za-z0-9._]{3,32}$/;

function validateUsername(value) {
  const v = String(value || '').trim();
  if (!USERNAME_RE.test(v)) {
    return { ok: false, reason: 'Логин должен содержать 3–32 символа: латиница, цифры, точка или подчёркивание.' };
  }
  return { ok: true, value: v };
}

function validatePassword(value) {
  const v = String(value || '');
  if (v.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов.` };
  }
  return { ok: true, value: v };
}

function validateFullName(value) {
  const v = String(value || '').trim();
  if (v.length < 3) {
    return { ok: false, reason: 'Укажите корректное ФИО (не менее 3 символов).' };
  }
  return { ok: true, value: v };
}

/** Нормализация кода МКБ-10 (например, "j06.9" -> "J06.9"). */
function normalizeMkbCode(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Парсинг даты приёма. Принимает ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.
 * @returns {object} { ok, value?:'YYYY-MM-DD', display?:'DD.MM.YYYY', reason? }
 */
function parseDate(value) {
  const raw = String(value || '').trim();
  let m;
  m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return buildDate(yyyy, mm, dd);
  }
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    return buildDate(yyyy, mm, dd);
  }
  return { ok: false, reason: 'Дата должна быть в формате ДД.ММ.ГГГГ (например, 24.08.2026).' };
}

function buildDate(yyyy, mm, dd) {
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (
    d.getFullYear() !== Number(yyyy) ||
    d.getMonth() !== Number(mm) - 1 ||
    d.getDate() !== Number(dd)
  ) {
    return { ok: false, reason: 'Указана некорректная дата.' };
  }
  return {
    ok: true,
    value: `${yyyy}-${mm}-${dd}`,
    display: `${dd}.${mm}.${yyyy}`,
  };
}

/**
 * Парсинг времени приёма в формате ЧЧ:ММ.
 * @returns {object} { ok, value?, reason? }
 */
function parseTime(value) {
  const m = String(value || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) {
    return { ok: false, reason: 'Время должно быть в формате ЧЧ:ММ (например, 15:00).' };
  }
  return { ok: true, value: `${String(m[1]).padStart(2, '0')}:${m[2]}` };
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  validateUsername,
  validatePassword,
  validateFullName,
  normalizeMkbCode,
  parseDate,
  parseTime,
};