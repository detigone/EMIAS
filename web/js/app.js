/* ЕМИАС — Панель сотрудника (staff.html). Требует api.js и ws.js. */
(function () {
  'use strict';

  var user = null;
  var view = 'dashboard';
  var qDate = today();
  var qFilter = { status: '', doctorId: '', q: '' };

  function today() { return new Date().toISOString().slice(0, 10); }
  function shiftDate(iso, delta) {
    var d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }
  function $(s, p) { return (p || document).querySelector(s); }
  function $$(s, p) { return Array.prototype.slice.call((p || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(d) { if (!d) return '—'; var p = String(d).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function fmtDT(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : '—'; }
  function val(id) { var e = $('#' + id); return e ? e.value.trim() : ''; }
  var TIME_GRID = (function () {
    var out = [];
    for (var h = 9; h <= 17; h++) { out.push((h < 10 ? '0' : '') + h + ':00'); out.push((h < 10 ? '0' : '') + h + ':30'); }
    return out;
  })();

  function api(method, url, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.API.fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  function toast(msg, type) {
    var box = $('#toasts'); if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast ' + (type === 'ok' ? 'toast-ok' : type === 'err' ? 'toast-err' : 'toast-info');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  var TICKET_LABELS = { waiting: 'Ожидание', in_room: 'В кабинете', done: 'Принят', cancelled: 'Отменён', no_show: 'Не явился' };
  var RECORD_LABELS = { visit: 'Приём', lab: 'Анализ', procedure: 'Процедура' };
  var ROLES = { CHIEF: 'Главный врач', DOCTOR: 'Врач', REG: 'Регистратор' };
  function isChief() { return user.role === ROLES.CHIEF; }
  function isDoctor() { return user.role === ROLES.DOCTOR || isChief(); }

  /* ─── Shell ─────────────────────────────────────────── */
  var NAV = [
    { id: 'dashboard', label: 'Главная', cls: 'dot-dashboard' },
    { id: 'queue', label: 'Очередь', cls: 'dot-queue' },
    { id: 'schedule', label: 'Расписание', cls: 'dot-schedule', roles: [ROLES.DOCTOR, ROLES.CHIEF] },
    { id: 'patients', label: 'Пациенты', cls: 'dot-patients' },
    { id: 'analytics', label: 'Аналитика', cls: 'dot-analytics', roles: [ROLES.CHIEF] },
    { id: 'audit', label: 'Аудит', cls: 'dot-audit', roles: [ROLES.CHIEF] }
  ];

  function navHtml() {
    return NAV.filter(function (n) { return !n.roles || n.roles.indexOf(user.role) !== -1; })
      .map(function (n) {
        return '<a class="nav-item' + (n.id === view ? ' active' : '') + '" data-view="' + n.id + '">' +
          '<span class="dot ' + n.cls + '"></span>' + n.label + '</a>';
      }).join('');
  }

  var DOCTOR_STATUS_LABELS = { free: 'Свободен', in_appointment: 'На приёме', offline: 'Офлайн' };
  function isPhysician() { return user.role === ROLES.DOCTOR; }

  function renderShell() {
    var statusSel = '';
    if (isPhysician()) {
      statusSel =
        '<span class="st-dot st-' + esc(user.status || 'free') + '" id="st-dot"></span>' +
        '<select id="my-status" class="input" style="width:auto;padding:4px 8px;font-size:12.5px">' +
        Object.keys(DOCTOR_STATUS_LABELS).map(function (s) {
          return '<option value="' + s + '"' + ((user.status || 'free') === s ? ' selected' : '') + '>' + DOCTOR_STATUS_LABELS[s] + '</option>';
        }).join('') +
        '</select>';
    }
    document.body.innerHTML =
      '<header class="topbar grad-brand"><div class="topbar-inner">' +
        '<div class="topbar-brand"><img src="/img/emias-staff-logo.png" alt="ЕМИАС" style="height:28px;border-radius:6px;margin-right:8px"><span class="brand-name"></span>' +
        '<span class="brand-tag">Панель сотрудника</span></div>' +
        '<div class="topbar-user">' +
          '<span id="ws-dot" class="ws-offline" title="Соединение">●</span>' +
          statusSel +
          '<span class="user-name">' + esc(user.full_name) + '</span>' +
          '<span class="badge">' + esc(user.role) + '</span>' +
          '<button class="btn-ghost" id="btn-citizen">Режим гражданина</button>' +
          '<button class="btn-logout" id="btn-logout">Выйти</button>' +
        '</div></div></header>' +
      '<div class="layout"><aside class="sidebar">' + navHtml() + '</aside>' +
      '<main class="content" id="content"></main></div>' +
      '<nav class="bottom-nav"><div class="bottom-nav-inner">' + navHtml() + '</div></nav>' +
      '<div id="toasts"></div>' +
      '<footer class="site-footer">' +
        '<div class="footer-cols">' +
          '<div class="footer-col"><h4>Discord</h4>' +
            '<div><a href="https://discord.gg/Ruu9fmd7xs" target="_blank">discord.gg/Ruu9fmd7xs</a></div></div>' +
          '<div class="footer-col"><h4>Поддержка</h4>' +
            '<div><a href="https://discord.com/channels/1465040282037784667/1465040285938487371" target="_blank">Канал тикетов</a></div></div>' +
        '</div>' +
        '<div class="footer-credit">Разработка сайта: gagegaming99</div>' +
        '<div class="footer-disclaimer">Данный сайт не является официальным ресурсом. Проект создан исключительно для RP-проекта.</div>' +
      '</footer>';

    $$('.nav-item').forEach(function (a) {
      a.addEventListener('click', function () { switchView(a.dataset.view); });
    });
    $('#btn-logout').addEventListener('click', function () {
      api('POST', '/auth/logout').then(function () { location.href = '/login.html'; })
        .catch(function () { location.href = '/login.html'; });
    });
    $('#btn-citizen').addEventListener('click', function () { location.href = '/'; });
    var ms = $('#my-status');
    if (ms) ms.addEventListener('change', function () {
      api('POST', '/api/staff/' + user.id + '/status', { status: this.value })
        .then(function () { toast('Статус обновлён: ' + DOCTOR_STATUS_LABELS[ms.value], 'ok'); paintStatusDot(ms.value); })
        .catch(function (er) { toast(er.message, 'err'); });
    });

    connectWS();
    render();
  }

  function paintStatusDot(status) {
    user.status = status;
    var d = $('#st-dot');
    if (d) d.className = 'st-dot st-' + status;
  }

  function switchView(id) {
    view = id;
    $$('.nav-item').forEach(function (a) { a.classList.toggle('active', a.dataset.view === id); });
    render();
  }

  function render() {
    var c = $('#content');
    c.className = 'content';
    var views = { dashboard: vDashboard, queue: vQueue, schedule: vSchedule, patients: vPatients, analytics: vAnalytics, audit: vAudit };
    (views[view] || vDashboard)(c);
  }

  function stat(v, l) { return '<div class="stat-card"><div class="num">' + v + '</div><div class="label">' + l + '</div></div>'; }
  function fail(c, e) { c.innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; }

  /* ─── Dashboard ─────────────────────────────────────── */
  function vDashboard(c) {
    c.innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:16px"></div><div class="cards-grid"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:90px"></div></div>';
    var jobs = [api('GET', '/api/appointments?date=' + qDate)];
    if (isDoctor()) jobs.push(api('GET', '/api/appointments?date=' + qDate + '&doctorId=' + user.id));
    if (isChief()) jobs.push(api('GET', '/api/stats'));
    Promise.all(jobs).then(function (res) {
      var appts = res[0].appointments || [];
      var waiting = appts.filter(function (a) { return a.status === 'waiting'; }).length;
      var done = appts.filter(function (a) { return a.status === 'done'; }).length;
      var html =
        '<section class="hero-card grad-brand"><div class="hero-row"><div>' +
        '<div class="hero-meta">Смена · ' + fmtDate(qDate) + '</div>' +
        '<div class="hero-name">Здравствуйте, ' + esc(user.full_name.split(' ')[0]) + '</div>' +
        '<div class="hero-meta">' + esc(user.role) + '</div></div>' +
        '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-light btn-sm" data-go="queue">Очередь</button>' +
        (isChief() ? '<button class="btn btn-light btn-sm" data-go="analytics">Аналитика</button>' : '') +
        '</div></div></section>' +
        '<div class="cards-grid">' + stat(waiting, 'Ожидают приёма') + stat(done, 'Принято сегодня') + stat(appts.length, 'Талонов за день') + '</div>';

      if (isDoctor() && res[1]) {
        var mine = res[1].appointments || [];
        html += '<section class="panel"><h3>Мой день (' + mine.length + ')</h3>' +
          (mine.length ? '<div class="table-wrap"><table class="data"><tbody>' +
            mine.map(function (a) {
              return '<tr><td style="width:70px"><b>' + esc(a.time) + '</b></td><td>' + esc(a.patient_name) + '</td><td>' + esc(a.patient_card) + '</td><td><span class="badge badge-' + a.status + '">' + TICKET_LABELS[a.status] + '</span></td></tr>';
            }).join('') + '</tbody></table></div>'
            : '<div class="empty-note">Приёмов не назначено</div>') + '</section>';
      }

      var si = isChief() && isDoctor() ? 2 : isChief() ? 1 : -1;
      if (si >= 0 && res[si]) {
        var s = res[si].stats;
        html += '<div class="cards-grid">' + stat(s.patientsTotal, 'Пациентов в базе') + stat(s.staffTotal, 'Сотрудников') + '</div>';
        if (s.topDiagnoses && s.topDiagnoses.length) {
          html += '<section class="panel"><h3>Топ диагнозов (МКБ-10)</h3><div class="table-wrap"><table class="data"><thead><tr><th>Код</th><th>Название</th><th>Кол-во</th></tr></thead><tbody>' +
            s.topDiagnoses.map(function (d) { return '<tr><td><b>' + esc(d.code) + '</b></td><td>' + esc(d.name) + '</td><td>' + d.cnt + '</td></tr>'; }).join('') +
            '</tbody></table></div></section>';
        }
      }
      c.innerHTML = html;
      $$('[data-go]', c).forEach(function (b) {
        b.addEventListener('click', function () { switchView(b.dataset.go); });
      });
    }).catch(function (e) { fail(c, e); });
  }

  /* ─── Queue ─────────────────────────────────────────── */
  function ticketActions(a) {
    var b = [];
    if (a.status === 'waiting') { b.push(actBtn(a.id, 'in_room', 'В кабинет')); b.push(actBtn(a.id, 'no_show', 'Не явился')); }
    if (a.status === 'in_room') { b.push(actBtn(a.id, 'done', 'Завершить')); }
    if (a.status === 'waiting' || a.status === 'in_room') { b.push(actBtn(a.id, 'cancelled', 'Отменить')); }
    return b.join(' ');
  }
  function actBtn(id, st, label) {
    return '<button class="btn btn-secondary btn-sm" data-act="' + st + '" data-id="' + id + '">' + label + '</button>';
  }
  function bindTicketActions(scope) {
    $$('[data-act]', scope).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        api('POST', '/api/appointments/' + btn.dataset.id + '/status', { status: btn.dataset.act })
          .then(function () { toast('Статус обновлён', 'ok'); render(); })
          .catch(function (er) { toast(er.message, 'err'); });
      });
    });
  }

  function statusChip(st, label, cnt) {
    return '<button class="chip' + (qFilter.status === st ? ' chip-on' : '') + '" data-st="' + st + '">' + label +
      ' <b>' + cnt + '</b></button>';
  }

  function vQueue(c) {
    c.innerHTML =
      '<div class="view-head"><h2>Электронная очередь</h2>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<button class="btn btn-secondary btn-sm" id="q-prev">←</button>' +
      '<input type="date" id="q-date" class="input" style="width:auto" value="' + qDate + '">' +
      '<button class="btn btn-secondary btn-sm" id="q-next">→</button>' +
      '<button class="btn btn-secondary btn-sm" id="q-today"' + (qDate === today() ? ' disabled' : '') + '>Сегодня</button>' +
      (isPhysician() ? '<button class="btn btn-primary btn-sm" id="q-call">Вызвать следующего</button>' : '') +
      '<button class="btn btn-primary btn-sm" id="q-new">+ Выдать талон</button></div></div>' +
      '<div class="filter-bar" id="q-filters"></div>' +
      '<div id="q-body"><div class="skeleton" style="height:200px"></div></div>';
    $('#q-prev').addEventListener('click', function () { qDate = shiftDate(qDate, -1); render(); });
    $('#q-next').addEventListener('click', function () { qDate = shiftDate(qDate, 1); render(); });
    $('#q-today').addEventListener('click', function () { qDate = today(); render(); });
    $('#q-date').addEventListener('change', function () { qDate = this.value; render(); });
    $('#q-new').addEventListener('click', openTicketModal);
    var qc = $('#q-call');
    if (qc) qc.addEventListener('click', callNext);
    loadQueue();
  }

  function callNext() {
    api('POST', '/api/appointments/call-next', { date: qDate }).then(function (d) {
      var a = d.appointment;
      toast('Вызван ' + a.ticket_number + ' — ' + a.patient_name + (a.room ? ', каб. ' + a.room : ''), 'ok');
      render();
    }).catch(function (er) { toast(er.message, 'err'); });
  }

  function loadQueue() {
    var b = $('#q-body'), fb = $('#q-filters');
    if (!b) return;
    api('GET', '/api/appointments?date=' + qDate).then(function (d) {
      var rows = d.appointments || [];
      var cnt = {};
      ['waiting', 'in_room', 'done', 'no_show', 'cancelled'].forEach(function (s) { cnt[s] = 0; });
      rows.forEach(function (a) { if (cnt[a.status] != null) cnt[a.status]++; });

      if (fb) {
        fb.innerHTML =
          statusChip('', 'Все', rows.length) +
          statusChip('waiting', 'Ожидают', cnt.waiting) +
          statusChip('in_room', 'В кабинете', cnt.in_room) +
          statusChip('done', 'Приняты', cnt.done) +
          statusChip('no_show', 'Не явились', cnt.no_show);
        $$('[data-st]', fb).forEach(function (ch) {
          ch.addEventListener('click', function () { qFilter.status = ch.dataset.st; loadQueue(); });
        });
        var docs = {};
        rows.forEach(function (a) { if (a.doctor_id) docs[a.doctor_id] = a.doctor_name; });
        if (Object.keys(docs).length > 1) {
          var sel = document.createElement('select');
          sel.className = 'input'; sel.style.width = 'auto';
          sel.innerHTML = '<option value="">Все врачи</option>' + Object.keys(docs).map(function (id) {
            return '<option value="' + id + '"' + (String(qFilter.doctorId) === id ? ' selected' : '') + '>' + esc(docs[id]) + '</option>';
          }).join('');
          sel.addEventListener('change', function () { qFilter.doctorId = this.value; loadQueue(); });
          fb.appendChild(sel);
        }
      }

      var list = rows.filter(function (a) {
        if (qFilter.status && a.status !== qFilter.status) return false;
        if (qFilter.doctorId && String(a.doctor_id || '') !== String(qFilter.doctorId)) return false;
        if (qFilter.q) {
          var qq = qFilter.q.toLowerCase();
          if ((a.patient_name || '').toLowerCase().indexOf(qq) === -1 &&
              (a.patient_card || '').toLowerCase().indexOf(qq) === -1 &&
              (a.ticket_number || '').toLowerCase().indexOf(qq) === -1) return false;
        }
        return true;
      });

      if (!rows.length) { b.innerHTML = '<div class="panel empty-note">На эту дату талонов нет</div>'; return; }

      b.innerHTML =
        '<div style="margin-bottom:10px"><input id="q-search" class="input" style="width:280px" placeholder="Поиск: ФИО, карта, № талона" value="' + esc(qFilter.q) + '"></div>' +
        '<section class="panel"><div class="table-wrap"><table class="data"><thead><tr><th>Талон</th><th>Время</th><th>Пациент</th><th>Карта</th><th>Врач</th><th>Каб.</th><th>Статус</th><th>Действия</th></tr></thead><tbody>' +
        list.map(function (a) {
          var tCopy = a.ticket_number ? '<button class="copy-btn" data-copy="' + esc(a.ticket_number) + '">Копировать</button>' : '';
          var cCopy = a.patient_card && a.patient_card !== '—' ? '<button class="copy-btn" data-copy="' + esc(a.patient_card) + '">Копировать</button>' : '';
          return '<tr><td><span class="copy-wrap" data-copy="' + esc(a.ticket_number) + '"><b>' + esc(a.ticket_number) + '</b>' + tCopy + '</span></td><td>' + esc(a.time) + '</td><td>' + esc(a.patient_name) + '</td><td><span class="copy-wrap" data-copy="' + esc(a.patient_card) + '">' + esc(a.patient_card) + cCopy + '</span></td><td>' + esc(a.doctor_name || '—') + '</td><td>' + esc(a.room || '—') + '</td><td><span class="badge badge-' + a.status + '">' + TICKET_LABELS[a.status] + '</span></td><td style="white-space:nowrap">' + ticketActions(a) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        (list.length ? '' : '<div class="empty-note">Под фильтр ничего не попало</div>') + '</section>';

      var sr = $('#q-search');
      if (sr) {
        var t = null;
        sr.addEventListener('input', function () {
          var vv = this.value;
          clearTimeout(t);
          t = setTimeout(function () {
            qFilter.q = vv.trim();
            loadQueue();
            var s2 = $('#q-search');
            if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
          }, 250);
        });
      }
      bindTicketActions(b);
    }).catch(function (e) { b.innerHTML = ''; fail(b.parentElement, e); });
  }

  function openTicketModal() {
    Promise.all([api('GET', '/api/patients?limit=200'), api('GET', '/api/staff')]).then(function (res) {
      var patients = res[0].patients || [];
      var staff = res[1].staff || [];
      var pOpts = patients.map(function (p) {
        return '<option value="' + p.id + '"' + (p.status === 'blocked' ? ' disabled' : '') + '>' +
          esc(p.full_name) + ' (' + esc(p.card_number) + ')' + (p.status === 'blocked' ? ' ⛔' : '') + '</option>';
      }).join('');
      var dOpts = staff.map(function (s) { return '<option value="' + s.id + '">' + esc(s.full_name) + (s.specialty ? ' — ' + esc(s.specialty) : '') + '</option>'; }).join('');
      openModal('Новый талон',
        '<div class="form-grid">' +
        '<div class="field full"><label>Пациент</label><select id="f-pat">' + pOpts + '</select></div>' +
        '<div class="field"><label>Врач</label><select id="f-doc"><option value="">— без врача —</option>' + dOpts + '</select></div>' +
        '<div class="field"><label>Дата</label><input type="date" id="f-date" value="' + qDate + '"></div>' +
        '<div class="field"><label>Время</label><select id="f-time"></select></div>' +
        '<div class="field"><label>Кабинет</label><input id="f-room" placeholder="204"></div>' +
        '<div class="field full" id="f-busy" style="font-size:12.5px;color:#7c8aa0"></div>' +
        '</div>',
        function () {
          var body = { patientId: Number(val('f-pat')), date: val('f-date'), time: val('f-time'), room: val('f-room') };
          var dv = val('f-doc'); if (dv) body.doctorId = Number(dv);
          return api('POST', '/api/appointments', body).then(function () {
            toast('Талон выдан', 'ok'); render();
          });
        });
      refreshTimeSelect();
      $('#f-doc').addEventListener('change', refreshTimeSelect);
      $('#f-date').addEventListener('change', refreshTimeSelect);

      function refreshTimeSelect() {
        var docId = val('f-doc'), date = val('f-date');
        var sel = $('#f-time');
        sel.innerHTML = TIME_GRID.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
        $('#f-busy').textContent = '';
        if (!docId || !date) return;
        api('GET', '/api/appointments?date=' + date + '&doctorId=' + docId).then(function (dd) {
          var busy = {};
          (dd.appointments || []).forEach(function (a) {
            if (a.status !== 'cancelled') busy[a.time] = a.ticket_number || '';
          });
          var freeCnt = 0;
          sel.innerHTML = TIME_GRID.map(function (t) {
            var isBusy = !!busy[t];
            if (!isBusy) freeCnt++;
            return '<option value="' + t + '"' + (isBusy ? ' disabled' : '') + '>' + t + (isBusy ? ' — занято (' + busy[t] + ')' : '') + '</option>';
          }).join('');
          $('#f-busy').textContent = 'Свободных слотов у врача на ' + fmtDate(date) + ': ' + freeCnt + ' из ' + TIME_GRID.length;
        }).catch(function () {});
      }
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ─── Schedule ──────────────────────────────────────── */
  function vSchedule(c) {
    c.innerHTML =
      '<div class="view-head"><h2>Моё расписание</h2>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<button class="btn btn-secondary btn-sm" id="s-prev">←</button>' +
      '<input type="date" id="s-date" class="input" style="width:auto" value="' + qDate + '">' +
      '<button class="btn btn-secondary btn-sm" id="s-next">→</button>' +
      '<button class="btn btn-secondary btn-sm" id="s-today"' + (qDate === today() ? ' disabled' : '') + '>Сегодня</button>' +
      (isPhysician() ? '<button class="btn btn-primary btn-sm" id="s-call">Вызвать следующего</button>' : '') +
      '</div></div>' +
      '<div id="s-body"><div class="skeleton" style="height:160px"></div></div>';
    $('#s-prev').addEventListener('click', function () { qDate = shiftDate(qDate, -1); render(); });
    $('#s-next').addEventListener('click', function () { qDate = shiftDate(qDate, 1); render(); });
    $('#s-today').addEventListener('click', function () { qDate = today(); render(); });
    $('#s-date').addEventListener('change', function () { qDate = this.value; render(); });
    var sc = $('#s-call');
    if (sc) sc.addEventListener('click', callNext);
    loadSchedule();
  }
  function loadSchedule() {
    var b = $('#s-body'); if (!b) return;
    api('GET', '/api/appointments?date=' + qDate + '&doctorId=' + user.id).then(function (d) {
      var rows = d.appointments || [];
      var active = rows.filter(function (a) { return a.status === 'waiting' || a.status === 'in_room'; }).length;
      var head = '<div class="cards-grid" style="margin-bottom:14px">' +
        stat(rows.length, 'Талонов') + stat(active, 'Активных') +
        stat(rows.filter(function (a) { return a.status === 'done'; }).length, 'Принято') + '</div>';
      if (!rows.length) { b.innerHTML = head + '<div class="panel empty-note">Приёмов нет — день свободен</div>'; return; }
      b.innerHTML = head + '<section class="panel"><div class="table-wrap"><table class="data"><thead><tr><th>Время</th><th>Пациент</th><th>Карта</th><th>Каб.</th><th>Статус</th><th>Действия</th></tr></thead><tbody>' +
        rows.map(function (a) {
          return '<tr><td><b>' + esc(a.time) + '</b></td><td>' + esc(a.patient_name) + '</td><td>' + esc(a.patient_card) + '</td><td>' + esc(a.room || '—') + '</td><td><span class="badge badge-' + a.status + '">' + TICKET_LABELS[a.status] + '</span></td><td style="white-space:nowrap">' + ticketActions(a) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
      bindTicketActions(b);
    }).catch(function (e) { b.innerHTML = ''; fail(b.parentElement, e); });
  }

  /* ─── Patients ──────────────────────────────────────── */
  function vPatients(c) {
    c.innerHTML =
      '<div class="view-head"><h2>Пациенты</h2>' +
      '<div style="display:flex;gap:8px">' +
      '<input id="p-q" class="input" style="width:260px" placeholder="ФИО, карта или ОМС">' +
      '<button class="btn btn-primary btn-sm" id="p-new">+ Пациент</button></div></div>' +
      '<div id="p-body"><div class="skeleton" style="height:200px"></div></div>';
    var t = null;
    $('#p-q').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(t);
      t = setTimeout(function () { loadPatients(v); }, 300);
    });
    $('#p-new').addEventListener('click', function () { openPatientModal(null); });
    loadPatients('');
  }
  function loadPatients(q) {
    var b = $('#p-body'); if (!b) return;
    api('GET', '/api/patients?query=' + encodeURIComponent(q)).then(function (d) {
      var rows = d.patients || [];
      if (!rows.length) { b.innerHTML = '<div class="panel empty-note">Ничего не найдено</div>'; return; }
      b.innerHTML = '<section class="panel"><div class="table-wrap"><table class="data"><thead><tr><th>ФИО</th><th>Карта</th><th>Дата рожд.</th><th>Пол</th><th>ОМС</th><th>Телефон</th><th>Статус</th><th></th></tr></thead><tbody>' +
        rows.map(function (p) {
          var badges = '';
          if (p.discord_id) badges += '<span class="mini-badge dc" title="Привязан к Discord">DS</span> ';
          if (p.status === 'blocked') badges += '<span class="badge badge-cancelled">Блок</span>';
          var cardC = p.card_number ? '<button class="copy-btn" data-copy="' + esc(p.card_number) + '">Копировать</button>' : '';
          var omsC = p.oms_number && p.oms_number !== '—' ? '<button class="copy-btn" data-copy="' + esc(p.oms_number) + '">Копировать</button>' : '';
          var phoneC = p.phone && p.phone !== '—' ? '<button class="copy-btn" data-copy="' + esc(p.phone) + '">Копировать</button>' : '';
          return '<tr class="row-clickable" data-open="' + p.id + '"><td><b>' + esc(p.full_name) + '</b></td><td><span class="copy-wrap" data-copy="' + esc(p.card_number) + '">' + esc(p.card_number) + cardC + '</span></td><td>' + fmtDate(p.birth_date) + '</td><td>' + esc(p.sex || '—') + '</td><td><span class="copy-wrap" data-copy="' + esc(p.oms_number || '') + '">' + esc(p.oms_number || '—') + omsC + '</span></td><td><span class="copy-wrap" data-copy="' + esc(p.phone || '') + '">' + esc(p.phone || '—') + phoneC + '</span></td><td>' + (badges || '<span style="color:#94a3b8;font-size:12px">активен</span>') + '</td><td><button class="btn btn-secondary btn-sm">Открыть</button></td></tr>';
        }).join('') + '</tbody></table></div></section>';
      $$('[data-open]', b).forEach(function (tr) {
        tr.addEventListener('click', function () { openPatient(Number(tr.dataset.open)); });
      });
    }).catch(function (e) { b.innerHTML = ''; fail(b.parentElement, e); });
  }

  function patientFormFields(p) {
    p = p || {};
    return '<div class="form-grid">' +
      '<div class="field full"><label>ФИО *</label><input id="n-fio" placeholder="Иванов Иван Иванович" value="' + esc(p.full_name || '') + '"></div>' +
      '<div class="field"><label>Дата рождения</label><input type="date" id="n-birth" value="' + esc(p.birth_date || '') + '"></div>' +
      '<div class="field"><label>Пол</label><select id="n-sex"><option value="">—</option><option' + (p.sex === 'М' ? ' selected' : '') + '>М</option><option' + (p.sex === 'Ж' ? ' selected' : '') + '>Ж</option></select></div>' +
      '<div class="field"><label>Полис ОМС</label><input id="n-oms" placeholder="16 цифр" value="' + esc(p.oms_number || '') + '"></div>' +
      '<div class="field"><label>Группа крови</label><input id="n-blood" placeholder="II (A)" value="' + esc(p.blood_group || '') + '"></div>' +
      '<div class="field"><label>Телефон</label><input id="n-phone" value="' + esc(p.phone || '') + '"></div>' +
      '<div class="field full"><label>Аллергии</label><textarea id="n-all" rows="2">' + esc(p.allergies || '') + '</textarea></div>' +
      '</div>';
  }

  function openPatientModal(existing) {
    openModal(existing ? 'Редактирование — ' + existing.full_name : 'Новый пациент',
      patientFormFields(existing),
      function () {
        var fio = val('n-fio');
        if (!fio) return Promise.reject(new Error('Укажите ФИО пациента'));
        var body = {
          fullName: fio,
          birthDate: val('n-birth') || null,
          sex: val('n-sex') || null,
          omsNumber: val('n-oms') || null,
          bloodGroup: val('n-blood') || null,
          phone: val('n-phone') || null,
          allergies: val('n-all') || null
        };
        var req = existing
          ? api('PATCH', '/api/patients/' + existing.id, body)
          : api('POST', '/api/patients', body);
        return req.then(function () {
          toast(existing ? 'Изменения сохранены' : 'Пациент зарегистрирован', 'ok');
          if (view === 'patients') loadPatients(val('p-q'));
          if (existing) openPatient(existing.id);
        });
      });
  }

  function openPatient(id) {
    api('GET', '/api/patients/' + id).then(function (d) {
      var p = d.patient;
      var info =
        '<section class="panel"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
        '<h3 style="margin:0"><span class="copy-wrap" data-copy="' + esc(p.card_number) + '">' + esc(p.full_name) + ' · ' + esc(p.card_number) + '<button class="copy-btn" data-copy="' + esc(p.card_number) + '">Копировать</button></span>' +
        (p.status === 'blocked' ? ' <span class="badge badge-cancelled">Заблокирован</span>' : '') +
        (p.discord_id ? ' <span class="mini-badge dc" title="Привязан к Discord">DS</span>' : '') + '</h3>' +
        '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-secondary btn-sm" id="edit-pat">Изменить</button>' +
        (isChief() ? '<button class="btn btn-sm ' + (p.status === 'blocked' ? 'btn-primary' : 'btn-danger') + '" id="block-pat">' + (p.status === 'blocked' ? 'Разблокировать' : 'Заблокировать') + '</button>' : '') +
        '</div></div>' +
        docRow('Дата рождения', fmtDate(p.birth_date)) +
        docRow('Пол', p.sex) + docRow('Полис ОМС', p.oms_number) +
        docRow('Группа крови', p.blood_group) + docRow('Аллергии', p.allergies) +
        docRow('Телефон', p.phone) +
        (p.discord_id ? docRow('Discord', '#' + p.discord_id) : '') + '</section>';

      var ticketsHtml = '<section class="panel"><h3>Талоны на неделю</h3><div id="pt-tickets" class="empty-note">Загрузка…</div></section>';

      var med;
      if (d.medicalRestricted) {
        med = '<div class="alert alert-warning">Медицинские данные скрыты: вы не лечащий врач этого пациента.</div>';
      } else {
        var recs = (d.records || []).map(function (r) {
          return '<tr><td>' + fmtDT(r.visit_date) + '</td><td>' + RECORD_LABELS[r.record_type] + '</td><td>' + (r.diagnosis_code ? '<b>' + esc(r.diagnosis_code) + '</b> ' : '') + esc(r.diagnosis_text || '') + '</td><td>' + esc(r.complaints || '—') + '</td><td>' + (r.sick_leave_days ? '<span class="mini-badge sl" title="Лист нетрудоспособности">' + r.sick_leave_days + ' дн.</span>' : '—') + '</td><td>' + esc(r.doctor_name || '—') + '</td></tr>';
        }).join('');
        var prs = (d.prescriptions || []).map(function (x) {
          return '<tr><td>' + esc(x.prescription_number) + '</td><td>' + esc(x.medication) + '</td><td>' + esc(x.dosage) + '</td><td>' + fmtDT(x.issued_at) + '</td><td>' + esc(x.doctor_name || '—') + '</td></tr>';
        }).join('');
        med =
          '<section class="panel"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Записи ЭМК</h3>' +
          (isDoctor() ? '<button class="btn btn-primary btn-sm" id="add-rec">+ Запись</button>' : '') + '</div>' +
          (recs ? '<div class="table-wrap"><table class="data"><thead><tr><th>Дата</th><th>Тип</th><th>Диагноз</th><th>Жалобы</th><th>Больничный</th><th>Врач</th></tr></thead><tbody>' + recs + '</tbody></table></div>' : '<div class="empty-note">Записей нет</div>') +
          '</section>' +
          '<section class="panel"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Рецепты</h3>' +
          (isDoctor() ? '<button class="btn btn-primary btn-sm" id="add-prs">+ Рецепт</button>' : '') + '</div>' +
          (prs ? '<div class="table-wrap"><table class="data"><thead><tr><th>Номер</th><th>Препарат</th><th>Дозировка</th><th>Выдан</th><th>Врач</th></tr></thead><tbody>' + prs + '</tbody></table></div>' : '<div class="empty-note">Рецептов нет</div>') +
          '</section>';
      }
      openModalWide('Карта пациента', info + ticketsHtml + med, null);

      var ep = $('#edit-pat'); if (ep) ep.addEventListener('click', function () { openPatientModal(p); });
      var bp = $('#block-pat');
      if (bp) bp.addEventListener('click', function () {
        var blocked = p.status !== 'blocked';
        api('POST', '/api/patients/' + p.id + '/block', { blocked: blocked }).then(function () {
          toast(blocked ? 'Пациент заблокирован' : 'Пациент разблокирован', 'ok');
          closeModal(); openPatient(p.id);
        }).catch(function (er) { toast(er.message, 'err'); });
      });

      var weekAgo = shiftDate(today(), -7);
      api('GET', '/api/appointments?patientId=' + p.id + '&from=' + weekAgo).then(function (td) {
        var tl = $('#pt-tickets'); if (!tl) return;
        var list = (td.appointments || []).filter(function (a) { return a.status !== 'cancelled'; });
        tl.className = '';
        tl.innerHTML = list.length
          ? '<div class="table-wrap"><table class="data"><tbody>' + list.map(function (a) {
              return '<tr><td style="width:130px">' + fmtDate(a.date) + ' ' + esc(a.time) + '</td><td>' + esc(a.doctor_name || '—') + '</td><td>' + esc(a.room || '—') + '</td><td><span class="badge badge-' + a.status + '">' + TICKET_LABELS[a.status] + '</span></td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<div class="empty-note">Талонов нет</div>';
      }).catch(function () {
        var tl = $('#pt-tickets'); if (tl) { tl.className = 'empty-note'; tl.textContent = 'Талонов нет'; }
      });

      var ar = $('#add-rec'); if (ar) ar.addEventListener('click', function () { openRecordModal(p); });
      var ap = $('#add-prs'); if (ap) ap.addEventListener('click', function () { openPrescModal(p); });
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function docRow(label, value) {
    var v = value || '—';
    var escV = esc(v);
    var copy = (v && v !== '—') ? '<button class="copy-btn" data-copy="' + esc(v) + '">Копировать</button>' : '';
    return '<div class="doc-row"><span class="doc-label">' + label + '</span><span class="doc-value copy-wrap" data-copy="' + esc(v) + '">' + escV + copy + '</span></div>';
  }

  function openRecordModal(p) {
    openModal('Запись в ЭМК — ' + p.full_name,
      '<div class="form-grid">' +
      '<div class="field"><label>Тип</label><select id="r-type"><option value="visit">Приём</option><option value="lab">Анализ</option><option value="procedure">Процедура</option></select></div>' +
      '<div class="field"><label>Больничный (дней)</label><input id="r-sick" type="number" min="0"></div>' +
      '<div class="field full"><label>Жалобы</label><textarea id="r-compl" rows="2"></textarea></div>' +
      '<div class="field" style="position:relative"><label>Диагноз МКБ-10</label><input id="r-code" autocomplete="off" placeholder="J06.9"><div id="r-mkb" class="mkb-list"></div></div>' +
      '<div class="field"><label>Описание диагноза</label><input id="r-dtxt"></div>' +
      '<div class="field full"><label>Примечания</label><textarea id="r-notes" rows="2"></textarea></div>' +
      '</div>',
      function () {
        return api('POST', '/api/patients/' + p.id + '/records', {
          recordType: val('r-type'),
          complaints: val('r-compl'),
          diagnosisCode: val('r-code'),
          diagnosisText: val('r-dtxt'),
          notes: val('r-notes'),
          sickLeaveDays: val('r-sick') || null
        }).then(function () { toast('Запись добавлена', 'ok'); closeModal(); openPatient(p.id); });
      });
    var inp = $('#r-code'), list = $('#r-mkb'), t = null;
    inp.addEventListener('input', function () {
      var q = this.value.trim();
      clearTimeout(t);
      t = setTimeout(function () {
        if (!q) { list.innerHTML = ''; return; }
        api('GET', '/api/mkb10?q=' + encodeURIComponent(q)).then(function (d) {
          list.innerHTML = (d.entries || []).map(function (e) {
            return '<div class="mkb-item" data-c="' + esc(e.code) + '" data-n="' + esc(e.name) + '"><b>' + esc(e.code) + '</b> ' + esc(e.name) + '</div>';
          }).join('');
          $$('.mkb-item', list).forEach(function (it) {
            it.addEventListener('click', function () {
              inp.value = it.dataset.c;
              var dt = $('#r-dtxt'); if (dt) dt.value = it.dataset.n;
              list.innerHTML = '';
            });
          });
        }).catch(function () { });
      }, 250);
    });
  }

  function openPrescModal(p) {
    openModal('Рецепт — ' + p.full_name,
      '<div class="form-grid">' +
      '<div class="field full"><label>Препарат *</label><input id="pr-med" placeholder="Парацетамол 500 мг"></div>' +
      '<div class="field"><label>Дозировка *</label><input id="pr-dos" placeholder="по 1 таб. 3 раза в день"></div>' +
      '<div class="field"><label>Длительность (дней)</label><input id="pr-dur" type="number" min="1"></div>' +
      '</div>',
      function () {
        return api('POST', '/api/patients/' + p.id + '/prescriptions', {
          medication: val('pr-med'),
          dosage: val('pr-dos'),
          durationDays: val('pr-dur') || null
        }).then(function () { toast('Рецепт выдан', 'ok'); closeModal(); openPatient(p.id); });
      });
  }

  /* ─── Analytics / Audit ─────────────────────────────── */
  function barRow(label, cnt, maxPct, colorCls) {
    return '<div class="bar-row"><span class="bar-label">' + esc(label) + '</span>' +
      '<div class="bar-track"><div class="bar-fill ' + (colorCls || '') + '" style="width:' + Math.max(3, Math.round(maxPct)) + '%"></div></div>' +
      '<span class="bar-num">' + cnt + '</span></div>';
  }

  function vAnalytics(c) {
    c.innerHTML = '<div class="skeleton" style="height:220px"></div>';
    api('GET', '/api/stats').then(function (d) {
      var s = d.stats;
      var maxDay = Math.max.apply(null, [1].concat((s.visitsByDay || []).map(function (x) { return x.cnt; })));
      var daysHtml = (s.visitsByDay || []).map(function (x) {
        var pct = Math.round(x.cnt / maxDay * 100);
        var lbl = x.date.slice(8, 10) + '.' + x.date.slice(5, 7);
        return '<div class="vbar-wrap"><div class="vbar" title="' + fmtDate(x.date) + ': ' + x.cnt + '" style="height:' + Math.max(4, pct) + '%"></div><span class="vbar-lbl">' + lbl + '</span></div>';
      }).join('');

      var specMax = Math.max.apply(null, [1].concat((s.loadBySpecialty || []).map(function (x) { return x.cnt; })));
      var specHtml = (s.loadBySpecialty || []).length
        ? (s.loadBySpecialty || []).map(function (x) { return barRow(x.specialty, x.cnt, x.cnt / specMax * 100, 'bf-blue'); }).join('')
        : '<div class="empty-note">Сегодня талонов с врачами нет</div>';

      var diagMax = Math.max.apply(null, [1].concat((s.topDiagnoses || []).map(function (x) { return x.cnt; })));
      var diagHtml = (s.topDiagnoses && s.topDiagnoses.length)
        ? s.topDiagnoses.map(function (x) { return barRow(x.code + ' · ' + x.name, x.cnt, x.cnt / diagMax * 100, 'bf-green'); }).join('')
        : '<div class="empty-note">Данных пока нет</div>';

      c.innerHTML =
        '<div class="cards-grid">' +
        stat(s.patientsTotal, 'Пациентов всего') +
        stat(s.patientsBlocked || 0, 'Заблокировано') +
        stat(s.staffTotal, 'Сотрудников') +
        stat(s.ticketsToday, 'Талонов сегодня') + stat(s.waitingToday, 'Ожидают') +
        stat(s.doneToday, 'Принято') + stat(s.recordsMonth, 'Записей ЭМК за месяц') + '</div>' +
        '<section class="panel"><h3>Талоны за 7 дней</h3><div class="vchart">' + daysHtml + '</div></section>' +
        '<section class="panel"><h3>Загрузка по специальностям (сегодня)</h3>' + specHtml + '</section>' +
        '<section class="panel"><h3>Топ-5 диагнозов (МКБ-10)</h3>' + diagHtml + '</section>';
    }).catch(function (e) { fail(c, e); });
  }

  var AUDIT_LABELS = {
    'patient.create': 'Регистрация пациента', 'patient.update': 'Изменение пациента',
    'patient.block': 'Блокировка пациента', 'patient.unblock': 'Разблокировка пациента',
    'appointment.create': 'Выдача талона', 'appointment.status': 'Статус талона',
    'emr.record.create': 'Запись в ЭМК', 'emr.prescription.create': 'Выписка рецепта',
    'staff.status': 'Смена статуса врача', 'auth.login': 'Вход', 'auth.logout': 'Выход'
  };

  function vAudit(c) {
    c.innerHTML =
      '<div class="view-head"><h2>Журнал аудита</h2>' +
      '<input id="a-q" class="input" style="width:260px" placeholder="Фильтр: действие, сотрудник…"></div>' +
      '<div id="a-body"><div class="skeleton" style="height:240px"></div></div>';
    var t = null;
    $('#a-q').addEventListener('input', function () {
      var v = this.value.trim().toLowerCase();
      clearTimeout(t);
      t = setTimeout(function () { renderAuditRows(v); }, 200);
    });
    loadAudit('');
    function renderAuditRows(q) {
      var b = $('#a-body'); if (!b || !loadAudit._rows) return;
      paintAudit(b, q ? loadAudit._rows.filter(function (e) {
        return ((e.action || '') + ' ' + (e.actor_name || '')).toLowerCase().indexOf(q) !== -1;
      }) : loadAudit._rows);
    }
    function loadAudit() {
      var b = $('#a-body');
      api('GET', '/api/audit?limit=150').then(function (d) {
        loadAudit._rows = d.entries || [];
        paintAudit(b, loadAudit._rows);
      }).catch(function (e) { fail($('#content'), e); });
    }
  }

  function paintAudit(box, rows) {
    box.innerHTML = '<section class="panel">' +
      (rows.length
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Время</th><th>Сотрудник</th><th>Действие</th><th>Объект</th><th>IP</th></tr></thead><tbody>' +
          rows.map(function (e) {
            var det = '';
            try { det = e.details ? Object.values(JSON.parse(e.details)).join(', ') : ''; } catch (_) {}
            return '<tr><td style="white-space:nowrap">' + fmtDT(e.created_at) + '</td><td>' + esc(e.actor_name || 'система') + '</td><td><b>' + esc(AUDIT_LABELS[e.action] || e.action) + '</b>' + (det ? '<br><span style="color:#94a3b8;font-size:11.5px">' + esc(det) + '</span>' : '') + '</td><td>' + esc((e.entity_type || '') + (e.entity_id ? ' #' + e.entity_id : '')) + '</td><td>' + esc(e.ip || '—') + '</td></tr>';
          }).join('') +
          '</tbody></table></div>'
        : '<div class="empty-note">Пусто</div>') + '</section>';
  }

  /* ─── Modal ─────────────────────────────────────────── */
  function closeModal() { var m = $('#modal-root'); if (m) m.remove(); }
  function openModal(title, body, onSave) { return modalBase(title, body, onSave, false); }
  function openModalWide(title, body, onSave) { return modalBase(title, body, onSave, true); }
  function modalBase(title, body, onSave, wide) {
    closeModal();
    var ov = document.createElement('div');
    ov.id = 'modal-root';
    ov.innerHTML =
      '<div class="modal-backdrop"><div class="modal-window' + (wide ? ' wide' : '') + '">' +
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-x">×</button></div>' +
      '<div class="modal-body">' + body + '</div>' +
      (onSave ? '<div class="modal-foot"><button class="btn btn-ghost" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button></div>' : '') +
      '</div></div>';
    document.body.appendChild(ov);
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    ov.querySelector('.modal-x').addEventListener('click', close);
    var cbtn = ov.querySelector('[data-cancel]');
    if (cbtn) cbtn.addEventListener('click', close);
    ov.querySelector('.modal-backdrop').addEventListener('click', function (e) { if (e.target === this) close(); });
    var sbtn = ov.querySelector('[data-save]');
    if (sbtn) sbtn.addEventListener('click', function () {
      onSave().then(close).catch(function (e) { toast(e.message, 'err'); });
    });
    return close;
  }

  /* ─── WebSocket ─────────────────────────────────────── */
  function connectWS() {
    if (!window.WS) return;
    window.WS.on('connect', function () {
      var d = $('#ws-dot'); if (d) { d.className = 'ws-online'; d.title = 'Онлайн'; }
    });
    window.WS.on('disconnect', function () {
      var d = $('#ws-dot'); if (d) { d.className = 'ws-offline'; d.title = 'Переподключение…'; }
    });
    window.WS.on('queue.updated', function () { if (view === 'queue' || view === 'dashboard') render(); });
    window.WS.on('appointment.created', function (data) {
      if (view === 'queue' || view === 'schedule') render();
      if (data && data.appointment) toast('Новый талон ' + data.appointment.ticket_number, 'info');
    });
    window.WS.on('appointment.status.updated', function () { if (view === 'queue' || view === 'schedule') render(); });
    window.WS.on('doctor.status.updated', function (data) {
      if (data && data.doctorId === user.id && data.status) {
        paintStatusDot(data.status);
        var ms = $('#my-status');
        if (ms) ms.value = data.status;
      }
      if (view === 'queue' || view === 'schedule') render();
    });
    window.WS.on('patient.created', function () { if (view === 'patients') loadPatients(val('p-q')); });
    window.WS.on('patient.updated', function () { if (view === 'patients') loadPatients(val('p-q')); });
  }

  /* ─── Extra styles ──────────────────────────────────── */
  function injectExtraStyles() {
    var st = document.createElement('style');
    st.textContent =
      '.modal-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px}' +
      '.modal-window{background:#fff;border-radius:20px;box-shadow:var(--shadow-float);width:100%;max-width:520px;max-height:90vh;overflow:auto;animation:pop .2s ease}' +
      '.modal-window.wide{max-width:780px}' +
      '.modal-head{display:flex;justify-content:space-between;align-items:center;padding:18px 22px 0}' +
      '.modal-head h3{margin:0;font-size:17px;color:var(--brand-700)}' +
      '.modal-x{background:none;border:none;font-size:22px;color:var(--med-muted);cursor:pointer;line-height:1}' +
      '.modal-body{padding:16px 22px}' +
      '.modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:0 22px 20px}' +
      '@keyframes pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}' +
      '.mkb-list{position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--med-line);border-radius:10px;box-shadow:var(--shadow-card);z-index:50;max-height:180px;overflow:auto;display:none}' +
      '.mkb-list:not(:empty){display:block}' +
      '.mkb-item{padding:8px 12px;font-size:13px;cursor:pointer}' +
      '.mkb-item:hover{background:var(--brand-50)}' +
      '#toasts{position:fixed;right:18px;bottom:18px;z-index:200;display:flex;flex-direction:column;gap:8px}' +
      '.filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}' +
      '.chip{border:1px solid var(--med-line);background:#fff;border-radius:999px;padding:6px 14px;font-size:13px;color:var(--med-text);cursor:pointer;transition:.15s}' +
      '.chip b{color:var(--brand-600)}' +
      '.chip:hover{border-color:var(--brand-400)}' +
      '.chip-on{background:var(--brand-600);border-color:var(--brand-600);color:#fff}' +
      '.chip-on b{color:#fff}' +
      '.mini-badge{display:inline-block;font-size:10px;font-weight:800;border-radius:6px;padding:2px 6px;letter-spacing:.5px;vertical-align:middle}' +
      '.mini-badge.dc{background:#5865F2;color:#fff}' +
      '.mini-badge.sl{background:#fef3c7;color:#92400e;border:1px solid #fcd34d}' +
      '.st-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:2px}' +
      '.st-free{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25)}' +
      '.st-in_appointment{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.25)}' +
      '.st-offline{background:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.25)}' +
      '.btn-danger{background:#dc2626;color:#fff}' +
      '.btn-danger:hover{background:#b91c1c}' +
      '.btn-light{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.35)}' +
      '.btn-light:hover{background:rgba(255,255,255,.3)}' +
      '.bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}' +
      '.bar-label{width:220px;font-size:12.5px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}' +
      '.bar-track{flex:1;height:14px;background:#f1f5f9;border-radius:999px;overflow:hidden}' +
      '.bar-fill{height:100%;border-radius:999px}' +
      '.bf-blue{background:linear-gradient(90deg,#3b82f6,#2563eb)}' +
      '.bf-green{background:linear-gradient(90deg,#34d399,#059669)}' +
      '.bar-num{width:36px;text-align:right;font-weight:700;font-size:12.5px;color:#334155}' +
      '.vchart{display:flex;align-items:flex-end;gap:10px;height:140px;padding-top:6px}' +
      '.vbar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}' +
      '.vbar{width:70%;max-width:44px;background:linear-gradient(180deg,#60a5fa,#2563eb);border-radius:6px 6px 2px 2px;transition:height .4s ease}' +
      '.vbar-lbl{font-size:11px;color:#94a3b8;margin-top:4px}';
    document.head.appendChild(st);
  }

  /* ─── Boot ──────────────────────────────────────────── */
  function boot() {
    injectExtraStyles();
    api('GET', '/api/me').then(function (d) {
      user = d.user;
      renderShell();
    }).catch(function (e) {
      if (e.status === 401) { location.href = '/login.html'; return; }
      document.body.innerHTML = '<div class="alert alert-danger" style="margin:40px auto;max-width:520px">Ошибка соединения с сервером</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

