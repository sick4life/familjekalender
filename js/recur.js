// Datum- och upprepningslogik för sysslor. Fungerar både i webbläsaren och i Node (för tester).
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');

  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseYmd(s) {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  function daysBetween(a, b) {
    return Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
  }
  // 1 = måndag ... 7 = söndag
  function isoWeekday(s) {
    const w = parseYmd(s).getDay();
    return w === 0 ? 7 : w;
  }
  function mondayOf(s) {
    return addDays(s, 1 - isoWeekday(s));
  }
  function isoWeek(s) {
    const d = parseYmd(s);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 864e5 + 1) / 7);
  }
  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  // Inträffar sysslan detta datum?
  function occursOn(task, date) {
    if (!task || task.active === false) return false;
    const start = (task.start_date || '2000-01-01').slice(0, 10);
    if (date < start) return false;
    if (task.end_date && date > task.end_date.slice(0, 10)) return false;
    const every = Math.max(1, Number(task.every) || 1);
    switch (task.recur) {
      case 'once':
        return date === start;
      case 'daily':
        return daysBetween(start, date) % every === 0;
      case 'interval':
        return daysBetween(start, date) % every === 0;
      case 'weekly': {
        const days = task.weekdays && task.weekdays.length ? task.weekdays : [isoWeekday(start)];
        if (!days.includes(isoWeekday(date))) return false;
        const weeks = Math.round(daysBetween(mondayOf(start), mondayOf(date)) / 7);
        return weeks % every === 0;
      }
      case 'monthly': {
        const d = parseYmd(date);
        const want = Number(task.monthday) || parseYmd(start).getDate();
        const dim = daysInMonth(d.getFullYear(), d.getMonth() + 1);
        const months = (d.getFullYear() - parseYmd(start).getFullYear()) * 12 + d.getMonth() - parseYmd(start).getMonth();
        if (months % every !== 0) return false;
        return d.getDate() === Math.min(want, dim);
      }
      default:
        return false; // 'quick' = snabbknapp utan schema
    }
  }

  function describe(task) {
    const names = ['', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];
    const every = Math.max(1, Number(task.every) || 1);
    switch (task.recur) {
      case 'once': return 'En gång ' + task.start_date;
      case 'daily': return 'Varje dag';
      case 'interval': return 'Var ' + every + ':e dag';
      case 'weekly': {
        const w = (task.weekdays || []).slice().sort();
        let txt;
        if (w.join() === '6,7') txt = 'Varje helg';
        else if (w.join() === '1,2,3,4,5') txt = 'Vardagar';
        else if (w.length === 7) txt = 'Varje dag';
        else txt = 'Varje ' + w.map((x) => names[x]).join(', ');
        if (every === 2) txt += ' (varannan vecka)';
        else if (every > 2) txt += ' (var ' + every + ':e vecka)';
        return txt;
      }
      case 'monthly': return 'Den ' + (task.monthday || '?') + ':e varje månad';
      case 'quick': return 'Snabbknapp';
      default: return '';
    }
  }

  const api = { pad, ymd, parseYmd, addDays, daysBetween, isoWeekday, mondayOf, isoWeek, daysInMonth, occursOn, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recur = api;
})(typeof window !== 'undefined' ? window : globalThis);
