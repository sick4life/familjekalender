// Datalager: Supabase.
(function () {
  const C = window.APP_CONFIG || {};

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

  window.Data = supabaseBackend();
})();
