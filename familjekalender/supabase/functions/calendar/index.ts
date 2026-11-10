// @ts-nocheck
// Supabase Edge Function "calendar": hämtar iCloud-kalendrar (ICS-länkar) åt appen.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TZ = 'Europe/Stockholm';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ===== ICS-START (ren JavaScript, testas separat) =====
function icsUnfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
function icsUnescape(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
function icsParseLine(line) {
  // NAMN;PARAM=V;PARAM2="x:y":VÄRDE
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.split(';');
  const params = {};
  for (const p of parts.slice(1)) {
    const k = p.indexOf('=');
    if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}
function tzOffsetMs(utcMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - utcMs;
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
function wallToUtc(w, tz) {
  // w = {y,m,d,h,mi,s} väggklocka i tidszonen tz
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  let t = guess - tzOffsetMs(guess, tz);
  const o2 = tzOffsetMs(t, tz);
  t = guess - o2;
  return t;
}
function icsParseDate(prop, defaultTz) {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const w = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  if (prop.params.VALUE === 'DATE' || !m[4]) return { allDay: true, w, tz: null };
  if (m[7]) return { allDay: false, w, tz: 'UTC' };
  let tz = prop.params.TZID || defaultTz;
  if (!validTz(tz)) tz = defaultTz;
  return { allDay: false, w, tz };
}
function dKey(w) {
  return w.y + '-' + String(w.m).padStart(2, '0') + '-' + String(w.d).padStart(2, '0');
}
function dayNum(w) { return Math.floor(Date.UTC(w.y, w.m - 1, w.d) / 864e5); }
function fromDayNum(n) {
  const d = new Date(n * 864e5);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
const WD = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
function isoWd(n) { const w = new Date(n * 864e5).getUTCDay(); return w === 0 ? 7 : w; }
function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function rruleMatches(rule, s, dn) {
  const c = fromDayNum(dn);
  const sd = dayNum(s);
  const interval = rule.INTERVAL ? +rule.INTERVAL : 1;
  const byday = rule.BYDAY ? rule.BYDAY.split(',').map((x) => {
    const mm = x.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/);
    return mm ? { n: mm[1] ? +mm[1] : 0, wd: WD[mm[2]] } : null;
  }).filter(Boolean) : null;
  const bymonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null;
  const bymd = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const wd = isoWd(dn);
  if (bymonth && !bymonth.includes(c.m)) return false;
  const mdOk = (list) => list.some((x) => (x > 0 ? x === c.d : dim(c.y, c.m) + x + 1 === c.d));
  const nthOk = (b) => {
    if (b.wd !== wd) return false;
    if (!b.n) return true;
    if (b.n > 0) return Math.ceil(c.d / 7) === b.n;
    return Math.ceil((dim(c.y, c.m) - c.d + 1) / 7) === -b.n;
  };
  switch (rule.FREQ) {
    case 'DAILY':
      if ((dn - sd) % interval) return false;
      if (byday && !byday.some((b) => b.wd === wd)) return false;
      if (bymd && !mdOk(bymd)) return false;
      return true;
    case 'WEEKLY': {
      const mon = (n) => n - (isoWd(n) - 1);
      const weeks = Math.round((mon(dn) - mon(sd)) / 7);
      if (weeks % interval) return false;
      const days = byday ? byday.map((b) => b.wd) : [isoWd(sd)];
      return days.includes(wd);
    }
    case 'MONTHLY': {
      const months = (c.y - s.y) * 12 + (c.m - s.m);
      if (months % interval) return false;
      if (bymd) return mdOk(bymd);
      if (byday) return byday.some(nthOk);
      return c.d === s.d;
    }
    case 'YEARLY': {
      if ((c.y - s.y) % interval) return false;
      if (!bymonth && c.m !== s.m) return false;
      if (bymd) return mdOk(bymd);
      if (byday) return byday.some(nthOk);
      return c.d === s.d || (s.m === 2 && s.d === 29 && c.m === 2 && c.d === 28 && dim(c.y, 2) === 28);
    }
  }
  return false;
}

// Returnerar händelser som överlappar [rangeStartMs, rangeEndMs)
function icsExpand(text, rangeStartMs, rangeEndMs, defaultTz) {
  const lines = icsUnfold(text);
  const events = [];
  let cur = null, depth = 0;
  for (const line of lines) {
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { props: {}, exdates: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }
    if (line.startsWith('END:') && depth > 0) { depth--; continue; }
    if (line === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (depth > 0) continue; // t.ex. VALARM
    const p = icsParseLine(line);
    if (p.name === 'EXDATE') {
      for (const v of p.value.split(',')) cur.exdates.push({ name: 'EXDATE', params: p.params, value: v });
    } else if (!cur.props[p.name]) cur.props[p.name] = p;
  }

  const overrides = {};
  const masters = [];
  for (const e of events) {
    if (!e.props.DTSTART) continue;
    if ((e.props.STATUS?.value || '').toUpperCase() === 'CANCELLED' && !e.props['RECURRENCE-ID']) continue;
    if (e.props['RECURRENCE-ID']) {
      const rid = icsParseDate(e.props['RECURRENCE-ID'], defaultTz);
      const key = (e.props.UID?.value || '') + '|' + (rid.allDay ? dKey(rid.w) : wallToUtc(rid.w, rid.tz));
      overrides[key] = e;
    } else masters.push(e);
  }

  const out = [];
  const toOut = (e, startDt, endDt, idSuffix) => {
    const P = e.props;
    let start, end, sMs, eMs;
    if (startDt.allDay) {
      start = dKey(startDt.w);
      end = dKey(endDt.w);
      sMs = wallToUtc({ ...startDt.w, h: 0, mi: 0, s: 0 }, defaultTz);
      eMs = wallToUtc({ ...endDt.w, h: 0, mi: 0, s: 0 }, defaultTz);
    } else {
      sMs = wallToUtc(startDt.w, startDt.tz);
      eMs = wallToUtc(endDt.w, endDt.tz);
      start = new Date(sMs).toISOString();
      end = new Date(eMs).toISOString();
    }
    if (eMs <= rangeStartMs || sMs >= rangeEndMs) return;
    if ((P.STATUS?.value || '').toUpperCase() === 'CANCELLED') return;
    out.push({
      id: (P.UID?.value || Math.random().toString(36)) + idSuffix,
      title: icsUnescape(P.SUMMARY?.value || '(utan titel)'),
      allDay: startDt.allDay, start, end,
      location: icsUnescape(P.LOCATION?.value || ''),
      description: icsUnescape(P.DESCRIPTION?.value || ''),
    });
  };

  for (const e of masters) {
    const P = e.props;
    const s = icsParseDate(P.DTSTART, defaultTz);
    if (!s) continue;
    let durMs = 0, durDays = 1;
    if (P.DTEND) {
      const en = icsParseDate(P.DTEND, defaultTz);
      if (s.allDay) durDays = Math.max(1, dayNum(en.w) - dayNum(s.w));
      else durMs = wallToUtc(en.w, en.tz) - wallToUtc(s.w, s.tz);
    } else if (P.DURATION) {
      const m = P.DURATION.value.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
      if (m) {
        const days = (+(m[1] || 0)) * 7 + +(m[2] || 0);
        if (s.allDay) durDays = Math.max(1, days);
        else durMs = ((days * 24 + +(m[3] || 0)) * 3600 + +(m[4] || 0) * 60 + +(m[5] || 0)) * 1000;
      }
    }
    const endFor = (st) => {
      if (st.allDay) return { allDay: true, w: fromDayNum(dayNum(st.w) + durDays), tz: null };
      const eMs = wallToUtc(st.w, st.tz) + durMs;
      return { allDay: false, w: utcToWall(eMs, st.tz), tz: st.tz };
    };
    const uid = P.UID?.value || '';

    if (!P.RRULE) {
      toOut(e, s, endFor(s), '');
      continue;
    }
    const rule = {};
    for (const kv of P.RRULE.value.split(';')) { const [k, v] = kv.split('='); rule[k.toUpperCase()] = v; }
    const exset = new Set(e.exdates.map((x) => {
      const d = icsParseDate(x, s.tz || defaultTz);
      if (!d) return '';
      return s.allDay || d.allDay ? dKey(d.w) : String(wallToUtc(d.w, d.tz));
    }));
    let untilMs = Infinity;
    if (rule.UNTIL) {
      const u = icsParseDate({ value: rule.UNTIL, params: {} }, s.tz || defaultTz);
      untilMs = u.allDay ? wallToUtc({ ...u.w, h: 23, mi: 59, s: 59 }, s.tz || defaultTz) : wallToUtc(u.w, u.tz);
    }
    const count = rule.COUNT ? +rule.COUNT : Infinity;
    const sd = dayNum(s.w);
    const lastDay = Math.floor(rangeEndMs / 864e5) + 1;
    let n = 0;
    for (let dn = sd; dn <= lastDay && n < count; dn++) {
      if (!rruleMatches(rule, s.w, dn)) continue;
      const w = { ...fromDayNum(dn), h: s.w.h, mi: s.w.mi, s: s.w.s };
      const st = { allDay: s.allDay, w, tz: s.tz };
      const occMs = s.allDay ? wallToUtc({ ...w, h: 0, mi: 0, s: 0 }, defaultTz) : wallToUtc(w, s.tz);
      if (occMs > untilMs) break;
      n++;
      const key = s.allDay ? dKey(w) : String(occMs);
      if (exset.has(key)) continue;
      const ov = overrides[uid + '|' + key];
      if (ov) {
        const os = icsParseDate(ov.props.DTSTART, defaultTz);
        let oe;
        if (ov.props.DTEND) oe = icsParseDate(ov.props.DTEND, defaultTz);
        else oe = endFor(os);
        toOut({ props: { ...P, ...ov.props } }, os, oe, '_' + key);
      } else {
        toOut(e, st, endFor(st), '_' + key);
      }
    }
  }
  return out;
}
function utcToWall(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
// ===== ICS-SLUT =====

async function icsEvents(feeds, minMs, maxMs) {
  const results = await Promise.all((feeds || []).map(async (f, i) => {
    try {
      const url = String(f.url).trim().replace(/^webcal:\/\//i, 'https://');
      if (!/^https:\/\//i.test(url)) throw new Error('Ogiltig länk');
      const r = await fetch(url, { headers: { 'User-Agent': 'Familjekalender/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      return icsExpand(text, minMs, maxMs, TZ).map((e) => ({
        ...e,
        id: 'ics' + i + '_' + e.id,
        calendarId: 'ics:' + i,
        calendarName: f.name || 'iCloud',
        color: f.color || '#8e8e93',
        readOnly: true,
        source: 'ics',
      }));
    } catch (err) {
      return [{ error: true, calendarName: f.name, message: String(err.message || err) }];
    }
  }));
  return results.flat();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // Kör som den inloggade användaren: databasens regler (RLS) avgör vad som får läsas.
    const auth = req.headers.get('Authorization') || '';
    const key = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const admin = createClient(Deno.env.get('SUPABASE_URL'), key, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: ue } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (ue || !u || !u.user) return json({ error: 'Inte inloggad' }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'status') return json({ connected: false, email: null, clientIdSet: false });
    if (body.action === 'events') {
      const minMs = Date.parse(body.timeMin), maxMs = Date.parse(body.timeMax);
      const { data } = await admin.from('app_settings').select('value').eq('key', 'ics_feeds').maybeSingle();
      const all = await icsEvents((data && data.value) || [], minMs, maxMs);
      return json({ events: all.filter((e) => !e.error), errors: all.filter((e) => e.error) });
    }
    return json({ error: 'Stöds inte (endast iCloud-visning)' }, 400);
  } catch (err) {
    return json({ error: String(err.message || err) }, 500);
  }
});
