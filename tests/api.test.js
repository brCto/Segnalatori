// Test di integrazione delle API: avvia il server su un database temporaneo e verifica
// configurazione iniziale, login, permessi per ruolo, controllo duplicati e provvigioni.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'segnalatori-test-'));
process.env.DATA_DIR = tmp;
process.env.PORT = '0';
const app = require('../server');

let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

function client() {
  let cookie = '';
  return async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };
}
const admin = client(), seg = client(), anon = client();

test('configurazione iniziale e login amministratore', async () => {
  let r = await anon('GET', '/api/me');
  assert.equal(r.json.needsSetup, true);
  r = await anon('POST', '/api/setup', { email: 'admin@test.it', password: 'corta' });
  assert.equal(r.status, 400);
  r = await admin('POST', '/api/setup', { email: 'admin@test.it', password: 'password123', nome: 'Admin', demo: true });
  assert.equal(r.status, 200); assert.equal(r.json.user.ruolo, 'admin');
  r = await anon('POST', '/api/setup', { email: 'x@test.it', password: 'password123' });
  assert.equal(r.status, 403, 'il setup non è ripetibile');
  r = await anon('GET', '/api/state'); assert.equal(r.status, 401);
  r = await anon('POST', '/api/login', { email: 'admin@test.it', password: 'sbagliata' }); assert.equal(r.status, 401);
});

