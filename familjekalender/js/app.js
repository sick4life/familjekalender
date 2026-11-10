(function () {
  'use strict';
  const R = window.Recur;
  const D = window.Data;
  const C = window.APP_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => R.ymd(new Date());
  const CAN_WRITE = D.demo || !!C.GOOGLE_CLIENT_ID; // utan Google visas iCloud skrivskyddat

  // ---------- Inställningar för just den här enheten ----------
  const DEV_KEY = 'fk-device';
  const isPhone = () => Math.min(window.innerWidth, window.innerHeight) < 600;
  const device = Object.assign({
    who: '', slideshow: !isPhone(), interval: 15, nightOn: true, nightStart: '22:00', nightEnd: '06:30', nightLevel: 0.88,
    view: 'week',
  }, JSON.parse(localStorage.getItem(DEV_KEY) || '{}'));
  const saveDevice = () => localStorage.setItem(DEV_KEY, JSON.stringify(device));

  const S = {
    view: device.view, anchor: today(), people: [], tasks: [], completions: [], settings: {},
    events: [], evErrors: [], evRange: '', calendars: [], gStatus: null, weather: null, statsPeriod: 'week', tab: 'cal',
  };

  // ---------- Hjälpare ----------
  const fmt = (opts) => new Intl.DateTimeFormat('sv-SE', opts);
  const fTime = fmt({ hour: '2-digit', minute: '2-digit' });
  const fDayName = fmt({ weekday: 'short' });
  const fLongDate = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
  const fMonth = fmt({ month: 'long', year: 'numeric' });
  const fShort = fmt({ day: 'numeric', month: 'short' });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const person = (id) => S.people.find((p) => p.id === id);
  const initials = (n) => (n || '?').trim().slice(0, 1).toUpperCase();
  const avatar = (p, size = '') => p ? `<span class="av ${size}" style="--c:${esc(p.color)}">${esc(initials(p.name))}</span>` : '';

  function toast(msg, ms = 3000) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  async function safe(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { console.error(e); toast('Fel: ' + e.message, 5000); return undefined; }
  }

  const evStart = (e) => (e.allDay ? R.parseYmd(e.start).getTime() : Date.parse(e.start));
  const evEnd = (e) => (e.allDay ? R.parseYmd(e.end).getTime() : Date.parse(e.end));
  function eventsOn(day) {
    const a = R.parseYmd(day).getTime(), b = R.parseYmd(R.addDays(day, 1)).getTime();
    return S.events
      .filter((e) => evStart(e) < b && evEnd(e) > a)
      .sort((x, y) => (y.allDay - x.allDay) || evStart(x) - evStart(y) || x.title.localeCompare(y.title));
  }
  function timeLabel(e, day) {
    if (e.allDay) return '';
    const s = evStart(e), dayStart = R.parseYmd(day).getTime();
    return s < dayStart ? 'forts.' : fTime.format(s);
  }

  // Sysslor
  function doneFor(taskId, date) {
    return S.completions.find((c) => c.task_id === taskId && c.for_date === date);
  }
  function tasksOn(date) {
    return S.tasks.filter((t) => R.occursOn(t, date)).map((t) => ({ task: t, done: doneFor(t.id, date) }));
  }
  function overdue() {
    const out = [], seen = new Set(), t0 = today();
    for (let i = 1; i <= 2; i++) {
      const d = R.addDays(t0, -i);
      for (const t of S.tasks) {
        if (seen.has(t.id) || !R.occursOn(t, d)) continue;
        seen.add(t.id);
        if (R.occursOn(t, t0)) continue; // finns redan i dagens lista
        if (!doneFor(t.id, d)) out.push({ task: t, date: d });
      }
    }
    return out;
  }

  // ---------- Vy-intervall ----------
  function viewRange() {
    if (S.view === 'day') return [S.anchor, R.addDays(S.anchor, 1)];
    if (S.view === 'week') { const m = R.mondayOf(S.anchor); return [m, R.addDays(m, 7)]; }
    const d = R.parseYmd(S.anchor);
    const first = R.ymd(new Date(d.getFullYear(), d.getMonth(), 1));
    const start = R.mondayOf(first);
    return [start, R.addDays(start, 42)];
  }
  function rangeLabel() {
    const [a, b] = viewRange();
    if (S.view === 'day') return cap(fLongDate.format(R.parseYmd(a)));
    if (S.view === 'week') {
      const last = R.addDays(b, -1);
      return `v. ${R.isoWeek(a)} · ${fShort.format(R.parseYmd(a))} – ${fShort.format(R.parseYmd(last))}`;
    }
    return cap(fMonth.format(R.parseYmd(S.anchor)));
  }
  function navigate(dir) {
    if (dir === 0) S.anchor = today();
    else if (S.view === 'day') S.anchor = R.addDays(S.anchor, dir);
    else if (S.view === 'week') S.anchor = R.addDays(S.anchor, 7 * dir);
    else { const d = R.parseYmd(S.anchor); S.anchor = R.ymd(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
    renderCalendar();
    loadEvents();
  }

  // ---------- Laddning ----------
  async function loadData() {
    const d = await safe(() => D.load());
    if (!d) return;
    Object.assign(S, d);
    renderAll();
  }
  async function loadEvents(force) {
    const [a, b] = viewRange();
    // hämta lite extra så att bläddring känns snabb
    const min = R.addDays(a, -7), max = R.addDays(b, 7);
    const key = min + '|' + max;
    if (!force && S.evRange && S.evRange.split('|')[0] <= a && S.evRange.split('|')[1] >= b && Date.now() - (S.evLoaded || 0) < 5 * 6e4) return;
    try {
      const r = await D.cal.events(new Date(R.parseYmd(min)).toISOString(), new Date(R.parseYmd(max)).toISOString());
      S.events = r.events || [];
      S.evErrors = r.errors || [];
      S.evRange = key;
      S.evLoaded = Date.now();
      renderCalendar();
    } catch (e) {
      console.error(e);
      S.evErrors = [{ calendarName: 'Kalender', message: e.message }];
      renderCalendar();
    }
  }
  async function loadWeather() {
    const loc = S.settings.location || { name: 'Norrköping', lat: 58.59, lon: 16.19 };
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FStockholm&forecast_days=14`;
      const r = await fetch(u);
      S.weather = await r.json();
      renderHeader();
      renderCalendar();
    } catch { /* väder är valfritt */ }
  }
  function wxIcon(code, day = 1) {
    const c = Number(code);
    if (c === 0) return day ? '☀️' : '🌙';
    if (c <= 2) return day ? '🌤️' : '☁️';
    if (c === 3) return '☁️';
    if (c === 45 || c === 48) return '🌫️';
    if (c >= 51 && c <= 67) return '🌧️';
    if (c >= 71 && c <= 77) return '🌨️';
    if (c >= 80 && c <= 82) return '🌦️';
    if (c >= 85 && c <= 86) return '🌨️';
    if (c >= 95) return '⛈️';
    return '🌡️';
  }
  function wxForDay(day) {
    const w = S.weather && S.weather.daily;
    if (!w) return '';
    const i = w.time.indexOf(day);
    if (i < 0) return '';
    return `<span class="wx">${wxIcon(w.weather_code[i])} ${Math.round(w.temperature_2m_max[i])}°<small>/${Math.round(w.temperature_2m_min[i])}°</small></span>`;
  }

  // ---------- Rendering ----------
  function renderShell() {
    $('#app').innerHTML = `
      <div class="shell ${isPhone() ? 'phone' : ''}" data-tab="${S.tab}">
        <header class="top">
          <div class="clock"><div class="time"></div><div class="date"></div></div>
          <div class="wx-now"></div>
          <div class="grow"></div>
          <div class="navgrp">
            <button class="btn icon" data-a="nav" data-dir="-1" aria-label="Föregående">‹</button>
            <button class="btn" data-a="nav" data-dir="0">Idag</button>
            <button class="btn icon" data-a="nav" data-dir="1" aria-label="Nästa">›</button>
            <div class="range"></div>
          </div>
          <div class="seg" role="tablist">
            <button data-a="view" data-v="day">Dag</button>
            <button data-a="view" data-v="week">Vecka</button>
            <button data-a="view" data-v="month">Månad</button>
          </div>
          ${CAN_WRITE ? '<button class="btn primary" data-a="new-event">＋ <span class="hide-sm">Händelse</span></button>' : ''}
          <button class="btn icon" data-a="settings" aria-label="Inställningar">⚙︎</button>
        </header>
        ${D.demo ? '<div class="demo-banner">Demoläge – inget sparas i molnet än. Fyll i js/config.js för att koppla på Supabase.</div>' : ''}
        <main class="main ${device.slideshow ? 'has-photo' : ''}">
          <section class="cal" id="cal"></section>
          <aside class="side">
            <div class="panel" id="tasks"></div>
            <div class="panel" id="stats"></div>
            ${device.slideshow ? '<div class="panel photo" id="photo"></div>' : ''}
          </aside>
        </main>
        <nav class="tabs">
          <button data-a="tab" data-t="cal">📅<span>Kalender</span></button>
          <button data-a="tab" data-t="tasks">✅<span>Sysslor</span></button>
        </nav>
      </div>`;
    setupSwipe();
    if (device.slideshow) Slideshow.mount($('#photo'));
  }
  function renderAll() {
    renderHeader();
    renderCalendar();
    renderTasks();
    renderStats();
  }
  function renderHeader() {
    const now = new Date();
    const t = $('.top .time'); if (!t) return;
    t.textContent = fTime.format(now);
    $('.top .date').textContent = cap(fLongDate.format(now)) + ' · v. ' + R.isoWeek(today());
    const w = S.weather && S.weather.current;
    $('.wx-now').innerHTML = w ? `<span class="wx-big">${wxIcon(w.weather_code, w.is_day)}</span><span>${Math.round(w.temperature_2m)}°</span>` : '';
    $('.range').textContent = rangeLabel();
    $$('.top .seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.view));
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === S.tab));
  }

  function evCard(e, day, big) {
    const time = timeLabel(e, day);
    const end = !e.allDay && big ? ' – ' + fTime.format(evEnd(e)) : '';
    return `<div class="ev ${e.allDay ? 'allday' : ''}" style="--c:${esc(e.color || '#888')}" data-a="event" data-id="${esc(e.id)}">
      ${time ? `<time>${time}${end}</time>` : ''}<span class="t">${esc(e.title)}</span>
      ${big && e.location ? `<span class="loc">📍 ${esc(e.location)}</span>` : ''}
    </div>`;
  }
  function taskChip(o, date) {
    const p = o.done ? person(o.done.person_id) : person(o.task.assignee);
    return `<button class="chip ${o.done ? 'done' : ''}" data-a="task-tap" data-id="${o.task.id}" data-date="${date}" style="--c:${p ? esc(p.color) : 'var(--muted)'}">
      <span class="e">${esc(o.task.emoji)}</span><span class="t">${esc(o.task.title)}</span>${o.done ? '<span class="ck">✓</span>' : p ? avatar(p, 'xs') : ''}
    </button>`;
  }

  function renderCalendar() {
    const el = $('#cal'); if (!el) return;
    renderHeader();
    const t0 = today();
    const errs = S.evErrors && S.evErrors.length
      ? `<div class="cal-err" data-a="settings">⚠️ ${esc(S.evErrors.map((e) => e.calendarName + ': ' + e.message).join(' · '))}</div>` : '';
    if (S.view === 'week') {
      const [a] = viewRange();
      let html = '<div class="week">';
      for (let i = 0; i < 7; i++) {
        const d = R.addDays(a, i);
        const evs = eventsOn(d);
        const tks = tasksOn(d);
        html += `<section class="day ${d === t0 ? 'today' : ''} ${d < t0 ? 'past' : ''} ${i >= 5 ? 'weekend' : ''}" data-a="day-bg" data-date="${d}">
          <header><span class="dn">${esc(fDayName.format(R.parseYmd(d)).replace('.', ''))}</span><span class="num">${R.parseYmd(d).getDate()}</span>${wxForDay(d)}</header>
          <div class="evs">${evs.map((e) => evCard(e, d)).join('') || ''}</div>
          ${tks.length ? `<div class="dtasks">${tks.map((o) => taskChip(o, d)).join('')}</div>` : ''}
        </section>`;
      }
      el.innerHTML = errs + html + '</div>';
    } else if (S.view === 'month') {
      const [a] = viewRange();
      const m = R.parseYmd(S.anchor).getMonth();
      let html = '<div class="month"><div class="mhead"><span></span>' + ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'].map((x) => `<span>${x}</span>`).join('') + '</div>';
      for (let w = 0; w < 6; w++) {
        const ws = R.addDays(a, w * 7);
        html += `<div class="mrow"><span class="wk">${R.isoWeek(ws)}</span>`;
        for (let i = 0; i < 7; i++) {
          const d = R.addDays(ws, i);
          const evs = eventsOn(d);
          const max = 3;
          html += `<div class="mcell ${R.parseYmd(d).getMonth() !== m ? 'other' : ''} ${d === t0 ? 'today' : ''}" data-a="goto-day" data-date="${d}">
            <span class="num">${R.parseYmd(d).getDate()}</span>
            ${evs.slice(0, max).map((e) => `<div class="mev ${e.allDay ? 'allday' : ''}" style="--c:${esc(e.color || '#888')}">${e.allDay ? '' : `<b>${timeLabel(e, d)}</b> `}${esc(e.title)}</div>`).join('')}
            ${evs.length > max ? `<div class="more">+${evs.length - max} till</div>` : ''}
          </div>`;
        }
        html += '</div>';
      }
      el.innerHTML = errs + html + '</div>';
    } else {
      const d = S.anchor;
      const evs = eventsOn(d);
      const tks = tasksOn(d);
      el.innerHTML = errs + `<div class="dayview ${d === t0 ? 'today' : ''}">
        <header><h2>${esc(cap(fLongDate.format(R.parseYmd(d))))}</h2>${wxForDay(d)}</header>
        <div class="dv-evs" data-a="day-bg" data-date="${d}">
          ${evs.length ? evs.map((e) => evCard(e, d, true)).join('') : `<p class="empty">${CAN_WRITE ? 'Inget inplanerat – tryck för att lägga till.' : 'Inget inplanerat.'}</p>`}
        </div>
        ${tks.length ? `<h3>Sysslor</h3><div class="dtasks big">${tks.map((o) => taskChip(o, d)).join('')}</div>` : ''}
      </div>`;
    }
  }

  function renderTasks() {
    const el = $('#tasks'); if (!el) return;
    const t0 = today();
    const list = tasksOn(t0);
    const od = overdue();
    const quick = S.tasks.filter((t) => t.recur === 'quick' && t.active !== false);
    const doneToday = S.completions.filter((c) => c.for_date === t0 || (R.ymd(new Date(c.done_at)) === t0 && !c.task_id))
      .sort((a, b) => b.done_at.localeCompare(a.done_at));
    const row = (o, date) => {
      const p = o.done ? person(o.done.person_id) : null;
      const asg = person(o.task.assignee);
      return `<button class="trow ${o.done ? 'done' : ''}" data-a="task-tap" data-id="${o.task.id}" data-date="${date}">
        <span class="box">${o.done ? '✓' : ''}</span>
        <span class="e">${esc(o.task.emoji)}</span>
        <span class="t">${esc(o.task.title)}${date !== t0 ? `<small>${esc(fDayName.format(R.parseYmd(date)))} ${R.parseYmd(date).getDate()}/${R.parseYmd(date).getMonth() + 1}</small>` : ''}</span>
        ${o.done ? `${avatar(p, 'sm')}<small class="when">${fTime.format(new Date(o.done.done_at))}</small>` : asg ? avatar(asg, 'sm ghost') : ''}
      </button>`;
    };
    el.innerHTML = `
      <div class="ph"><h2>Sysslor idag</h2><button class="btn sm" data-a="manage-tasks">Hantera</button></div>
      <div class="tlist">
        ${list.length ? list.map((o) => row(o, t0)).join('') : '<p class="empty">Inga schemalagda sysslor idag 🎉</p>'}
      </div>
      <div class="ph"><h3>Jag har gjort…</h3></div>
      <div class="quick">
        ${quick.map((t) => `<button class="qbtn" data-a="quick" data-id="${t.id}"><span>${esc(t.emoji)}</span>${esc(t.title)}</button>`).join('')}
        <button class="qbtn other" data-a="quick-other"><span>＋</span>Annat</button>
      </div>
      ${od.length ? `<div class="sub">Missade</div><div class="tlist">${od.map((o) => row({ task: o.task, done: null }, o.date)).join('')}</div>` : ''}
      ${doneToday.filter((c) => !c.task_id || quick.some((q) => q.id === c.task_id) || !S.tasks.some((t) => t.id === c.task_id)).length ? `
        <div class="sub">Gjort idag</div>
        <div class="donelog">${doneToday.filter((c) => !c.task_id || quick.some((q) => q.id === c.task_id) || !S.tasks.some((t) => t.id === c.task_id)).map((c) => `
          <button class="dl" data-a="undo" data-id="${c.id}">${avatar(person(c.person_id), 'xs')}<span>${esc(c.emoji || '✅')} ${esc(c.title)}</span><small>${fTime.format(new Date(c.done_at))}</small></button>`).join('')}
        </div>` : ''}
    `;
  }

  function periodStart(p) {
    const t0 = today();
    if (p === 'week') return R.mondayOf(t0);
    const d = R.parseYmd(t0);
    if (p === 'month') return R.ymd(new Date(d.getFullYear(), d.getMonth(), 1));
    return R.ymd(new Date(d.getFullYear(), 0, 1));
  }
  function countsFor(p) {
    const start = periodStart(p);
    const counts = {};
    S.people.forEach((x) => (counts[x.id] = 0));
    for (const c of S.completions) if (c.for_date >= start && counts[c.person_id] !== undefined) counts[c.person_id]++;
    return counts;
  }
  function renderStats() {
    const el = $('#stats'); if (!el) return;
    const counts = countsFor(S.statsPeriod);
    const max = Math.max(1, ...Object.values(counts));
    const top = Math.max(...Object.values(counts));
    el.innerHTML = `
      <div class="ph"><h2>Poäng</h2>
        <div class="seg sm">${[['week', 'Vecka'], ['month', 'Månad'], ['year', 'År']].map(([k, l]) => `<button class="${S.statsPeriod === k ? 'on' : ''}" data-a="stats-period" data-p="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="bars" data-a="stats-detail">
        ${S.people.map((p) => `<div class="bar">${avatar(p, 'sm')}<div class="track"><div class="fill" style="width:${(counts[p.id] / max) * 100}%;--c:${esc(p.color)}"></div></div><b>${counts[p.id]}${counts[p.id] === top && top > 0 && Object.values(counts).filter((v) => v === top).length === 1 ? ' 🏆' : ''}</b></div>`).join('')}
      </div>`;
  }

  // ---------- Modaler ----------
  function modal(html, { onMount, wide } = {}) {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><button class="x" data-close aria-label="Stäng">✕</button>${html}</div>`;
    root.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    onMount && onMount(wrap.querySelector('.modal'), close);
    return close;
  }

  function choosePerson(title) {
    if (device.who && person(device.who)) return Promise.resolve(device.who);
    return new Promise((res) => {
      let picked = null;
      const close = modal(`<h2>Vem gjorde det?</h2><p class="muted">${esc(title)}</p>
        <div class="pick">${S.people.map((p) => `<button class="pbtn" data-p="${p.id}" style="--c:${esc(p.color)}">${avatar(p, 'lg')}<span>${esc(p.name)}</span></button>`).join('')}</div>`, {
        onMount(m) {
          m.addEventListener('click', (e) => {
            const b = e.target.closest('[data-p]');
            if (b) { picked = b.dataset.p; close(); res(picked); }
          });
          new MutationObserver((_, o) => { if (!document.contains(m)) { o.disconnect(); if (!picked) res(null); } }).observe($('#modal-root'), { childList: true });
        },
      });
    });
  }

  async function completeTask(task, date) {
    const existing = doneFor(task.id, date);
    if (existing) {
      const p = person(existing.person_id);
      const close = modal(`<h2>${esc(task.emoji)} ${esc(task.title)}</h2>
        <p>Gjord av <b>${esc(p ? p.name : '?')}</b> ${esc(fShort.format(new Date(existing.done_at)))} kl ${fTime.format(new Date(existing.done_at))}.</p>
        <div class="actions"><button class="btn danger" data-undo>Ångra</button><button class="btn" data-close>Stäng</button></div>`, {
        onMount(m) {
          m.querySelector('[data-undo]').onclick = async () => {
            close();
            S.completions = S.completions.filter((c) => c.id !== existing.id);
            renderAll();
            await safe(() => D.deleteCompletion(existing.id));
          };
        },
      });
      return;
    }
    const pid = await choosePerson(task.emoji + ' ' + task.title);
    if (!pid) return;
    const c = { task_id: task.id, title: task.title, emoji: task.emoji, person_id: pid, for_date: date };
    const tmp = { ...c, id: 'tmp' + Date.now(), done_at: new Date().toISOString() };
    S.completions.unshift(tmp);
    renderAll();
    const saved = await safe(() => D.addCompletion(c), `${task.emoji} Snyggt, ${person(pid)?.name || ''}!`);
    S.completions = S.completions.filter((x) => x !== tmp);
    if (saved) S.completions.unshift(saved);
    renderAll();
  }

  async function quickLog(task) {
    const pid = await choosePerson(task.emoji + ' ' + task.title);
    if (!pid) return;
    const c = { task_id: task.id, title: task.title, emoji: task.emoji, person_id: pid, for_date: today() };
    const saved = await safe(() => D.addCompletion(c), `${task.emoji} ${task.title} – registrerat för ${person(pid)?.name || ''}`);
    if (saved) { S.completions.unshift(saved); renderAll(); }
  }

  const EMOJIS = ['🧺', '🧹', '🧽', '🍽️', '🫧', '🍳', '🗑️', '♻️', '🛒', '🪴', '🛏️', '🚿', '🐶', '🐱', '🚗', '💸', '📦', '🧾', '👕', '🧼', '🪟', '🌿', '💊', '📚', '🏋️', '✅'];

  function otherQuick() {
    const sel = device.who && person(device.who) ? device.who : '';
    modal(`<h2>Vad har du gjort?</h2>
      <label>Syssla<input id="q-title" placeholder="t.ex. Bytt glödlampa" autocomplete="off"></label>
      <div class="emojis">${EMOJIS.map((e, i) => `<button class="em ${i === EMOJIS.length - 1 ? 'on' : ''}" data-em="${e}">${e}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="q-save"> Spara som snabbknapp</label>
      <h3>Vem?</h3>
      <div class="pick">${S.people.map((p) => `<button class="pbtn ${sel === p.id ? 'on' : ''}" data-p="${p.id}" style="--c:${esc(p.color)}">${avatar(p, 'lg')}<span>${esc(p.name)}</span></button>`).join('')}</div>`, {
      onMount(m, close) {
        let emoji = '✅';
        const input = m.querySelector('#q-title');
        setTimeout(() => input.focus(), 50);
        m.addEventListener('click', async (e) => {
          const em = e.target.closest('[data-em]');
          if (em) { emoji = em.dataset.em; m.querySelectorAll('.em').forEach((x) => x.classList.toggle('on', x === em)); return; }
          const b = e.target.closest('[data-p]');
          if (!b) return;
          const title = input.value.trim();
          if (!title) { input.focus(); toast('Skriv vad du gjort'); return; }
          close();
          let taskId = null;
          if (m.querySelector('#q-save').checked) {
            const t = await safe(() => D.saveTask({ title, emoji, recur: 'quick', weekdays: [], every: 1, active: true, sort: 50, start_date: today() }));
            if (t) { taskId = t.id; S.tasks.push(t); }
          }
          const saved = await safe(() => D.addCompletion({ task_id: taskId, title, emoji, person_id: b.dataset.p, for_date: today() }), `${emoji} ${title} – registrerat`);
          if (saved) { S.completions.unshift(saved); renderAll(); }
        });
      },
    });
  }

  // Hantera sysslor
  function manageTasks() {
    const sched = S.tasks.filter((t) => t.recur !== 'quick');
    const quick = S.tasks.filter((t) => t.recur === 'quick');
    const item = (t) => `<button class="mrow-item" data-edit="${t.id}"><span class="e">${esc(t.emoji)}</span><span class="t">${esc(t.title)}<small>${esc(R.describe(t))}${t.assignee && person(t.assignee) ? ' · ' + esc(person(t.assignee).name) : ''}${t.active === false ? ' · pausad' : ''}</small></span><span class="chev">›</span></button>`;
    modal(`<h2>Sysslor</h2>
      <h3>Schemalagda</h3><div class="mlist">${sched.map(item).join('') || '<p class="empty">Inga än</p>'}</div>
      <h3>Snabbknappar</h3><div class="mlist">${quick.map(item).join('') || '<p class="empty">Inga än</p>'}</div>
      <div class="actions"><button class="btn primary" data-new>＋ Ny syssla</button></div>`, {
      wide: true,
      onMount(m, close) {
        m.addEventListener('click', (e) => {
          const b = e.target.closest('[data-edit]');
          if (b) { close(); editTask(S.tasks.find((t) => t.id === b.dataset.edit)); }
          if (e.target.closest('[data-new]')) { close(); editTask(null); }
        });
      },
    });
  }

  function editTask(task) {
    const t = task ? { ...task } : { title: '', emoji: '🧺', recur: 'weekly', weekdays: [R.isoWeekday(today())], every: 1, start_date: today(), assignee: null, active: true, sort: S.tasks.length + 1 };
    let mode = t.recur;
    if (mode === 'weekly' && (t.weekdays || []).slice().sort().join() === '6,7' && t.every === 1) mode = 'weekend';
    const wd = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
    modal(`<h2>${task ? 'Ändra syssla' : 'Ny syssla'}</h2>
      <label>Namn<input id="t-title" value="${esc(t.title)}" placeholder="t.ex. Tvätta"></label>
      <div class="emojis">${EMOJIS.map((e) => `<button class="em ${e === t.emoji ? 'on' : ''}" data-em="${e}">${e}</button>`).join('')}</div>
      <label>Upprepning
        <select id="t-mode">
          <option value="weekly">Vissa veckodagar</option>
          <option value="weekend">Varje helg</option>
          <option value="daily">Varje dag</option>
          <option value="interval">Var X:e dag</option>
          <option value="monthly">En gång i månaden</option>
          <option value="once">En gång (ett datum)</option>
          <option value="quick">Snabbknapp (inget schema)</option>
        </select>
      </label>
      <div class="opt" data-for="weekly">
        <div class="wdays">${wd.map((l, i) => `<button class="wd ${(t.weekdays || []).includes(i + 1) ? 'on' : ''}" data-wd="${i + 1}">${l}</button>`).join('')}</div>
        <label>Hur ofta<select id="t-every-w">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${t.every == n ? 'selected' : ''}>${n === 1 ? 'Varje vecka' : n === 2 ? 'Varannan vecka' : `Var ${n}:e vecka`}</option>`).join('')}</select></label>
      </div>
      <div class="opt" data-for="interval"><label>Antal dagar mellan<input id="t-every-d" type="number" min="2" max="60" value="${t.recur === 'interval' ? t.every : 3}"></label></div>
      <div class="opt" data-for="monthly"><label>Dag i månaden<input id="t-md" type="number" min="1" max="31" value="${t.monthday || R.parseYmd(today()).getDate()}"></label></div>
      <div class="opt" data-for="once weekly weekend daily interval monthly"><label><span class="lbl-once">Datum</span><span class="lbl-start">Startar</span><input id="t-start" type="date" value="${esc((t.start_date || today()).slice(0, 10))}"></label></div>
      <div class="opt" data-for="once weekly weekend daily interval monthly">
        <label>Ansvarig (valfritt)<select id="t-asg"><option value="">Vem som helst</option>${S.people.map((p) => `<option value="${p.id}" ${t.assignee === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      </div>
      ${task ? `<label class="check"><input type="checkbox" id="t-active" ${t.active !== false ? 'checked' : ''}> Aktiv</label>` : ''}
      <div class="actions">
        ${task ? '<button class="btn danger" data-del>Ta bort</button>' : ''}
        <span class="grow"></span>
        <button class="btn" data-close>Avbryt</button>
        <button class="btn primary" data-save>Spara</button>
      </div>`, {
      onMount(m, close) {
        const sel = m.querySelector('#t-mode');
        sel.value = mode;
        const sync = () => {
          const v = sel.value;
          m.querySelectorAll('.opt').forEach((o) => (o.hidden = !o.dataset.for.split(' ').includes(v)));
          m.querySelector('.lbl-once').hidden = v !== 'once';
          m.querySelector('.lbl-start').hidden = v === 'once';
        };
        sel.onchange = sync; sync();
        m.addEventListener('click', async (e) => {
          const em = e.target.closest('[data-em]');
          if (em) { t.emoji = em.dataset.em; m.querySelectorAll('.em').forEach((x) => x.classList.toggle('on', x === em)); }
          const w = e.target.closest('[data-wd]');
          if (w) w.classList.toggle('on');
          if (e.target.closest('[data-del]')) {
            if (!confirm('Ta bort "' + t.title + '"? Historiken finns kvar i statistiken.')) return;
            close();
            S.tasks = S.tasks.filter((x) => x.id !== t.id);
            renderAll();
            await safe(() => D.deleteTask(t.id), 'Borttagen');
          }
          if (e.target.closest('[data-save]')) {
            t.title = m.querySelector('#t-title').value.trim();
            if (!t.title) { toast('Ge sysslan ett namn'); return; }
            const v = sel.value;
            t.recur = v === 'weekend' ? 'weekly' : v;
            t.every = 1;
            t.weekdays = [];
            if (v === 'weekly') {
              t.weekdays = m.querySelectorAll('.wd.on').length ? Array.from(m.querySelectorAll('.wd.on')).map((x) => +x.dataset.wd) : [R.isoWeekday(today())];
              t.every = +m.querySelector('#t-every-w').value;
            }
            if (v === 'weekend') t.weekdays = [6, 7];
            if (v === 'interval') t.every = Math.max(2, +m.querySelector('#t-every-d').value || 2);
            t.monthday = v === 'monthly' ? Math.min(31, Math.max(1, +m.querySelector('#t-md').value || 1)) : null;
            t.start_date = m.querySelector('#t-start').value || today();
            if (v === 'weekly' && t.every > 1) t.start_date = t.start_date; // varannan vecka räknas från startveckan
            t.assignee = v === 'quick' ? null : (m.querySelector('#t-asg').value || null);
            if (task) t.active = m.querySelector('#t-active').checked;
            close();
            const saved = await safe(() => D.saveTask(t), 'Sparat');
            if (saved) { const i = S.tasks.findIndex((x) => x.id === saved.id); if (i >= 0) S.tasks[i] = saved; else S.tasks.push(saved); renderAll(); }
          }
        });
      },
    });
  }

  function statsDetail() {
    const start = periodStart(S.statsPeriod);
    const cs = S.completions.filter((c) => c.for_date >= start);
    const label = { week: 'den här veckan', month: 'den här månaden', year: 'i år' }[S.statsPeriod];
    const per = S.people.map((p) => {
      const mine = cs.filter((c) => c.person_id === p.id);
      const by = {};
      mine.forEach((c) => { const k = (c.emoji || '') + ' ' + c.title; by[k] = (by[k] || 0) + 1; });
      return { p, total: mine.length, by: Object.entries(by).sort((a, b) => b[1] - a[1]) };
    });
    modal(`<h2>Statistik ${label}</h2>
      <div class="statcols">${per.map(({ p, total, by }) => `<div class="statcol" style="--c:${esc(p.color)}">
        <div class="sh">${avatar(p, 'lg')}<div><b>${esc(p.name)}</b><div class="big">${total}</div></div></div>
        ${by.map(([k, n]) => `<div class="srow"><span>${esc(k)}</span><b>${n}</b></div>`).join('') || '<p class="empty">Inget än</p>'}
      </div>`).join('')}</div>
      <h3>Senaste</h3>
      <div class="history">${S.completions.slice(0, 40).map((c) => `<div class="hrow">${avatar(person(c.person_id), 'xs')}<span>${esc(c.emoji || '')} ${esc(c.title)}</span><small>${esc(fShort.format(new Date(c.done_at)))} ${fTime.format(new Date(c.done_at))}</small><button class="btn sm ghost" data-del="${c.id}">✕</button></div>`).join('')}</div>`, {
      wide: true,
      onMount(m, close) {
        m.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-del]');
          if (!b || !confirm('Ta bort registreringen?')) return;
          close();
          S.completions = S.completions.filter((c) => c.id !== b.dataset.del);
          renderAll();
          await safe(() => D.deleteCompletion(b.dataset.del), 'Borttagen');
        });
      },
    });
  }

  // ---------- Kalenderhändelser ----------
  function writableCalendars() {
    return S.calendars.filter((c) => c.writable);
  }
  async function ensureCalendars() {
    if (S.calendars.length) return;
    const c = await safe(() => D.cal.calendars());
    if (c) S.calendars = c;
  }
  function defaultCalId() {
    const conf = S.settings.calendars || {};
    const w = writableCalendars();
    return (conf.defaultId && w.find((c) => c.id === conf.defaultId) ? conf.defaultId : (w.find((c) => c.primary) || w[0] || {}).id);
  }

  function showEvent(id) {
    const e = S.events.find((x) => x.id === id);
    if (!e) return;
    if (e.readOnly) {
      const when = e.allDay
        ? `${fShort.format(R.parseYmd(e.start))}${R.daysBetween(e.start, e.end) > 1 ? ' – ' + fShort.format(R.parseYmd(R.addDays(e.end, -1))) : ''} · heldag`
        : `${cap(fLongDate.format(evStart(e)))} · ${fTime.format(evStart(e))} – ${fTime.format(evEnd(e))}`;
      modal(`<div class="evhead" style="--c:${esc(e.color)}"><span class="dot"></span><h2>${esc(e.title)}</h2></div>
        <p>${esc(when)}</p>${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}
        <p class="muted">${esc(e.calendarName || '')} · skrivskyddad${e.source === 'ics' ? ' (iCloud – ändra i iPhone-appen)' : ''}</p>`);
      return;
    }
    editEvent(e);
  }

  async function editEvent(ev, date) {
    await ensureCalendars();
    const cals = writableCalendars();
    if (!cals.length && !D.demo) {
      toast('Anslut Google Kalender under Inställningar först', 5000);
      return openSettings();
    }
    const isNew = !ev;
    let e = ev ? { ...ev } : null;
    if (!e) {
      const d = date || S.anchor;
      const now = new Date();
      let h = d === today() ? Math.min(22, now.getHours() + 1) : 12;
      e = { title: '', allDay: false, start: `${d}T${R.pad(h)}:00`, end: `${d}T${R.pad(h + 1)}:00`, location: '', description: '', calendarId: defaultCalId() };
    }
    const local = (iso) => { const d = new Date(iso); return { d: R.ymd(d), t: R.pad(d.getHours()) + ':' + R.pad(d.getMinutes()) }; };
    let sd, st, ed, et;
    if (e.allDay) { sd = e.start.slice(0, 10); ed = R.addDays(e.end.slice(0, 10), -1); st = '12:00'; et = '13:00'; }
    else {
      const a = e.start.length === 16 ? { d: e.start.slice(0, 10), t: e.start.slice(11) } : local(e.start);
      const b = e.end.length === 16 ? { d: e.end.slice(0, 10), t: e.end.slice(11) } : local(e.end);
      sd = a.d; st = a.t; ed = b.d; et = b.t;
    }
    modal(`<h2>${isNew ? 'Ny händelse' : 'Ändra händelse'}</h2>
      <label>Titel<input id="e-title" value="${esc(e.title)}" placeholder="Vad händer?"></label>
      <label class="check"><input type="checkbox" id="e-allday" ${e.allDay ? 'checked' : ''}> Heldag</label>
      <div class="two">
        <label>Från<input id="e-sd" type="date" value="${sd}"></label>
        <label class="timed">Tid<input id="e-st" type="time" value="${st}" step="300"></label>
      </div>
      <div class="two">
        <label>Till<input id="e-ed" type="date" value="${ed}"></label>
        <label class="timed">Tid<input id="e-et" type="time" value="${et}" step="300"></label>
      </div>
      <label>Plats<input id="e-loc" value="${esc(e.location)}" placeholder="Valfritt"></label>
      <label>Anteckning<textarea id="e-desc" rows="2">${esc(e.description)}</textarea></label>
      ${cals.length > 1 || D.demo ? `<label>Kalender<select id="e-cal" ${isNew ? '' : 'disabled'}>${(cals.length ? cals : [{ id: 'demo', name: 'Familj' }]).map((c) => `<option value="${esc(c.id)}" ${c.id === e.calendarId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      ${e.recurringEventId ? '<p class="muted">Återkommande händelse – ändringar gäller bara detta tillfälle.</p>' : ''}
      <div class="actions">
        ${isNew ? '' : '<button class="btn danger" data-del>Ta bort</button>'}
        <span class="grow"></span>
        <button class="btn" data-close>Avbryt</button>
        <button class="btn primary" data-save>Spara</button>
      </div>`, {
      onMount(m, close) {
        const ad = m.querySelector('#e-allday');
        const sync = () => m.querySelectorAll('.timed').forEach((x) => (x.hidden = ad.checked));
        ad.onchange = sync; sync();
        // flytta sluttiden när starten ändras
        const sdI = m.querySelector('#e-sd'), stI = m.querySelector('#e-st'), edI = m.querySelector('#e-ed'), etI = m.querySelector('#e-et');
        let prev = new Date(sdI.value + 'T' + stI.value).getTime();
        const shift = () => {
          const now = new Date(sdI.value + 'T' + (stI.value || '00:00')).getTime();
          if (!isNaN(now) && !isNaN(prev)) {
            const end = new Date(edI.value + 'T' + (etI.value || '00:00')).getTime() + (now - prev);
            const d = new Date(end);
            edI.value = R.ymd(d); etI.value = R.pad(d.getHours()) + ':' + R.pad(d.getMinutes());
          }
          prev = now;
        };
        sdI.onchange = shift; stI.onchange = shift;
        if (isNew) setTimeout(() => m.querySelector('#e-title').focus(), 50);
        m.addEventListener('click', async (evt) => {
          if (evt.target.closest('[data-del]')) {
            let series = false;
            if (e.recurringEventId) {
              series = confirm('Ta bort HELA serien?\n\nOK = hela serien\nAvbryt = bara detta tillfälle');
            } else if (!confirm('Ta bort "' + e.title + '"?')) return;
            close();
            S.events = S.events.filter((x) => x.id !== e.id && (!series || x.recurringEventId !== e.recurringEventId));
            renderCalendar();
            await safe(() => D.cal.remove(e.calendarId, series ? e.recurringEventId : e.id), 'Borttagen');
            loadEvents(true);
          }
          if (evt.target.closest('[data-save]')) {
            const title = m.querySelector('#e-title').value.trim();
            if (!title) { toast('Skriv en titel'); return; }
            const allDay = ad.checked;
            let start, end;
            if (allDay) {
              start = sdI.value;
              end = R.addDays(edI.value && edI.value >= sdI.value ? edI.value : sdI.value, 1);
            } else {
              start = sdI.value + 'T' + stI.value;
              end = edI.value + 'T' + etI.value;
              if (end <= start) { const d = new Date(new Date(start).getTime() + 36e5); end = R.ymd(d) + 'T' + R.pad(d.getHours()) + ':' + R.pad(d.getMinutes()); }
            }
            const body = { title, allDay, start, end, location: m.querySelector('#e-loc').value.trim(), description: m.querySelector('#e-desc').value.trim() };
            const calId = isNew ? (m.querySelector('#e-cal') ? m.querySelector('#e-cal').value : defaultCalId()) : e.calendarId;
            close();
            const ok = await safe(() => (isNew ? D.cal.create(calId, body) : D.cal.update(calId, e.id, body)), isNew ? 'Tillagd – syns snart i telefonerna' : 'Sparat');
            if (ok) loadEvents(true);
          }
        });
      },
    });
  }

  // ---------- Inställningar ----------
  function googleAuthUrl() {
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('g-state', state);
    const p = new URLSearchParams({
      client_id: C.GOOGLE_CLIENT_ID, redirect_uri: location.origin + location.pathname, response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/calendar', access_type: 'offline', prompt: 'consent', state,
    });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
  }
  async function handleOAuthReturn() {
    const q = new URLSearchParams(location.search);
    if (!q.get('code') && !q.get('error')) return;
    history.replaceState(null, '', location.pathname);
    if (q.get('error')) return toast('Google: ' + q.get('error'), 5000);
    if (q.get('state') !== sessionStorage.getItem('g-state')) return toast('Google-inloggningen gick inte att verifiera, försök igen');
    const r = await safe(() => D.cal.exchange(q.get('code'), location.origin + location.pathname));
    if (r) { toast('Google Kalender ansluten ✓ ' + (r.email || '')); S.calendars = []; loadEvents(true); }
  }

  async function openSettings() {
    const status = await safe(() => D.cal.status()) || {};
    S.gStatus = status;
    if (status.connected) await ensureCalendars();
    const conf = S.settings.calendars || {};
    const shown = Array.isArray(conf.shown) ? conf.shown : S.calendars.filter((c) => c.selected || c.primary).map((c) => c.id);
    const feeds = S.settings.ics_feeds || [];
    const loc = S.settings.location || { name: 'Norrköping' };
    const photoCount = (await Photos.all().catch(() => [])).length;
    modal(`<h2>Inställningar</h2>
      <section class="set">
        <h3>Personer</h3>
        <div class="people-edit">${S.people.map((p) => `<div class="pe" data-pid="${p.id}"><input type="color" value="${esc(p.color)}" data-pc><input value="${esc(p.name)}" data-pn></div>`).join('')}</div>
        <button class="btn sm" data-save-people>Spara personer</button>
      </section>

      ${!C.GOOGLE_CLIENT_ID && !D.demo ? '' : `      <section class="set">
        <h3>Google Kalender (synkas med iPhone)</h3>
        ${status.connected
          ? `<p>✅ Ansluten som <b>${esc(status.email || '')}</b></p>
             <div class="callist">${S.calendars.map((c) => `<label class="calrow"><input type="checkbox" data-show="${esc(c.id)}" ${shown.includes(c.id) ? 'checked' : ''}><span class="dot" style="--c:${esc(c.color)}"></span><span class="grow">${esc(c.name)}</span>${c.writable ? `<span class="def"><input type="radio" name="defcal" value="${esc(c.id)}" ${c.id === defaultCalId() ? 'checked' : ''}> standard</span>` : '<small>läs</small>'}</label>`).join('')}</div>
             <div class="row"><button class="btn sm" data-save-cals>Spara kalenderval</button><button class="btn sm ghost" data-gdisc>Koppla från</button></div>`
          : C.GOOGLE_CLIENT_ID
            ? `<p class="muted">Gör detta en gång, gärna från datorn. Alla enheter använder sedan samma koppling.</p><a class="btn primary" href="${esc(googleAuthUrl())}">Anslut Google Kalender</a>`
            : '<p class="muted">GOOGLE_CLIENT_ID saknas i js/config.js.</p>'}
      </section>`}

      <section class="set">
        <h3>iCloud-kalendrar</h3>
        <p class="muted">iPhone: Kalender → Kalendrar → (i) vid kalendern → Offentlig kalender → Dela länk. Klistra in länken här. Händelser lägger ni till och ändrar i Kalender-appen på telefonen – de syns här inom några minuter.</p>
        <div class="feeds">${feeds.map((f, i) => `<div class="feed"><span class="dot" style="--c:${esc(f.color)}"></span><span class="grow">${esc(f.name)}</span><button class="btn sm ghost" data-rmfeed="${i}">Ta bort</button></div>`).join('')}</div>
        <div class="addfeed"><input id="f-name" placeholder="Namn, t.ex. Peters iCloud"><input id="f-url" placeholder="webcal://p…icloud.com/…"><input id="f-color" type="color" value="#8e8e93"><button class="btn sm" data-addfeed>Lägg till</button></div>
      </section>

      <section class="set">
        <h3>Väder</h3>
        <div class="row"><input id="w-city" value="${esc(loc.name)}" placeholder="Ort"><button class="btn sm" data-city>Spara ort</button></div>
      </section>

      <section class="set">
        <h3>Den här enheten</h3>
        <label>Vem använder den?<select id="d-who"><option value="">Delad – fråga vem som gjorde sysslan</option>${S.people.map((p) => `<option value="${p.id}" ${device.who === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" id="d-slide" ${device.slideshow ? 'checked' : ''}> Visa bildspel (${photoCount} bilder på enheten)</label>
        <div class="row"><label>Byt bild var<select id="d-int">${[8, 15, 30, 60, 300].map((s) => `<option value="${s}" ${device.interval == s ? 'selected' : ''}>${s < 60 ? s + ' s' : s / 60 + ' min'}</option>`).join('')}</select></label>
        <button class="btn sm" data-photos>Hantera bilder</button></div>
        <label class="check"><input type="checkbox" id="d-night" ${device.nightOn ? 'checked' : ''}> Dimma skärmen på natten</label>
        <div class="two"><label>Från<input type="time" id="d-ns" value="${device.nightStart}"></label><label>Till<input type="time" id="d-ne" value="${device.nightEnd}"></label></div>
        <label>Mörker<input type="range" id="d-nl" min="0.5" max="0.97" step="0.01" value="${device.nightLevel}"></label>
        <button class="btn sm" data-save-device>Spara för enheten</button>
      </section>

      <section class="set">
        <div class="row"><button class="btn sm" data-reload>Ladda om</button>${D.demo ? '<button class="btn sm ghost" data-logout>Återställ demo</button>' : '<button class="btn sm ghost" data-logout>Logga ut</button>'}</div>
      </section>`, {
      wide: true,
      onMount(m, close) {
        m.addEventListener('click', async (e) => {
          const t = e.target;
          if (t.closest('[data-save-people]')) {
            for (const row of m.querySelectorAll('.pe')) {
              const p = { id: row.dataset.pid, name: row.querySelector('[data-pn]').value.trim() || '?', color: row.querySelector('[data-pc]').value };
              await safe(() => D.savePerson({ ...person(p.id), ...p }));
            }
            toast('Sparat'); loadData();
          }
          if (t.closest('[data-save-cals]')) {
            const shownIds = Array.from(m.querySelectorAll('[data-show]:checked')).map((x) => x.dataset.show);
            const def = m.querySelector('input[name=defcal]:checked');
            const v = { shown: shownIds, defaultId: def ? def.value : null };
            S.settings.calendars = v;
            await safe(() => D.saveSetting('calendars', v), 'Sparat');
            loadEvents(true);
          }
          if (t.closest('[data-gdisc]')) {
            if (!confirm('Koppla från Google Kalender?')) return;
            await safe(() => D.cal.disconnect(), 'Frånkopplad'); close(); S.calendars = []; loadEvents(true);
          }
          if (t.closest('[data-addfeed]')) {
            const url = m.querySelector('#f-url').value.trim();
            if (!/^(webcal|https?):\/\//i.test(url)) return toast('Klistra in en webcal://- eller https://-länk');
            const v = [...feeds, { name: m.querySelector('#f-name').value.trim() || 'iCloud', url, color: m.querySelector('#f-color').value }];
            S.settings.ics_feeds = v;
            await safe(() => D.saveSetting('ics_feeds', v), 'Tillagd');
            close(); loadEvents(true); openSettings();
          }
          const rm = t.closest('[data-rmfeed]');
          if (rm) {
            const v = feeds.filter((_, i) => i !== +rm.dataset.rmfeed);
            S.settings.ics_feeds = v;
            await safe(() => D.saveSetting('ics_feeds', v), 'Borttagen');
            close(); loadEvents(true); openSettings();
          }
          if (t.closest('[data-city]')) {
            const name = m.querySelector('#w-city').value.trim();
            try {
              const r = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=sv&name=' + encodeURIComponent(name))).json();
              const g = r.results && r.results[0];
              if (!g) return toast('Hittade inte orten');
              const v = { name: g.name, lat: g.latitude, lon: g.longitude };
              S.settings.location = v;
              await safe(() => D.saveSetting('location', v), 'Väder för ' + g.name);
              loadWeather();
            } catch { toast('Kunde inte söka ort'); }
          }
          if (t.closest('[data-photos]')) { close(); managePhotos(); }
          if (t.closest('[data-save-device]')) {
            const slideBefore = device.slideshow;
            device.who = m.querySelector('#d-who').value;
            device.slideshow = m.querySelector('#d-slide').checked;
            device.interval = +m.querySelector('#d-int').value;
            device.nightOn = m.querySelector('#d-night').checked;
            device.nightStart = m.querySelector('#d-ns').value || '22:00';
            device.nightEnd = m.querySelector('#d-ne').value || '06:30';
            device.nightLevel = +m.querySelector('#d-nl').value;
            saveDevice();
            toast('Sparat för den här enheten');
            if (slideBefore !== device.slideshow) { close(); renderShell(); renderAll(); }
            else Slideshow.restart();
            Night.check();
          }
          if (t.closest('[data-reload]')) location.reload();
          if (t.closest('[data-logout]')) { if (confirm(D.demo ? 'Återställa demodata?' : 'Logga ut från den här enheten?')) { await D.logout(); location.reload(); } }
        });
      },
    });
  }

  async function managePhotos() {
    const list = await Photos.all();
    const urls = [];
    const close = modal(`<h2>Bilder på den här enheten</h2>
      <p class="muted">Bilderna sparas bara här och laddas inte upp någonstans.</p>
      <label class="btn primary file">＋ Lägg till bilder<input type="file" accept="image/*" multiple hidden id="ph-in"></label>
      <div class="thumbs">${list.map((p) => { const u = URL.createObjectURL(p.blob); urls.push(u); return `<div class="th" style="background-image:url(${u})"><button data-rm="${p.id}">✕</button></div>`; }).join('')}</div>
      ${list.length ? '<button class="btn sm ghost" data-clear>Ta bort alla</button>' : ''}`, {
      wide: true,
      onMount(m, close) {
        m.querySelector('#ph-in').onchange = async (e) => {
          const files = Array.from(e.target.files);
          toast('Sparar ' + files.length + ' bilder…', 60000);
          const n = await Photos.add(files, (i, tot) => toast(`Sparar bild ${i}/${tot}…`, 60000));
          toast(n + ' bilder tillagda');
          urls.forEach(URL.revokeObjectURL);
          close(); Slideshow.restart(); managePhotos();
        };
        m.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-rm]');
          if (b) { await Photos.remove(b.dataset.rm); b.parentElement.remove(); Slideshow.restart(); }
          if (e.target.closest('[data-clear]') && confirm('Ta bort alla bilder från enheten?')) { await Photos.clear(); close(); Slideshow.restart(); }
        });
      },
    });
    return close;
  }

  // ---------- Bildspel ----------
  const Slideshow = {
    el: null, list: [], i: 0, timer: null, urls: [],
    async mount(el) { this.el = el; await this.restart(); },
    async restart() {
      clearInterval(this.timer);
      if (!this.el || !document.contains(this.el)) this.el = $('#photo');
      if (!this.el) return;
      this.list = (await Photos.all().catch(() => [])).sort(() => Math.random() - 0.5);
      this.urls.forEach(URL.revokeObjectURL); this.urls = [];
      if (!this.list.length) {
        this.el.innerHTML = `<label class="ph-empty"><span>🖼️</span>Lägg till bilder för bildspelet<input type="file" accept="image/*" multiple hidden></label>`;
        this.el.querySelector('input').onchange = async (e) => { toast('Sparar bilder…', 60000); const n = await Photos.add(Array.from(e.target.files), (i, t) => toast(`Sparar bild ${i}/${t}…`, 60000)); toast(n + ' bilder tillagda'); this.restart(); };
        return;
      }
      this.el.innerHTML = '<div class="slide a"></div><div class="slide b"></div>';
      this.i = 0; this.show();
      this.timer = setInterval(() => this.show(), Math.max(5, device.interval) * 1000);
    },
    show() {
      if (!this.list.length || !this.el) return;
      const p = this.list[this.i % this.list.length];
      this.i++;
      const u = URL.createObjectURL(p.blob);
      const [a, b] = this.el.querySelectorAll('.slide');
      if (!a) return;
      const next = a.classList.contains('on') ? b : a, cur = next === a ? b : a;
      next.style.backgroundImage = `url(${u})`;
      next.classList.add('on'); cur.classList.remove('on');
      this.urls.push(u);
      if (this.urls.length > 3) URL.revokeObjectURL(this.urls.shift());
      const fs = $('.fullphoto .img');
      if (fs) fs.style.backgroundImage = `url(${u})`;
    },
    fullscreen() {
      if (!this.list.length) return;
      const d = document.createElement('div');
      d.className = 'fullphoto';
      const cur = this.el.querySelector('.slide.on');
      d.innerHTML = `<div class="img" style="background-image:${cur ? cur.style.backgroundImage : ''}"></div><div class="fp-clock"></div>`;
      d.querySelector('.fp-clock').textContent = fTime.format(new Date());
      d.onclick = () => d.remove();
      document.body.appendChild(d);
    },
  };

  // ---------- Nattläge ----------
  const Night = {
    wokeUntil: 0,
    inNight() {
      if (!device.nightOn) return false;
      const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
      const [sh, sm] = device.nightStart.split(':').map(Number), [eh, em] = device.nightEnd.split(':').map(Number);
      const s = sh * 60 + sm, e = eh * 60 + em;
      return s <= e ? m >= s && m < e : m >= s || m < e;
    },
    check() {
      const el = $('#night');
      const on = this.inNight() && Date.now() > this.wokeUntil;
      el.hidden = !on;
      el.style.background = `rgba(0,0,0,${device.nightLevel})`;
      if (on) {
        el.querySelector('.night-clock').textContent = fTime.format(new Date());
        el.querySelector('.night-date').textContent = cap(fLongDate.format(new Date()));
      }
    },
    init() {
      $('#night').addEventListener('click', () => { this.wokeUntil = Date.now() + 3 * 6e4; this.check(); });
      setInterval(() => this.check(), 20000);
      this.check();
    },
  };

  // ---------- Håll skärmen vaken ----------
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch { /* stöds inte */ }
  }

  // ---------- Svep ----------
  function setupSwipe() {
    const el = $('#cal');
    let x0 = null, y0 = null;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 50) navigate(dx < 0 ? 1 : -1);
      x0 = null;
    }, { passive: true });
  }

  // ---------- Klick ----------
  document.addEventListener('click', (e) => {
    keepAwake();
    if (e.target.closest('.modal-wrap')) return;
    if (e.target.closest('#photo .slide')) return Slideshow.fullscreen();
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'nav') navigate(+b.dataset.dir);
    else if (a === 'view') { S.view = b.dataset.v; device.view = S.view; saveDevice(); renderCalendar(); loadEvents(); }
    else if (a === 'new-event') editEvent(null, S.view === 'day' ? S.anchor : today());
    else if (a === 'settings') openSettings();
    else if (a === 'event') showEvent(b.dataset.id);
    else if (a === 'day-bg') { if (CAN_WRITE) editEvent(null, b.dataset.date); }
    else if (a === 'goto-day') { S.view = 'day'; S.anchor = b.dataset.date; renderCalendar(); loadEvents(); }
    else if (a === 'task-tap') { const t = S.tasks.find((x) => x.id === b.dataset.id); if (t) completeTask(t, b.dataset.date); }
    else if (a === 'quick') { const t = S.tasks.find((x) => x.id === b.dataset.id); if (t) quickLog(t); }
    else if (a === 'quick-other') otherQuick();
    else if (a === 'undo') {
      const c = S.completions.find((x) => x.id === b.dataset.id);
      if (c && confirm(`Ångra "${c.title}"?`)) { S.completions = S.completions.filter((x) => x !== c); renderAll(); safe(() => D.deleteCompletion(c.id)); }
    }
    else if (a === 'manage-tasks') manageTasks();
    else if (a === 'stats-period') { S.statsPeriod = b.dataset.p; renderStats(); }
    else if (a === 'stats-detail') statsDetail();
    else if (a === 'tab') { S.tab = b.dataset.t; $('.shell').dataset.tab = S.tab; renderHeader(); }
  });

  // ---------- Inloggning ----------
  function renderLogin(err) {
    $('#app').innerHTML = `<div class="login"><form class="card">
      <div class="logo">📅</div><h1>Familjen</h1>
      <label>E-post<input type="email" id="l-email" autocomplete="username" required></label>
      <label>Lösenord<input type="password" id="l-pass" autocomplete="current-password" required></label>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}
      <button class="btn primary" type="submit">Logga in</button>
    </form></div>`;
    $('.login form').onsubmit = async (e) => {
      e.preventDefault();
      try { await D.login($('#l-email').value.trim(), $('#l-pass').value); start(); }
      catch (er) { renderLogin(er.message === 'Invalid login credentials' ? 'Fel e-post eller lösenord' : er.message); }
    };
  }

  // ---------- Start ----------
  let started = false;
  async function start() {
    const s = await D.session();
    if (!s) return renderLogin();
    if (started) return;
    started = true;
    renderShell();
    await handleOAuthReturn();
    await loadData();
    loadEvents(true);
    loadWeather();
    Night.init();
    D.subscribe(loadData);
    let lastDay = today();
    setInterval(() => {
      renderHeader();
      if (today() !== lastDay) { lastDay = today(); S.anchor = today(); renderAll(); loadEvents(true); }
      // Ladda om sidan en gång per natt (håller iPaden fräsch och hämtar nya versioner)
      const n = new Date();
      if (n.getHours() === 3 && n.getMinutes() === 30 && performance.now() > 36e5) location.reload();
    }, 15000);
    setInterval(() => loadEvents(true), 5 * 6e4);
    setInterval(loadData, 10 * 6e4);
    setInterval(loadWeather, 30 * 6e4);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { wakeLock = null; keepAwake(); loadData(); loadEvents(true); }
    });
    let lastPhone = isPhone();
    window.addEventListener('resize', () => {
      if (isPhone() !== lastPhone) { lastPhone = isPhone(); renderShell(); renderAll(); }
    });
  }
  D.onAuth((s) => { if (!s && started) location.reload(); });
  start();
})();
