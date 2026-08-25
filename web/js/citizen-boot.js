/* ЕМИАС — гражданский бутстрап.
   Выполняется СИНХРОННО до запуска основного бандла:
   1) без активного персонажа — редирект на выбор профиля;
   2) загружает данные ТОЛЬКО своего персонажа в window.__EMIAS_DATA__;
   3) инициализирует localStorage бандла реальными данными;
   4) перехватывает изменение талонов (emiaz.appointments) и синхронизирует с сервером. */
(function () {
  'use strict';

  function fetchSync(url, method, body) {
    try {
      var x = new XMLHttpRequest();
      x.open(method || 'GET', url, false);
      if (body) x.setRequestHeader('Content-Type', 'application/json');
      x.send(body ? JSON.stringify(body) : null);
      var data = null;
      try { data = JSON.parse(x.responseText); } catch (e) { /* noop */ }
      return { status: x.status, data: data };
    } catch (e) {
      return { status: 0, data: null };
    }
  }

  var res = fetchSync('/api/citizen/bootstrap');
  if (res.status === 403) {
    window.stop();
    window.location.replace('/login.html?tab=citizen&error=blocked');
    throw new Error('emias: not authorized');
  }
  if (res.status === 401) {
    // Просто нет сессии/персонаж не выбран — тихо показываем экран входа.
    window.stop();
    window.location.replace('/login.html?tab=citizen');
    throw new Error('emias: not authorized');
  }
  if (res.status !== 200 || !res.data || !res.data.activeId) {
    window.stop();
    window.location.replace('/login.html?tab=citizen&error=net');
    throw new Error('emias: bootstrap failed');
  }

  var DATA = res.data;
  window.__EMIAS_DATA__ = DATA;

  // ---- Инициализация localStorage бандла данными персонажа --------------------
  // Ключи должны быть перезаписаны КАЖДЫЙ вход: на общем компьютере в
  // localStorage могут лежать данные чужого аккаунта.
  var LS_APPTS = 'emiaz.appointments';
  var LS_ACTIVE = 'emiaz.activeMemberId';
  var LS_DBMAP = 'emiaz.dbmap';
  try {
    localStorage.setItem(LS_APPTS, JSON.stringify(DATA.appointments));
    localStorage.setItem(LS_ACTIVE, JSON.stringify(DATA.activeId));
    localStorage.removeItem('emiaz.profiles'); // левые правки профилей
    localStorage.removeItem('emiaz.notificationsRead');
  } catch (e) { /* приватный режим */ }

  // ---- Перехват записи талонов -------------------------------------------------
  var lastSeen = null;
  try { lastSeen = localStorage.getItem(LS_APPTS); } catch (e) { }

  var origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSetItem.call(this, k, v);
    if (k !== LS_APPTS || v === lastSeen) return;
    try { syncDiff(lastSeen, v); } catch (e) { console.warn('emias sync:', e); }
    lastSeen = v;
  };

  function flatten(raw) {
    var out = {};
    var obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    Object.keys(obj || {}).forEach(function (memberKey) {
      (obj[memberKey] || []).forEach(function (a) { out[a.id] = a; });
    });
    return out;
  }

  function readMap() {
    try { return JSON.parse(localStorage.getItem(LS_DBMAP) || '{}'); } catch (e) { return {}; }
  }
  function writeMap(m) {
    try { origSetItem.call(localStorage, LS_DBMAP, JSON.stringify(m)); } catch (e) { }
  }

  function api(url, body) {
    var r = fetchSync(url, 'POST', body);
    if (r.status >= 400) throw new Error((r.data && r.data.error) || ('HTTP ' + r.status));
    return r.data;
  }

  /** Добавленные в приложении талоны -> реальные талоны в БД; удалённые -> отмена. */
  function syncDiff(prevRaw, nextRaw) {
    var prev = flatten(prevRaw), next = flatten(nextRaw), map = readMap();
    var changed = false;

    Object.keys(next).forEach(function (id) {
      if (prev[id]) return;
      if (/^a\d+$/.test(id)) return; // уже из БД
      var a = next[id];
      if (!a.date || !a.time) return;
      var resp = api('/api/citizen/appointments', {
        date: a.date,
        time: a.time,
        doctorId: /^d\d+$/.test(String(a.doctorId)) ? String(a.doctorId) : ''
      });
      map[id] = resp.appointment.id;
      changed = true;
    });

    Object.keys(prev).forEach(function (id) {
      if (next[id]) return;
      var dbId = map[id];
      delete map[id];
      if (!dbId) return;
      if (/^a\d+$/.test(String(dbId))) {
        api('/api/citizen/appointments/' + String(dbId).slice(1) + '/cancel', {});
        changed = true;
        return;
      }
      api('/api/citizen/appointments/' + dbId + '/cancel', {});
      changed = true;
    });

    if (changed) writeMap(map);
  }
})();
