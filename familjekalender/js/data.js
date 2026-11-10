// Datalager: Supabase (riktigt läge) eller lokal demo (om config saknas).
(function () {
  const C = window.APP_CONFIG || {};
  const R = window.Recur;
  const DEMO = !C.SUPABASE_URL || !C.SUPABASE_KEY;

  // ---------------- Supabase ----------------
  function supabaseBackend() {
    const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'familjekalender-auth' },
    });
    const must = ({ data, error }) => {
      if (error) throw new Error(error.message);
      return data;
    };
    async function fn(body) {
      const { data, error } = await sb.functions.invoke('calendar', { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.error || msg; } catch { /* */ }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    }
    return {
      demo: false,
      async session() { return (await sb.auth.getSession()).data.session; },
      async login(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
      async logout() { await sb.auth.signOut(); },
      onAuth(cb) { sb.auth.onAuthStateChange((_e, s) => cb(s)); },
      async load() {
        const since = new Date(Date.now() - 400 * 864e5).toISOString();
        const [people, tasks, completions, settings] = await Promise.all([
          sb.from('people').select('*').order('sort').then(must),
          sb.from('tasks').select('*').order('sort').then(must),
          sb.from('completions').select('*').gte('done_at', since).order('done_at', { ascending: false }).then(must),
          sb.from('app_settings').select('*').then(must),
        ]);
        const s = {};
        for (const r of settings) s[r.key] = r.value;
        return { people, tasks, completions, settings: s };
      },
      async saveTask(t) {
        const row = { ...t };
        if (!row.id) delete row.id;
        delete row.created_at;
        return must(await sb.from('tasks').upsert(row).select().single());
      },
      async deleteTask(id) { must(await sb.from('tasks').delete().eq('id', id)); },
      async addCompletion(c) { return must(await sb.from('completions').insert(c).select().single()); },
      async deleteCompletion(id) { must(await sb.from('completions').delete().eq('id', id)); },
      async savePerson(p) {
        const row = { ...p };
        if (!row.id) delete row.id;
        return must(await sb.from('people').upsert(row).select().single());
      },
      async deletePerson(id) { must(await sb.from('people').delete().eq('id', id)); },
      async saveSetting(key, value) { must(await sb.from('app_settings').upsert({ key, value })); },
      subscribe(cb) {
        let t = null;
        const fire = () => { clearTimeout(t); t = setTimeout(cb, 300); };
        sb.channel('family')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fire)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, fire)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, fire)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, fire)
          .subscribe();
      },
      cal: {
        status: () => fn({ action: 'status' }),
        calendars: () => fn({ action: 'calendars' }).then((d) => d.calendars),
        events: (timeMin, timeMax) => fn({ action: 'events', timeMin, timeMax }),
        create: (calendarId, event) => fn({ action: 'create', calendarId, event }),
        update: (calendarId, eventId, event) => fn({ action: 'update', calendarId, eventId, event }),
        remove: (calendarId, eventId) => fn({ action: 'delete', calendarId, eventId }),
        exchange: (code, redirect_uri) => fn({ action: 'exchange', code, redirect_uri }),
        disconnect: () => fn({ action: 'disconnect' }),
      },
    };
  }

  // ---------------- Demo (lokal) ----------------
  function demoBackend() {
    const KEY = 'familjekalender-demo';
    const uid = () => Math.random().toString(36).slice(2, 10);
    const today = R.ymd(new Date());
    let st;
    try { st = JSON.parse(localStorage.getItem(KEY)); } catch { st = null; }
    if (!st) {
      const p1 = { id: 'p1', name: 'Peter', color: '#4f7cff', sort: 1 };
      const p2 = { id: 'p2', name: 'Hanna', color: '#f0568c', sort: 2 };
      const t = (title, emoji, recur, weekdays, extra = {}) => ({
        id: uid(), title, emoji, recur, weekdays, every: 1, start_date: R.addDays(today, -60), active: true, assignee: null, ...extra,
      });
      const tasks = [
        t('Tvätta', '🧺', 'weekly', [1]),
        t('Städa', '🧹', 'weekly', [6], { assignee: 'p2' }),
        t('Ta ut soporna', '🗑️', 'weekly', [3, 7], { assignee: 'p1' }),
        t('Vattna blommorna', '🪴', 'interval', [], { every: 3 }),
        t('Byta lakan', '🛏️', 'weekly', [7], { every: 2 }),
        t('Diska', '🍽️', 'quick', []),
        t('Töm diskmaskinen', '🫧', 'quick', []),
        t('Laga mat', '🍳', 'quick', []),
        t('Dammsuga', '🧽', 'quick', []),
        t('Handla', '🛒', 'quick', []),
      ];
      const completions = [];
      for (let i = 1; i < 25; i++) {
        const d = R.addDays(today, -i);
        const q = tasks[5 + (i % 5)];
        completions.push({ id: uid(), task_id: q.id, title: q.title, emoji: q.emoji, person_id: i % 3 ? 'p1' : 'p2', for_date: d, done_at: new Date(R.parseYmd(d).getTime() + 18 * 36e5).toISOString() });
        if (i % 2) completions.push({ id: uid(), task_id: tasks[6].id, title: tasks[6].title, emoji: tasks[6].emoji, person_id: 'p2', for_date: d, done_at: new Date(R.parseYmd(d).getTime() + 8 * 36e5).toISOString() });
      }
      completions.push({ id: uid(), task_id: tasks[2].id, title: tasks[2].title, emoji: tasks[2].emoji, person_id: 'p1', for_date: R.addDays(R.mondayOf(today), 2), done_at: new Date().toISOString() });
      st = { people: [p1, p2], tasks, completions, settings: {}, events: demoEvents() };
    }
    const save = () => localStorage.setItem(KEY, JSON.stringify(st));
    save();
    function demoEvents() {
      const mon = R.mondayOf(today);
      const at = (dayOff, h, m, durMin, title, color, extra = {}) => {
        const d = R.parseYmd(R.addDays(mon, dayOff));
        d.setHours(h, m, 0, 0);
        return { id: uid(), calendarId: 'demo', calendarName: 'Familj', title, allDay: false, start: d.toISOString(), end: new Date(d.getTime() + durMin * 6e4).toISOString(), location: '', description: '', color, readOnly: false, source: 'demo', ...extra };
      };
      const ad = (dayOff, len, title, color) => ({ id: uid(), calendarId: 'demo', calendarName: 'Familj', title, allDay: true, start: R.addDays(mon, dayOff), end: R.addDays(mon, dayOff + len), location: '', description: '', color, readOnly: false, source: 'demo' });
      return [
        at(0, 8, 0, 60, 'Jobbmöte', '#4f7cff'),
        at(0, 18, 30, 90, 'Padel', '#4f7cff', { location: 'PDL Center' }),
        at(1, 17, 0, 60, 'Tandläkare', '#f0568c', { location: 'Folktandvården' }),
        at(2, 12, 0, 60, 'Lunch med Sara', '#f0568c'),
        at(3, 19, 0, 120, 'Middag hos mamma', '#33b679'),
        at(4, 16, 0, 30, 'Hämta paket', '#4f7cff'),
        at(4, 20, 0, 180, 'Fredagsmys 🍿', '#33b679'),
        at(5, 10, 0, 120, 'Bröllop – DJ-gig', '#8e24aa', { location: 'Göteborg' }),
        at(6, 11, 0, 90, 'Brunch', '#33b679'),
        at(9, 9, 0, 60, 'Bilservice', '#4f7cff'),
        at(16, 15, 0, 60, 'Frisör', '#f0568c'),
        ad(2, 1, 'Mammas födelsedag 🎂', '#f6bf26'),
        ad(5, 2, 'Weekend i Göteborg', '#8e24aa'),
        ad(12, 1, 'Lön 💰', '#0b8043'),
      ];
    }
    const subs = [];
    const changed = () => { save(); subs.forEach((f) => f()); };
    return {
      demo: true,
      async session() { return { user: { email: 'demo' } }; },
      async login() {}, async logout() { localStorage.removeItem(KEY); location.reload(); },
      onAuth() {},
      async load() { return JSON.parse(JSON.stringify({ people: st.people, tasks: st.tasks, completions: st.completions, settings: st.settings })); },
      async saveTask(t) {
        if (!t.id) t = { ...t, id: uid() };
        const i = st.tasks.findIndex((x) => x.id === t.id);
        if (i >= 0) st.tasks[i] = { ...st.tasks[i], ...t }; else st.tasks.push(t);
        changed(); return t;
      },
      async deleteTask(id) { st.tasks = st.tasks.filter((x) => x.id !== id); changed(); },
      async addCompletion(c) { c = { id: uid(), done_at: new Date().toISOString(), ...c }; st.completions.unshift(c); changed(); return c; },
      async deleteCompletion(id) { st.completions = st.completions.filter((x) => x.id !== id); changed(); },
      async savePerson(p) {
        if (!p.id) p = { ...p, id: uid() };
        const i = st.people.findIndex((x) => x.id === p.id);
        if (i >= 0) st.people[i] = { ...st.people[i], ...p }; else st.people.push(p);
        changed(); return p;
      },
      async deletePerson(id) { st.people = st.people.filter((x) => x.id !== id); changed(); },
      async saveSetting(k, v) { st.settings[k] = v; changed(); },
      subscribe(cb) { subs.push(cb); },
      cal: {
        status: async () => ({ connected: true, email: 'demo@exempel.se', clientIdSet: true }),
        calendars: async () => [{ id: 'demo', name: 'Familj', color: '#4f7cff', primary: true, selected: true, writable: true }],
        events: async () => ({ events: st.events, errors: [] }),
        create: async (calendarId, ev) => { st.events.push({ ...ev, id: uid(), calendarId, calendarName: 'Familj', color: '#4f7cff', readOnly: false, source: 'demo', start: ev.allDay ? ev.start : new Date(ev.start).toISOString(), end: ev.allDay ? ev.end : new Date(ev.end).toISOString() }); save(); return { ok: true }; },
        update: async (calendarId, id, ev) => { const e = st.events.find((x) => x.id === id); Object.assign(e, ev, { start: ev.allDay ? ev.start : new Date(ev.start).toISOString(), end: ev.allDay ? ev.end : new Date(ev.end).toISOString() }); save(); return { ok: true }; },
        remove: async (calendarId, id) => { st.events = st.events.filter((x) => x.id !== id); save(); return { ok: true }; },
        exchange: async () => ({ ok: true }),
        disconnect: async () => ({ ok: true }),
      },
    };
  }

  window.Data = DEMO ? demoBackend() : supabaseBackend();
})();
