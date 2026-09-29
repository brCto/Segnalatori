// Accesso al database SQLite (modulo node:sqlite integrato in Node >= 22.13).
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { demoData } = require('./demo');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'segnalatori.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS tipologieSegnalatore (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS tipologieOpportunita (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS segnalatori (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, tipologiaId TEXT NOT NULL REFERENCES tipologieSegnalatore(id),
  email TEXT NOT NULL DEFAULT '', telefono TEXT NOT NULL DEFAULT '', piva TEXT NOT NULL DEFAULT '', citta TEXT NOT NULL DEFAULT '',
  attivo INTEGER NOT NULL DEFAULT 1, dataInizio TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS clienti (
  id TEXT PRIMARY KEY, ragioneSociale TEXT NOT NULL, piva TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '', citta TEXT NOT NULL DEFAULT '', segnalatoreId TEXT NOT NULL REFERENCES segnalatori(id),
  dataInserimento TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS opportunita (
  id TEXT PRIMARY KEY, clienteId TEXT NOT NULL REFERENCES clienti(id), segnalatoreId TEXT NOT NULL REFERENCES segnalatori(id),
  tipologiaId TEXT NOT NULL REFERENCES tipologieOpportunita(id), titolo TEXT NOT NULL, luogo TEXT NOT NULL DEFAULT '', descr TEXT NOT NULL DEFAULT '',
  valoreStimato REAL NOT NULL DEFAULT 0, dataSegnalazione TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS eventi (
  id TEXT PRIMARY KEY, opportunitaId TEXT NOT NULL REFERENCES opportunita(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, data TEXT NOT NULL, importo REAL, note TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_eventi_opp ON eventi(opportunitaId);
CREATE TABLE IF NOT EXISTS regole (
  id TEXT PRIMARY KEY, tipSegId TEXT NOT NULL DEFAULT '', tipOppId TEXT NOT NULL DEFAULT '',
  perc REAL NOT NULL DEFAULT 0, fisso REAL NOT NULL DEFAULT 0, maturaSu TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS liquidazioni (
  eventoId TEXT PRIMARY KEY REFERENCES eventi(id) ON DELETE CASCADE, data TEXT NOT NULL, nota TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, passwordHash TEXT NOT NULL,
  ruolo TEXT NOT NULL CHECK (ruolo IN ('admin','segnalatore')), segnalatoreId TEXT UNIQUE REFERENCES segnalatori(id),
  nome TEXT NOT NULL DEFAULT '', attivo INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(userId);
`);
// Migrazioni leggere per database creati con versioni precedenti.
const hasCol = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
if (!hasCol('opportunita', 'luogo')) db.exec("ALTER TABLE opportunita ADD COLUMN luogo TEXT NOT NULL DEFAULT ''");

const uid =() => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

/* ---- password (scrypt, nessuna dipendenza) ---- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, salt, hash] = String(stored).split('$');
    const calc = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    const h = Buffer.from(hash, 'base64');
    return h.length === calc.length && crypto.timingSafeEqual(h, calc);
  } catch { return false; }
}

/* ---- helpers ---- */
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function insert(table, obj) {
  const keys = Object.keys(obj);
  run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => obj[k]));
}
function update(table, id, obj, idCol = 'id') {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(',')} WHERE ${idCol}=?`, ...keys.map(k => obj[k]), id);
}

/* ---- sessioni ---- */
const SESSION_DAYS = +process.env.SESSION_DAYS || 30;
function createSession(userId) {
  const id = crypto.randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  insert('sessions', { id, userId, createdAt: now(), expiresAt: exp });
  return id;
}
function userBySession(sid) {
  if (!sid) return null;
  const s = get('SELECT * FROM sessions WHERE id=?', sid);
  if (!s) return null;
  if (s.expiresAt < now()) { run('DELETE FROM sessions WHERE id=?', sid); return null; }
  const u = get('SELECT * FROM users WHERE id=?', s.userId);
  if (!u || !u.attivo) return null;
  if (u.ruolo === 'segnalatore') {
    const sg = get('SELECT attivo FROM segnalatori WHERE id=?', u.segnalatoreId);
    if (!sg || !sg.attivo) return null;
  }
  return u;
}
function deleteSession(sid) { run('DELETE FROM sessions WHERE id=?', sid); }
function purgeSessions() { run('DELETE FROM sessions WHERE expiresAt < ?', now()); }

/* ---- seed dati di esempio ---- */
function seedDemo() {
  const d = demoData();
  transaction(() => {
    d.tipologieSegnalatore.forEach(t => insert('tipologieSegnalatore', t));
    d.tipologieOpportunita.forEach(t => insert('tipologieOpportunita', t));
    d.segnalatori.forEach(s => insert('segnalatori', s));
    d.clienti.forEach(c => insert('clienti', c));
    d.opportunita.forEach(o => insert('opportunita', o));
    d.eventi.forEach(e => insert('eventi', e));
    d.regole.forEach(r => insert('regole', r));
    d.liquidazioni.forEach(l => insert('liquidazioni', l));
  });
}
// Riporta i dati allo stato di esempio; conserva gli utenti del back office.
function resetDemo() {
  transaction(() => {
    ['liquidazioni', 'eventi', 'opportunita', 'clienti'].forEach(t => run(`DELETE FROM ${t}`));
    run("DELETE FROM users WHERE ruolo='segnalatore'");
    ['segnalatori', 'regole', 'tipologieOpportunita', 'tipologieSegnalatore'].forEach(t => run(`DELETE FROM ${t}`));
  });
  seedDemo();
}
// Crea o aggiorna l'accesso al portale di un segnalatore (usato dalla demo).
function accessoSegnalatore(segId, pw) {
  const s = get('SELECT * FROM segnalatori WHERE id=?', segId);
  if (!s || !s.email) return false;
  const u = get('SELECT id FROM users WHERE segnalatoreId=?', segId);
  if (u) update('users', u.id, { email: s.email, passwordHash: hashPassword(pw), nome: s.nome, attivo: 1 });
  else insert('users', { id: uid(), email: s.email, passwordHash: hashPassword(pw), ruolo: 'segnalatore', segnalatoreId: segId, nome: s.nome, attivo: 1, createdAt: now() });
  return true;
}
function seedMinimo() {
  transaction(() => {
    if (!get('SELECT 1 FROM tipologieSegnalatore LIMIT 1'))
      insert('tipologieSegnalatore', { id: 'standard', nome: 'Segnalatore', descr: '' });
    if (!get('SELECT 1 FROM tipologieOpportunita LIMIT 1'))
      insert('tipologieOpportunita', { id: 'generica', nome: 'Opportunità', descr: '' });
    if (!get('SELECT 1 FROM regole LIMIT 1'))
      insert('regole', { id: uid(), tipSegId: '', tipOppId: '', perc: 5, fisso: 0, maturaSu: 'pagamento', descr: 'Regola base' });
  });
}

module.exports = { db, uid, now, all, get, run, insert, update, transaction, hashPassword, verifyPassword,
  createSession, userBySession, deleteSession, purgeSessions, seedDemo, seedMinimo, resetDemo, accessoSegnalatore, DB_FILE };
