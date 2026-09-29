// Server HTTP: file statici + API JSON con autenticazione e permessi per ruolo.
'use strict';
const path = require('path');
const express = require('express');
const D = require('./db');

const PORT = +process.env.PORT || 8765;
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'sid';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const EVENT_TYPES = ['segnalazione', 'contatto', 'incontro', 'offerta', 'contratto', 'consegna', 'pagamento', 'persa'];
const MATURA = ['contratto', 'pagamento', 'consegna'];
const TIPOLOGIE = { segnalatore: 'tipologieSegnalatore', opportunita: 'tipologieOpportunita' };

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);
app.use(express.json({ limit: '256kb' }));

/* ===================== ERRORI / VALIDAZIONE ===================== */
class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const bad = (msg, extra) => new HttpError(400, msg, extra);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const req_ = (v, label) => { const s = str(v); if (!s) throw bad(`Campo obbligatorio: ${label}`); return s; };
const date = (v, label) => { const s = str(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw bad(`Data non valida: ${label}`); return s; };
const num = (v, label) => { if (v === '' || v == null) return 0; const n = +v; if (!isFinite(n) || n < 0) throw bad(`Valore non valido: ${label}`); return n; };
const email = v => { const s = str(v, 200).toLowerCase(); if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Email non valida'); return s; };
const oneOf = (v, list, label) => { const s = str(v); if (!list.includes(s)) throw bad(`Valore non ammesso: ${label}`); return s; };
const exists = (table, id, label) => { const s = str(id); if (!s || !D.get(`SELECT 1 FROM ${table} WHERE id=?`, s)) throw bad(`${label} non trovato`); return s; };
const optExists = (table, id, label) => str(id) ? exists(table, id, label) : '';
const password = v => { const s = String(v ?? ''); if (s.length < 8) throw bad('La password deve avere almeno 8 caratteri'); if (s.length > 200) throw bad('Password troppo lunga'); return s; };

/* ===================== AUTENTICAZIONE ===================== */
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setSessionCookie(req, res, sid, clear) {
  const secure = COOKIE_SECURE || req.secure;
  const parts = [`${COOKIE}=${clear ? '' : sid}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${(+process.env.SESSION_DAYS || 30) * 86400}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}
function publicUser(u) {
  const out = { id: u.id, email: u.email, nome: u.nome, ruolo: u.ruolo, segnalatoreId: u.segnalatoreId || null };
  if (u.ruolo === 'segnalatore') out.nome = D.get('SELECT nome FROM segnalatori WHERE id=?', u.segnalatoreId)?.nome || u.nome;
  return out;
}
app.use('/api', (req, res, next) => {
  // Protezione CSRF: le richieste che modificano dati devono essere JSON e same-origin.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return next(new HttpError(403, 'Richiesta non consentita'));
    if (!req.is('application/json') && req.method !== 'DELETE') return next(new HttpError(415, 'Content-Type application/json richiesto'));
  }
  res.setHeader('Cache-Control', 'no-store');
  req.user = D.userBySession(cookies(req)[COOKIE]);
  req.sid = cookies(req)[COOKIE];
  next();
});
const auth = (req, res, next) => req.user ? next() : next(new HttpError(401, 'Accesso richiesto'));
const admin = (req, res, next) => req.user?.ruolo === 'admin' ? next() : next(new HttpError(403, 'Operazione riservata al back office'));
const isSeg = req => req.user.ruolo === 'segnalatore';
// Il segnalatore opera solo per sé: un segnalatoreId diverso dal proprio viene rifiutato.
const proprioSegnalatore = (req, b) => {
  const id = req.user.segnalatoreId;
  if (str(b.segnalatoreId) && str(b.segnalatoreId) !== id) throw new HttpError(403, 'Puoi inserire dati solo a tuo nome');
  return id;
};
const wrap = fn => (req, res, next) => { try { const r = fn(req, res); if (r && r.then) r.catch(next); } catch (e) { next(e); } };

// Limite tentativi di accesso per IP (10 ogni 15 minuti).
const attempts = new Map();
function checkRate(ip) {
  const nowMs = Date.now(); const a = attempts.get(ip) || { n: 0, t: nowMs };
  if (nowMs - a.t > 15 * 60e3) { a.n = 0; a.t = nowMs; }
  if (a.n >= 10) throw new HttpError(429, 'Troppi tentativi, riprova tra qualche minuto');
  a.n++; attempts.set(ip, a);
}
setInterval(() => { const t = Date.now(); for (const [k, v] of attempts) if (t - v.t > 15 * 60e3) attempts.delete(k); D.purgeSessions(); }, 10 * 60e3).unref();

const needsSetup = () => !D.get('SELECT 1 FROM users WHERE ruolo=\'admin\' LIMIT 1');

// Health check leggero (Render, UptimeRobot): non tocca la sessione, risponde sempre 200 se il db è raggiungibile.
app.get('/healthz', (req, res) => { try { D.get('SELECT 1'); res.type('text').send('ok'); } catch { res.status(500).type('text').send('db error'); } });

app.get('/api/me', wrap((req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null, needsSetup: needsSetup() });
}));

app.post('/api/setup', wrap((req, res) => {
  if (!needsSetup()) throw new HttpError(403, 'Configurazione iniziale già eseguita');
  const b = req.body || {};
  const em = email(b.email); if (!em) throw bad('Email obbligatoria');
  const pw = password(b.password);
  D.transaction(() => {
    D.insert('users', { id: D.uid(), email: em, passwordHash: D.hashPassword(pw), ruolo: 'admin', segnalatoreId: null, nome: str(b.nome, 100) || 'Amministratore', attivo: 1, createdAt: D.now() });
  });
  if (b.demo) D.seedDemo(); else D.seedMinimo();
  const u = D.get('SELECT * FROM users WHERE email=?', em);
  setSessionCookie(req, res, D.createSession(u.id));
  res.json({ user: publicUser(u) });
}));

app.post('/api/login', wrap((req, res) => {
  checkRate(req.ip);
  const b = req.body || {};
  const em = str(b.email, 200).toLowerCase(), pw = String(b.password ?? '');
  const u = em ? D.get('SELECT * FROM users WHERE email=?', em) : null;
  const ok = u && D.verifyPassword(pw, u.passwordHash);
  if (!ok || !u.attivo) throw new HttpError(401, 'Email o password non corretti');
  if (u.ruolo === 'segnalatore') {
    const sg = D.get('SELECT attivo FROM segnalatori WHERE id=?', u.segnalatoreId);
    if (!sg?.attivo) throw new HttpError(403, 'Accesso disattivato: contatta l\'azienda');
  }
  attempts.delete(req.ip);
  setSessionCookie(req, res, D.createSession(u.id));
  res.json({ user: publicUser(u) });
}));

app.post('/api/logout', wrap((req, res) => {
  if (req.sid) D.deleteSession(req.sid);
  setSessionCookie(req, res, '', true);
  res.json({ ok: true });
}));

app.post('/api/password', auth, wrap((req, res) => {
  const b = req.body || {};
  if (!D.verifyPassword(String(b.attuale ?? ''), req.user.passwordHash)) throw bad('Password attuale non corretta');
  const pw = password(b.nuova);
  D.update('users', req.user.id, { passwordHash: D.hashPassword(pw) });
  D.run('DELETE FROM sessions WHERE userId=? AND id<>?', req.user.id, req.sid);
  res.json({ ok: true });
}));

/* ===================== STATO (lettura) ===================== */
const bool = (rows, k = 'attivo') => rows.map(r => ({ ...r, [k]: !!r[k] }));
app.get('/api/state', auth, wrap((req, res) => {
  const u = req.user;
  const s = { user: publicUser(u) };
  s.tipologieSegnalatore = D.all('SELECT * FROM tipologieSegnalatore ORDER BY rowid');
  s.tipologieOpportunita = D.all('SELECT * FROM tipologieOpportunita ORDER BY rowid');
  s.regole = D.all('SELECT * FROM regole ORDER BY rowid');
  if (isSeg(req)) {
    const id = u.segnalatoreId;
    s.segnalatori = bool(D.all('SELECT * FROM segnalatori WHERE id=?', id));
    s.clienti = D.all('SELECT * FROM clienti WHERE segnalatoreId=? ORDER BY ragioneSociale', id);
    s.opportunita = D.all('SELECT * FROM opportunita WHERE segnalatoreId=? ORDER BY dataSegnalazione DESC', id);
    s.eventi = D.all('SELECT e.* FROM eventi e JOIN opportunita o ON o.id=e.opportunitaId WHERE o.segnalatoreId=?', id);
    s.liquidazioni = D.all('SELECT l.* FROM liquidazioni l JOIN eventi e ON e.id=l.eventoId JOIN opportunita o ON o.id=e.opportunitaId WHERE o.segnalatoreId=?', id);
  } else {
    s.segnalatori = bool(D.all('SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.segnalatoreId=s.id) AS haAccesso FROM segnalatori s ORDER BY nome'));
    s.segnalatori.forEach(x => x.haAccesso = !!x.haAccesso);
    s.clienti = D.all('SELECT * FROM clienti ORDER BY ragioneSociale');
    s.opportunita = D.all('SELECT * FROM opportunita ORDER BY dataSegnalazione DESC');
    s.eventi = D.all('SELECT * FROM eventi');
    s.liquidazioni = D.all('SELECT * FROM liquidazioni');
  }
  s.liquidazioni = Object.fromEntries(s.liquidazioni.map(l => [l.eventoId, { data: l.data, nota: l.nota }]));
  res.json(s);
}));

/* ===================== SEGNALATORI ===================== */
function segnalatoreBody(b) {
  return {
    nome: req_(b.nome, 'nome'), tipologiaId: exists('tipologieSegnalatore', b.tipologiaId, 'Tipologia'),
    email: email(b.email), telefono: str(b.telefono, 50), piva: str(b.piva, 30), citta: str(b.citta, 100),
    attivo: b.attivo === true || b.attivo === '1' || b.attivo === 1 ? 1 : 0, dataInizio: b.dataInizio ? date(b.dataInizio, 'attivo dal') : '', note: str(b.note, 2000),
  };
}
// Gestione dell'accesso al portale del segnalatore (utente collegato).
function syncAccesso(segId, data, nuovaPassword) {
  const u = D.get('SELECT * FROM users WHERE segnalatoreId=?', segId);
  if (nuovaPassword != null && nuovaPassword !== '') {
    const pw = password(nuovaPassword);
    if (!data.email) throw bad('Per abilitare l\'accesso serve un indirizzo email');
    const other = D.get('SELECT id FROM users WHERE email=? AND segnalatoreId IS NOT ?', data.email, segId);
    if (other) throw new HttpError(409, 'Email già usata da un altro utente');
    if (u) D.update('users', u.id, { email: data.email, passwordHash: D.hashPassword(pw), nome: data.nome, attivo: 1 });
    else D.insert('users', { id: D.uid(), email: data.email, passwordHash: D.hashPassword(pw), ruolo: 'segnalatore', segnalatoreId: segId, nome: data.nome, attivo: 1, createdAt: D.now() });
  } else if (u) {
    if (!data.email) throw bad('Il segnalatore ha un accesso al portale: l\'email è obbligatoria');
    const other = D.get('SELECT id FROM users WHERE email=? AND id<>?', data.email, u.id);
    if (other) throw new HttpError(409, 'Email già usata da un altro utente');
    D.update('users', u.id, { email: data.email, nome: data.nome });
  }
}
app.post('/api/segnalatori', auth, admin, wrap((req, res) => {
  const b = req.body || {}; const data = segnalatoreBody(b); const id = D.uid();
  D.transaction(() => { D.insert('segnalatori', { id, ...data }); syncAccesso(id, data, b.password); });
  res.json({ id });
}));
app.put('/api/segnalatori/:id', auth, admin, wrap((req, res) => {
  const id = exists('segnalatori', req.params.id, 'Segnalatore'); const b = req.body || {}; const data = segnalatoreBody(b);
  D.transaction(() => {
    D.update('segnalatori', id, data);
    if (b.revocaAccesso) D.run('DELETE FROM users WHERE segnalatoreId=?', id);
    else syncAccesso(id, data, b.password);
    if (!data.attivo) D.run('DELETE FROM sessions WHERE userId IN (SELECT id FROM users WHERE segnalatoreId=?)', id);
  });
  res.json({ id });
}));
app.delete('/api/segnalatori/:id', auth, admin, wrap((req, res) => {
  const id = exists('segnalatori', req.params.id, 'Segnalatore');
  if (D.get('SELECT 1 FROM clienti WHERE segnalatoreId=? LIMIT 1', id) || D.get('SELECT 1 FROM opportunita WHERE segnalatoreId=? LIMIT 1', id))
    throw new HttpError(409, 'Il segnalatore ha clienti o segnalazioni: impostalo come non attivo invece di eliminarlo');
  D.transaction(() => { D.run('DELETE FROM users WHERE segnalatoreId=?', id); D.run('DELETE FROM segnalatori WHERE id=?', id); });
  res.json({ ok: true });
}));

/* ===================== CLIENTI ===================== */
const normRS = x => String(x || '').toLowerCase().replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|di|&|e)\b/g, '').replace(/[^a-z0-9]/g, '');
function trovaDuplicati(d, excludeId) {
  const n = normRS(d.ragioneSociale), piva = d.piva.replace(/\s/g, ''), em = d.email.toLowerCase();
  return D.all('SELECT c.*, s.nome AS segnalatoreNome FROM clienti c JOIN segnalatori s ON s.id=c.segnalatoreId').map(c => {
    if (c.id === excludeId) return null;
    let why = null, hard = false;
    if (piva && c.piva && piva === c.piva.replace(/\s/g, '')) { why = 'stessa P.IVA'; hard = true; }
    else if (em && c.email && em === c.email.toLowerCase()) why = 'stessa email';
    else { const nc = normRS(c.ragioneSociale); if (n && nc && (n === nc || (n.length > 5 && (nc.includes(n) || n.includes(nc))))) why = 'ragione sociale simile'; }
    return why ? { ragioneSociale: c.ragioneSociale, why, hard, segnalatore: c.segnalatoreNome, dataInserimento: c.dataInserimento } : null;
  }).filter(Boolean);
}
function clienteBody(req, b, existing) {
  const data = {
    ragioneSociale: req_(b.ragioneSociale, 'ragione sociale'), piva: str(b.piva, 30), email: email(b.email), telefono: str(b.telefono, 50),
    citta: str(b.citta, 100), dataInserimento: b.dataInserimento ? date(b.dataInserimento, 'data inserimento') : D.now().slice(0, 10), note: str(b.note, 2000),
  };
  data.segnalatoreId = isSeg(req) ? proprioSegnalatore(req, b) : exists('segnalatori', b.segnalatoreId, 'Segnalatore');
  if (existing && isSeg(req)) data.segnalatoreId = existing.segnalatoreId;
  return data;
}
app.post('/api/clienti', auth, wrap((req, res) => {
  const b = req.body || {}; const data = clienteBody(req, b);
  const dup = trovaDuplicati(data, null);
  if (dup.length && (dup.some(x => x.hard) || !b.forza)) throw new HttpError(409, 'Cliente forse già presente', { duplicati: dup });
  const id = D.uid(); D.insert('clienti', { id, ...data });
  res.json({ id });
}));
app.put('/api/clienti/:id', auth, wrap((req, res) => {
  const c = D.get('SELECT * FROM clienti WHERE id=?', str(req.params.id));
  if (!c || (isSeg(req) && c.segnalatoreId !== req.user.segnalatoreId)) throw new HttpError(404, 'Cliente non trovato');
  const b = req.body || {}; const data = clienteBody(req, b, c);
  const dup = trovaDuplicati(data, c.id);
  if (dup.length && (dup.some(x => x.hard) || !b.forza)) throw new HttpError(409, 'Cliente forse già presente', { duplicati: dup });
  D.update('clienti', c.id, data);
  res.json({ id: c.id });
}));
app.delete('/api/clienti/:id', auth, admin, wrap((req, res) => {
  const id = exists('clienti', req.params.id, 'Cliente');
  if (D.get('SELECT 1 FROM opportunita WHERE clienteId=? LIMIT 1', id)) throw new HttpError(409, 'Il cliente ha opportunità collegate');
  D.run('DELETE FROM clienti WHERE id=?', id);
  res.json({ ok: true });
}));

/* ===================== OPPORTUNITÀ ED EVENTI ===================== */
function opportunitaBody(req, b) {
  const clienteId = exists('clienti', b.clienteId, 'Cliente');
  const c = D.get('SELECT segnalatoreId FROM clienti WHERE id=?', clienteId);
  const segnalatoreId = isSeg(req) ? proprioSegnalatore(req, b) : exists('segnalatori', b.segnalatoreId, 'Segnalatore');
  if (isSeg(req) && c.segnalatoreId !== segnalatoreId) throw new HttpError(403, 'Il cliente non è nel tuo portafoglio');
  return {
    clienteId, segnalatoreId, tipologiaId: exists('tipologieOpportunita', b.tipologiaId, 'Tipologia'),
    titolo: req_(b.titolo, 'titolo'), luogo: str(b.luogo, 200), descr: str(b.descr, 4000), valoreStimato: num(b.valoreStimato, 'valore stimato'),
    dataSegnalazione: date(b.dataSegnalazione || D.now().slice(0, 10), 'data segnalazione'),
  };
}
app.post('/api/opportunita', auth, wrap((req, res) => {
  const data = opportunitaBody(req, req.body || {}); const id = D.uid();
  D.transaction(() => {
    D.insert('opportunita', { id, ...data });
    D.insert('eventi', { id: D.uid(), opportunitaId: id, tipo: 'segnalazione', data: data.dataSegnalazione, importo: null, note: '' });
  });
  res.json({ id });
}));
app.put('/api/opportunita/:id', auth, admin, wrap((req, res) => {
  const id = exists('opportunita', req.params.id, 'Opportunità');
  const data = opportunitaBody(req, req.body || {});
  D.transaction(() => {
    D.update('opportunita', id, data);
    D.run('UPDATE eventi SET data=? WHERE opportunitaId=? AND tipo=\'segnalazione\'', data.dataSegnalazione, id);
  });
  res.json({ id });
}));
app.delete('/api/opportunita/:id', auth, admin, wrap((req, res) => {
  const id = exists('opportunita', req.params.id, 'Opportunità');
  D.run('DELETE FROM opportunita WHERE id=?', id);
  res.json({ ok: true });
}));
app.post('/api/opportunita/:id/eventi', auth, admin, wrap((req, res) => {
  const oppId = exists('opportunita', req.params.id, 'Opportunità'); const b = req.body || {};
  const tipo = oneOf(b.tipo, EVENT_TYPES.filter(t => t !== 'segnalazione'), 'tipo evento');
  const importo = b.importo === '' || b.importo == null ? null : num(b.importo, 'importo');
  const id = D.uid();
  D.insert('eventi', { id, opportunitaId: oppId, tipo, data: date(b.data, 'data'), importo, note: str(b.note, 2000) });
  res.json({ id });
}));
app.delete('/api/eventi/:id', auth, admin, wrap((req, res) => {
  const e = D.get('SELECT * FROM eventi WHERE id=?', str(req.params.id));
  if (!e) throw new HttpError(404, 'Evento non trovato');
  if (e.tipo === 'segnalazione') throw bad('L\'evento di segnalazione non si può eliminare');
  D.run('DELETE FROM eventi WHERE id=?', e.id);
  res.json({ ok: true });
}));

/* ===================== LIQUIDAZIONI ===================== */
app.post('/api/liquidazioni', auth, admin, wrap((req, res) => {
  const b = req.body || {}; const ids = Array.isArray(b.eventoIds) ? b.eventoIds.map(x => str(x)) : [];
  if (!ids.length) throw bad('Nessun evento indicato');
  const data = b.data ? date(b.data, 'data') : D.now().slice(0, 10), nota = str(b.nota, 500);
  D.transaction(() => ids.forEach(id => {
    exists('eventi', id, 'Evento');
    D.run('INSERT INTO liquidazioni (eventoId,data,nota) VALUES (?,?,?) ON CONFLICT(eventoId) DO UPDATE SET data=excluded.data, nota=excluded.nota', id, data, nota);
  }));
  res.json({ ok: true, n: ids.length });
}));
app.delete('/api/liquidazioni/:eventoId', auth, admin, wrap((req, res) => {
  D.run('DELETE FROM liquidazioni WHERE eventoId=?', str(req.params.eventoId));
  res.json({ ok: true });
}));

/* ===================== REGOLE ===================== */
function regolaBody(b) {
  return {
    tipSegId: optExists('tipologieSegnalatore', b.tipSegId, 'Tipologia segnalatore'), tipOppId: optExists('tipologieOpportunita', b.tipOppId, 'Tipologia opportunità'),
    perc: num(b.perc, 'percentuale'), fisso: num(b.fisso, 'importo fisso'), maturaSu: oneOf(b.maturaSu, MATURA, 'maturazione'), descr: str(b.descr, 300),
  };
}
app.post('/api/regole', auth, admin, wrap((req, res) => { const id = D.uid(); D.insert('regole', { id, ...regolaBody(req.body || {}) }); res.json({ id }); }));
app.put('/api/regole/:id', auth, admin, wrap((req, res) => { const id = exists('regole', req.params.id, 'Regola'); D.update('regole', id, regolaBody(req.body || {})); res.json({ id }); }));
app.delete('/api/regole/:id', auth, admin, wrap((req, res) => { D.run('DELETE FROM regole WHERE id=?', str(req.params.id)); res.json({ ok: true }); }));

/* ===================== TIPOLOGIE ===================== */
app.post('/api/tipologie/:coll', auth, admin, wrap((req, res) => {
  const table = TIPOLOGIE[req.params.coll]; if (!table) throw new HttpError(404, 'Non trovato');
  const b = req.body || {}; const id = str(b.id, 40).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(id)) throw bad('Codice non valido (lettere minuscole, numeri, - e _)');
  if (D.get(`SELECT 1 FROM ${table} WHERE id=?`, id)) throw new HttpError(409, 'Codice già esistente');
  D.insert(table, { id, nome: req_(b.nome, 'nome'), descr: str(b.descr, 1000) });
  res.json({ id });
}));
app.put('/api/tipologie/:coll/:id', auth, admin, wrap((req, res) => {
  const table = TIPOLOGIE[req.params.coll]; if (!table) throw new HttpError(404, 'Non trovato');
  const id = exists(table, req.params.id, 'Tipologia'); const b = req.body || {};
  D.update(table, id, { nome: req_(b.nome, 'nome'), descr: str(b.descr, 1000) });
  res.json({ id });
}));
app.delete('/api/tipologie/:coll/:id', auth, admin, wrap((req, res) => {
  const table = TIPOLOGIE[req.params.coll]; if (!table) throw new HttpError(404, 'Non trovato');
  const id = exists(table, req.params.id, 'Tipologia');
  const inUso = table === 'tipologieSegnalatore'
    ? D.get('SELECT 1 FROM segnalatori WHERE tipologiaId=? LIMIT 1', id) || D.get('SELECT 1 FROM regole WHERE tipSegId=? LIMIT 1', id)
    : D.get('SELECT 1 FROM opportunita WHERE tipologiaId=? LIMIT 1', id) || D.get('SELECT 1 FROM regole WHERE tipOppId=? LIMIT 1', id);
  if (inUso) throw new HttpError(409, 'Tipologia in uso: non si può eliminare');
  D.run(`DELETE FROM ${table} WHERE id=?`, id);
  res.json({ ok: true });
}));

/* ===================== UTENTI BACK OFFICE ===================== */
app.get('/api/utenti', auth, admin, wrap((req, res) => {
  res.json(D.all('SELECT id, email, nome, attivo, createdAt FROM users WHERE ruolo=\'admin\' ORDER BY createdAt').map(u => ({ ...u, attivo: !!u.attivo })));
}));
app.post('/api/utenti', auth, admin, wrap((req, res) => {
  const b = req.body || {}; const em = email(b.email); if (!em) throw bad('Email obbligatoria');
  if (D.get('SELECT 1 FROM users WHERE email=?', em)) throw new HttpError(409, 'Email già usata da un altro utente');
  const id = D.uid();
  D.insert('users', { id, email: em, passwordHash: D.hashPassword(password(b.password)), ruolo: 'admin', segnalatoreId: null, nome: str(b.nome, 100), attivo: 1, createdAt: D.now() });
  res.json({ id });
}));
app.put('/api/utenti/:id', auth, admin, wrap((req, res) => {
  const u = D.get('SELECT * FROM users WHERE id=? AND ruolo=\'admin\'', str(req.params.id));
  if (!u) throw new HttpError(404, 'Utente non trovato');
  const b = req.body || {}; const data = { nome: str(b.nome ?? u.nome, 100) };
  if (b.email != null) { data.email = email(b.email); if (!data.email) throw bad('Email obbligatoria'); if (D.get('SELECT 1 FROM users WHERE email=? AND id<>?', data.email, u.id)) throw new HttpError(409, 'Email già usata'); }
  if (b.password) data.passwordHash = D.hashPassword(password(b.password));
  if (b.attivo != null) {
    data.attivo = b.attivo ? 1 : 0;
    if (!data.attivo && u.id === req.user.id) throw bad('Non puoi disattivare il tuo stesso utente');
    if (!data.attivo && !D.get('SELECT 1 FROM users WHERE ruolo=\'admin\' AND attivo=1 AND id<>?', u.id)) throw bad('Deve restare almeno un utente attivo');
  }
  D.transaction(() => { D.update('users', u.id, data); if (data.attivo === 0 || data.passwordHash) D.run('DELETE FROM sessions WHERE userId=? AND id<>?', u.id, req.sid || ''); });
  res.json({ id: u.id });
}));

/* ===================== DATI DI ESEMPIO (demo) ===================== */
const DEMO_SEGNALATORE = 's1';
app.post('/api/demo/reset', auth, admin, wrap((req, res) => {
  const b = req.body || {};
  const pw = b.demoPassword ? password(b.demoPassword) : null;
  D.resetDemo();
  if (pw) D.accessoSegnalatore(DEMO_SEGNALATORE, pw);
  res.json({ ok: true, segnalatoreDemo: pw ? D.get('SELECT email FROM segnalatori WHERE id=?', DEMO_SEGNALATORE)?.email : null });
}));

/* ===================== STATICI / ERRORI ===================== */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', etag: false, cacheControl: false, setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Non trovato' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Errore interno' : err.message, ...(err.extra || {}) });
});

// Configurazione automatica al primo avvio da variabili d'ambiente (utile per demo su hosting senza disco persistente).
function autoSetup() {
  const em = str(process.env.SETUP_ADMIN_EMAIL, 200).toLowerCase(), pw = process.env.SETUP_ADMIN_PASSWORD || '';
  if (!needsSetup() || !em || !pw) return;
  try {
    email(em); password(pw);
    D.insert('users', { id: D.uid(), email: em, passwordHash: D.hashPassword(pw), ruolo: 'admin', segnalatoreId: null, nome: str(process.env.SETUP_ADMIN_NAME, 100) || 'Amministrazione', attivo: 1, createdAt: D.now() });
    if (process.env.SEED_DEMO === '1') {
      D.seedDemo();
      if (process.env.DEMO_SEGNALATORE_PASSWORD) { password(process.env.DEMO_SEGNALATORE_PASSWORD); D.accessoSegnalatore(DEMO_SEGNALATORE, process.env.DEMO_SEGNALATORE_PASSWORD); }
    } else D.seedMinimo();
    console.log(`Configurazione iniziale eseguita da variabili d'ambiente (amministratore: ${em}${process.env.SEED_DEMO === '1' ? ', dati di esempio caricati' : ''})`);
  } catch (e) { console.error('Configurazione automatica non riuscita:', e.message); }
}

if (require.main === module) {
  autoSetup();
  const server = app.listen(PORT, HOST, () => console.log(`Segnalatori in ascolto su http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (db: ${D.DB_FILE})`));
  const stop = sig => { console.log(`${sig}: arresto in corso`); server.close(() => { try { D.db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
}
module.exports = app;