test('stato completo per il back office e provvigioni demo', async () => {
  const r = await admin('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.json.segnalatori.length, 6);
  assert.equal(r.json.opportunita.length, 12);
  assert.ok(r.json.eventi.length > 30);
  assert.equal(Object.keys(r.json.liquidazioni).length, 2);
});

test('abilitazione accesso segnalatore e vista filtrata', async () => {
  let st = (await admin('GET', '/api/state')).json;
  const laura = st.segnalatori.find(s => s.id === 's1');
  let r = await admin('PUT', '/api/segnalatori/s1', { ...laura, password: 'segreta123' });
  assert.equal(r.status, 200);
  r = await seg('POST', '/api/login', { email: 'giorgio.parodi@example.it', password: 'segreta123' });
  assert.equal(r.status, 200); assert.equal(r.json.user.ruolo, 'segnalatore'); assert.equal(r.json.user.segnalatoreId, 's1');
  st = (await seg('GET', '/api/state')).json;
  assert.equal(st.segnalatori.length, 1);
  assert.ok(st.clienti.every(c => c.segnalatoreId === 's1'));
  assert.ok(st.opportunita.every(o => o.segnalatoreId === 's1'));
  assert.equal(st.opportunita.length, 4);
  const oppIds = new Set(st.opportunita.map(o => o.id));
  assert.ok(st.eventi.every(e => oppIds.has(e.opportunitaId)));
});

test('permessi: il segnalatore non può fare operazioni riservate', async () => {
  assert.equal((await seg('POST', '/api/opportunita/o1/eventi', { tipo: 'contatto', data: '2026-09-01' })).status, 403);
  assert.equal((await seg('POST', '/api/regole', { perc: 50, maturaSu: 'pagamento' })).status, 403);
  assert.equal((await seg('POST', '/api/segnalatori', { nome: 'X', tipologiaId: 'broker' })).status, 403);
  assert.equal((await seg('PUT', '/api/opportunita/o1', { clienteId: 'c1', titolo: 'x', tipologiaId: 'nuovo' })).status, 403);
  assert.equal((await seg('GET', '/api/utenti')).status, 403);
  // cliente di un altro segnalatore: non visibile né modificabile
  assert.equal((await seg('PUT', '/api/clienti/c2', { ragioneSociale: 'Hack', segnalatoreId: 's1' })).status, 404);
  // opportunità su cliente altrui
  assert.equal((await seg('POST', '/api/opportunita', { clienteId: 'c2', tipologiaId: 'usato', titolo: 'x' })).status, 403);
});

test('segnalatore: nuovo cliente con controllo duplicati e nuova segnalazione', async () => {
  let r = await seg('POST', '/api/clienti', { ragioneSociale: 'Blue Horizon Charter', piva: '04567890123', citta: 'Lavagna' });
  assert.equal(r.status, 409); assert.ok(r.json.duplicati.some(d => d.hard && d.why === 'stessa P.IVA'));
  assert.equal(r.json.duplicati[0].segnalatore, 'Marina di Portofino Srl');
  r = await seg('POST', '/api/clienti', { ragioneSociale: 'Blue Horizon Charter', citta: 'Lavagna' });
  assert.equal(r.status, 409); assert.ok(r.json.duplicati.every(d => !d.hard));
  r = await seg('POST', '/api/clienti', { ragioneSociale: 'Blue Horizon Charter', citta: 'Lavagna', forza: true });
  assert.equal(r.status, 200); const cid = r.json.id;
  const st = (await seg('GET', '/api/state')).json;
  assert.equal(st.clienti.find(c => c.id === cid).segnalatoreId, 's1', 'il cliente va nel portafoglio di chi lo inserisce');
  r = await seg('POST', '/api/opportunita', { clienteId: cid, segnalatoreId: 's2', tipologiaId: 'usato', titolo: 'Nuova segnalazione', valoreStimato: 1000, dataSegnalazione: '2026-09-20' });
  assert.equal(r.status, 200);
  const st2 = (await seg('GET', '/api/state')).json;
  const o = st2.opportunita.find(x => x.id === r.json.id);
  assert.equal(o.segnalatoreId, 's1', 'il segnalatore non può assegnare ad altri');
  assert.equal(st2.eventi.filter(e => e.opportunitaId === o.id && e.tipo === 'segnalazione').length, 1);
});

test('back office: eventi, liquidazioni, regole, validazioni', async () => {
  let r = await admin('POST', '/api/opportunita/o6/eventi', { tipo: 'contratto', data: '2026-09-18', importo: 620000, note: 'Firmato' });
  assert.equal(r.status, 200); const evId = r.json.id;
  r = await admin('POST', '/api/opportunita/o6/eventi', { tipo: 'segnalazione', data: '2026-09-18' }); assert.equal(r.status, 400);
  r = await admin('POST', '/api/opportunita/o6/eventi', { tipo: 'contratto', data: 'ieri' }); assert.equal(r.status, 400);
  r = await admin('POST', '/api/liquidazioni', { eventoIds: [evId], data: '2026-09-21', nota: 'test' }); assert.equal(r.status, 200);
  let st = (await admin('GET', '/api/state')).json;
  assert.equal(st.liquidazioni[evId].nota, 'test');
  r = await admin('DELETE', '/api/liquidazioni/' + evId); assert.equal(r.status, 200);
  r = await admin('DELETE', '/api/eventi/' + evId); assert.equal(r.status, 200);
  const segEv = st.eventi.find(e => e.opportunitaId === 'o6' && e.tipo === 'segnalazione');
  r = await admin('DELETE', '/api/eventi/' + segEv.id); assert.equal(r.status, 400);
  r = await admin('POST', '/api/regole', { tipSegId: 'broker', tipOppId: 'nuovo', perc: 12, fisso: 0, maturaSu: 'contratto', descr: 'test' }); assert.equal(r.status, 200);
  r = await admin('POST', '/api/regole', { perc: 12, maturaSu: 'domani' }); assert.equal(r.status, 400);
  r = await admin('DELETE', '/api/tipologie/segnalatore/broker'); assert.equal(r.status, 409, 'tipologia in uso');
  r = await admin('POST', '/api/tipologie/opportunita', { id: 'Nuova Cat', nome: 'x' }); assert.equal(r.status, 400);
  r = await admin('POST', '/api/tipologie/opportunita', { id: 'noleggio', nome: 'Noleggio' }); assert.equal(r.status, 200);
  r = await admin('DELETE', '/api/tipologie/opportunita/noleggio'); assert.equal(r.status, 200);
});

test('utenti back office e cambio password', async () => {
  let r = await admin('POST', '/api/utenti', { email: 'admin@test.it', password: 'password123' }); assert.equal(r.status, 409);
  r = await admin('POST', '/api/utenti', { email: 'giorgio.parodi@example.it', password: 'password123' }); assert.equal(r.status, 409, 'email già usata da un segnalatore');
  r = await admin('POST', '/api/utenti', { email: 'secondo@test.it', password: 'password123', nome: 'Secondo' }); assert.equal(r.status, 200);
  const id2 = r.json.id;
  r = await admin('PUT', '/api/utenti/' + id2, { attivo: false }); assert.equal(r.status, 200);
  r = await anon('POST', '/api/login', { email: 'secondo@test.it', password: 'password123' }); assert.equal(r.status, 401);
  r = await admin('POST', '/api/password', { attuale: 'sbagliata', nuova: 'nuovapassword1' }); assert.equal(r.status, 400);
  r = await admin('POST', '/api/password', { attuale: 'password123', nuova: 'nuovapassword1' }); assert.equal(r.status, 200);
  r = await anon('POST', '/api/login', { email: 'admin@test.it', password: 'nuovapassword1' }); assert.equal(r.status, 200);
});

test('segnalatore non attivo: sessione e login rifiutati', async () => {
  const st = (await admin('GET', '/api/state')).json;
  const laura = st.segnalatori.find(s => s.id === 's1');
  let r = await admin('PUT', '/api/segnalatori/s1', { ...laura, attivo: false }); assert.equal(r.status, 200);
  r = await seg('GET', '/api/state'); assert.equal(r.status, 401);
  r = await seg('POST', '/api/login', { email: 'giorgio.parodi@example.it', password: 'segreta123' }); assert.equal(r.status, 403);
  r = await admin('PUT', '/api/segnalatori/s1', { ...laura, attivo: true, revocaAccesso: true }); assert.equal(r.status, 200);
  r = await seg('POST', '/api/login', { email: 'giorgio.parodi@example.it', password: 'segreta123' }); assert.equal(r.status, 401);
});

test('protezione CSRF: richieste cross-site o non JSON rifiutate', async () => {
  const r = await fetch(base + '/api/logout', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(r2.status, 415);
});

test('ripristino dati di esempio: dati puliti, utenti back office conservati, accesso demo', async () => {
  assert.equal((await seg('POST', '/api/demo/reset', {})).status, 401, 'il segnalatore (ormai senza accesso) non può');
  let r = await admin('POST', '/api/demo/reset', { demoPassword: 'corta' }); assert.equal(r.status, 400);
  r = await admin('POST', '/api/demo/reset', { demoPassword: 'demo12345' }); assert.equal(r.status, 200);
  assert.equal(r.json.segnalatoreDemo, 'giorgio.parodi@example.it');
  const st = (await admin('GET', '/api/state')).json;
  assert.equal(st.segnalatori.length, 6); assert.equal(st.opportunita.length, 12); assert.equal(st.clienti.length, 10);
  assert.ok(!st.clienti.some(c => c.ragioneSociale === 'Blue Horizon Charter'), 'i clienti aggiunti sono spariti');
  assert.equal(st.segnalatori.filter(s => s.haAccesso).length, 1);
  const demo = client();
  r = await demo('POST', '/api/login', { email: 'giorgio.parodi@example.it', password: 'demo12345' }); assert.equal(r.status, 200);
  const us = (await admin('GET', '/api/utenti')).json; assert.equal(us.length, 2, 'utenti back office conservati');
});

test('logout invalida la sessione', async () => {
  assert.equal((await admin('POST', '/api/logout', {})).status, 200);
  assert.equal((await admin('GET', '/api/state')).status, 401);
});
