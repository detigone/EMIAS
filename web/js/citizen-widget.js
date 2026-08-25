/* ЕМИАС — виджет гражданина поверх приложения.
   Требует window.__EMIAS_DATA__ (создаётся citizen-boot.js). */
(function () {
  'use strict';
  var D = window.__EMIAS_DATA__;
  if (!D || !D.members || !D.members.length) return;

  var me = null;
  var activeId = String(D.activeId);
  for (var i = 0; i < D.members.length; i++) if (String(D.members[i].id) === activeId) me = D.members[i];
  if (!me) me = D.members[0];

  var SPEC_LABELS = { therapist: 'Терапевт', pediatrician: 'Педиатр', surgeon: 'Хирург', ophthalmologist: 'Офтальмолог', ent: 'ЛОР' };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Стили ------------------------------------------------------------------
  var css =
    '.emw*{box-sizing:border-box}' +
    '.emw-pill{position:fixed;right:14px;bottom:88px;z-index:9500;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e6edf6;border-radius:999px;padding:7px 8px 7px 8px;box-shadow:0 12px 32px -14px rgba(31,64,135,.45);font:600 12.5px Manrope,system-ui,sans-serif;color:#0f2b4e}' +
    '.emw-ava{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px}' +
    '.emw-name{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.emw-btn{border:none;background:#2563eb;color:#fff;font:700 12px Manrope,sans-serif;border-radius:999px;padding:7px 13px;cursor:pointer;transition:.15s;font-family:inherit}' +
    '.emw-btn:hover{background:#1d4ed8}' +
    '.emw-btn.sec{background:#eef3fb;color:#0f2b4e;border:1px solid #e6edf6}' +
    '.emw-btn.sec:hover{background:#e0ebff}' +
    '.emw-back{position:fixed;top:0;left:0;right:0;bottom:0;z-index:9600;background:rgba(15,23,42,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:18px}' +
    '.emw-modal{background:#fff;border-radius:22px;box-shadow:0 30px 80px -20px rgba(15,23,42,.5);width:min(480px,94vw);max-height:88vh;overflow:auto;font-family:Manrope,system-ui,sans-serif;color:#0f2b4e;animation:emwpop .22s ease}' +
    '@keyframes emwpop{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:none}}' +
    '.emw-head{display:flex;justify-content:space-between;align-items:center;padding:20px 24px 0}' +
    '.emw-title{font-size:17px;font-weight:800}' +
    '.emw-x{background:none;border:none;font-size:24px;color:#8aa0bd;cursor:pointer;line-height:1}' +
    '.emw-body{padding:16px 24px 22px}' +
    '.emw-row{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px dashed #eef2f8;font-size:13.5px}' +
    '.emw-row b{font-weight:700;text-align:right}' +
    '.emw-lab{color:#7c8aa0;flex-shrink:0}' +
    '.emw-acct{margin-top:14px;background:#f4f8ff;border:1px solid #e3ecfb;border-radius:14px;padding:12px 14px;font-size:13px}' +
    '.emw-badge{display:inline-block;font-size:11px;font-weight:800;border-radius:999px;padding:3px 10px;text-transform:uppercase;letter-spacing:.4px}' +
    '.emw-badge.ok{background:#ecfdf5;color:#047857}.emw-badge.bad{background:#fef2f2;color:#b91c1c}' +
    '.emw-foot{display:flex;gap:10px;margin-top:16px}' +
    '.emw-field{margin-bottom:12px}' +
    '.emw-field label{display:block;font-size:11.5px;font-weight:700;color:#7c8aa0;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px}' +
    '.emw-inp,.emw-sel{width:100%;padding:11px 13px;border:1.5px solid #e3ecfb;border-radius:12px;font:600 14px Manrope,sans-serif;color:#0f2b4e;background:#fff;outline:none;font-family:inherit}' +
    '.emw-inp:focus,.emw-sel:focus{border-color:#93c5fd;box-shadow:0 0 0 3px rgba(37,99,235,.12)}' +
    '.emw-grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}' +
    '.emw-toast{position:fixed;bottom:140px;right:14px;z-index:9700;background:#0f2b4e;color:#fff;font:600 13px Manrope,sans-serif;padding:11px 16px;border-radius:12px;box-shadow:0 12px 30px -10px rgba(0,0,0,.4);animation:emwpop .2s ease;max-width:320px}' +
    '.emw-toast.err{background:#b91c1c}' +
    '@media(max-width:480px){.emw-pill{left:14px;justify-content:center}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function toast(msg, isErr) {
    var t = el('div', 'emw-toast' + (isErr ? ' err' : ''), esc(msg));
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3800);
  }

  // ---- Пилюля -------------------------------------------------------------------
  var pill = el('div', 'emw-pill');
  pill.innerHTML =
    '<div class="emw-ava">' + esc(me.avatar.initials) + '</div>' +
    '<span class="emw-name">' + esc(me.short) + '</span>' +
    '<button class="emw-btn" data-a="book">Записаться</button>' +
    '<button class="emw-btn sec" data-a="profile">Профиль</button>';
  document.body.appendChild(pill);
  pill.querySelector('[data-a=book]').addEventListener('click', openBooking);
  pill.querySelector('[data-a=profile]').addEventListener('click', openProfile);

  // ---- Модальные окна --------------------------------------------------------------
  function closeModal() {
    var b = document.querySelector('.emw-back');
    if (b) b.remove();
  }
  function modal(title, bodyHtml) {
    closeModal();
    var back = el('div', 'emw-back');
    back.innerHTML =
      '<div class="emw-modal"><div class="emw-head"><div class="emw-title">' + title + '</div>' +
      '<button class="emw-x">×</button></div><div class="emw-body">' + bodyHtml + '</div></div>';
    document.body.appendChild(back);
    back.addEventListener('click', function (e) { if (e.target === back) closeModal(); });
    back.querySelector('.emw-x').addEventListener('click', closeModal);
    return back;
  }

  function copyBtn(val){
    if(!val || val==='—') return '';
    return '<button class="copy-btn" data-copy="' + esc(val) + '">Копировать</button>';
  }
  function openProfile() {
    var statusBadge = D.account && D.account.status === 'blocked'
      ? '<span class="emw-badge bad">Заблокирован</span>'
      : '<span class="emw-badge ok">Активен</span>';
    var acct = D.account || {};
    var cnum = cardNumber();
    modal('Профиль',
      '<div class="emw-row"><span class="emw-lab">ФИО</span><b>' + esc(me.fio) + '</b></div>' +
      '<div class="emw-row"><span class="emw-lab">Дата рождения</span><b>' + esc(me.birth || '—') + '</b></div>' +
      '<div class="emw-row"><span class="emw-lab">Пол</span><b>' + esc(me.sex || '—') + '</b></div>' +
      '<div class="emw-row"><span class="emw-lab">Карта ЕМК</span><b class="copy-wrap" data-copy="' + esc(cnum) + '">' + esc(cnum) + copyBtn(cnum) + '</b></div>' +
      '<div class="emw-row"><span class="emw-lab">Полис ОМС</span><b class="copy-wrap" data-copy="' + esc(me.policy||'') + '">' + esc(me.policy || '—') + copyBtn(me.policy) + '</b></div>' +
      '<div class="emw-row"><span class="emw-lab">Телефон</span><b class="copy-wrap" data-copy="' + esc(me.phone||'') + '">' + esc(me.phone || '—') + copyBtn(me.phone) + '</b></div>' +
      '<div class="emw-row"><span class="emw-lab">Группа крови</span><b>' + esc(me.blood || '—') + '</b></div>' +
      '<div class="emw-acct"><div style="font-weight:800;margin-bottom:8px">Аккаунт</div>' +
      '<div class="emw-row" style="border:none;padding:5px 0"><span class="emw-lab">Discord</span><b>' + esc(acct.username || '—') + '</b></div>' +
      '<div class="emw-row" style="border:none;padding:5px 0"><span class="emw-lab">ID</span><b class="copy-wrap" data-copy="' + esc(acct.discordId||'') + '" style="font-size:12px">' + esc(acct.discordId || '—') + copyBtn(acct.discordId) + '</b></div>' +
      '<div class="emw-row" style="border:none;padding:5px 0"><span class="emw-lab">Персонажей</span><b>' + (D.members ? D.members.length : 1) + '</b></div>' +
      '<div class="emw-row" style="border:none;padding:5px 0"><span class="emw-lab">Статус</span>' + statusBadge + '</div></div>' +
      '<div class="emw-foot"><button class="emw-btn sec" data-a="switch" style="flex:1;padding:12px">Сменить персонажа</button></div>' +
      '<div class="emw-foot"><button class="emw-btn sec" data-a="linkdc" style="flex:1;padding:12px;background:#5865F2;color:#fff;border:none">Привязать Discord</button></div>'
    );
    var sw = document.querySelector('[data-a=switch]');
    if (sw) sw.addEventListener('click', function () {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/citizen/logout', false);
      x.send();
      window.location.href = '/login.html?tab=citizen';
    });
    var lk = document.querySelector('[data-a=linkdc]');
    if (lk) lk.addEventListener('click', function () {
      var x = new XMLHttpRequest();
      x.open('GET', '/api/citizen/link-code', false);
      x.send();
      var d = {};
      try { d = JSON.parse(x.responseText); } catch (e) {}
      if (x.status !== 200 || !d.code) { toast((d && d.error) || 'Не удалось получить код', true); return; }
      closeModal();
      modal('Привязка Discord',
        '<div style="text-align:center">' +
        '<p style="font-size:13px;color:#7c8aa0;margin:0 0 12px">Введите эту команду в чат с ботом на сервере:</p>' +
        '<div class="copy-wrap" data-copy="' + esc(d.code) + '" style="font:800 30px Manrope,sans-serif;letter-spacing:4px;background:#f4f8ff;border:2px dashed #93c5fd;border-radius:14px;padding:14px;color:#1d4ed8;justify-content:center">' + esc(d.code) + '<button class="copy-btn" data-copy="' + esc(d.code) + '">Копировать</button></div>' +
        '<p style="font-size:12.5px;color:#7c8aa0;margin-top:12px">В боте: <b>/привязать код:' + esc(d.code) + '</b> <button class="copy-btn" data-copy="/привязать код:' + esc(d.code) + '">Копировать</button><br>Код действует ' + (d.expiresInMin || 15) + ' мин.</p>' +
        '</div>');
    });
  }

  function cardNumber() {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', '/api/citizen/state', false);
      x.send();
      var d = JSON.parse(x.responseText);
      return (d.patient && d.patient.cardNumber) || '—';
    } catch (e) { return '—'; }
  }

  function openBooking() {
    var specKeys = Object.keys(D.doctors || {}).filter(function (k) { return (D.doctors[k] || []).length; });
    if (!specKeys.length) { toast('Нет доступных врачей', true); return; }
    var specOpts = specKeys.map(function (k) {
      return '<option value="' + k + '">' + esc(SPEC_LABELS[k] || k) + '</option>';
    }).join('');
    var docOpts = (D.doctors[specKeys[0]] || []).map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>';
    }).join('');
    var times = [];
    for (var h = 9; h <= 17; h++) { times.push((h < 10 ? '0' + h : h) + ':00'); times.push((h < 10 ? '0' + h : h) + ':30'); }
    var timeOpts = times.map(function (t) { return '<option' + (t === '10:00' ? ' selected' : '') + '>' + t + '</option>'; }).join('');
    var today = new Date().toISOString().slice(0, 10);
    var back = modal('Запись к врачу',
      '<div class="emw-grid2">' +
      '<div class="emw-field"><label>Специальность</label><select class="emw-sel" id="emw-spec">' + specOpts + '</select></div>' +
      '<div class="emw-field"><label>Врач</label><select class="emw-sel" id="emw-doc">' + docOpts + '</select></div>' +
      '<div class="emw-field"><label>Дата</label><input type="date" class="emw-inp" id="emw-date" min="' + today + '" value="' + today + '"></div>' +
      '<div class="emw-field"><label>Время</label><select class="emw-sel" id="emw-time">' + timeOpts + '</select></div>' +
      '</div>' +
      '<button class="emw-btn" id="emw-submit" style="width:100%;padding:13px;margin-top:6px">Записаться</button>'
    );
    var specSel = back.querySelector('#emw-spec'), docSel = back.querySelector('#emw-doc');
    specSel.addEventListener('change', function () {
      var list = D.doctors[specSel.value] || [];
      docSel.innerHTML = list.map(function (d) {
        return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>';
      }).join('');
    });
    back.querySelector('#emw-submit').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Отправка…';
      var x = new XMLHttpRequest();
      x.open('POST', '/api/citizen/appointments', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = function () {
        var d = {};
        try { d = JSON.parse(x.responseText); } catch (e) { }
        if (x.status === 201) {
          var appt = d.appointment || {};
          var dateStr = appt.date ? appt.date.split('-').reverse().join('.') : '';
          var timeStr = appt.time || '';
          var slot = (dateStr && timeStr) ? dateStr + ' ' + timeStr : '';
          toast('Талон ' + (appt.ticket_number || '') + (slot ? ' — ' + slot : ''));
          closeModal();
          setTimeout(function () { window.location.reload(); }, 700);
        } else {
          btn.disabled = false;
          btn.textContent = 'Записаться';
          toast(d.error || 'Не удалось записаться', true);
        }
      };
      x.onerror = function () { btn.disabled = false; btn.textContent = 'Записаться'; toast('Ошибка соединения', true); };
      x.send(JSON.stringify({
        date: back.querySelector('#emw-date').value,
        time: back.querySelector('#emw-time').value,
        doctorId: docSel.value
      }));
    });
  }

  /* ─── Живые уведомления через WebSocket ─────────────── */
  (function connectLive() {
    try {
      var myPid = parseInt(activeId.replace(/^\D+/, ''), 10);
      if (!myPid) return;
      var ws = new WebSocket((location.origin.replace(/^http/, 'ws')) + '/ws');
      ws.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        var a = m.data && m.data.appointment;
        if (!a || Number(a.patient_id) !== myPid) return;
        if (m.event === 'appointment.status.updated') {
          if (a.status === 'in_room') toast('Вас приглашают на приём' + (a.room ? ' — кабинет ' + a.room : '') + (a.doctor_name ? ', врач ' + a.doctor_name : ''), false);
          else if (a.status === 'done') toast('Приём завершён', false);
          else if (a.status === 'cancelled') toast('Ваш талон отменён администрацией', true);
          else if (a.status === 'no_show') toast('Отмечено: неявка на приём', true);
        }
      };
      ws.onclose = function () { setTimeout(connectLive, 5000); };
    } catch (e) { /* WS недоступен */ }
  })();
})();
