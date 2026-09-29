// Dati di esempio caricabili al primo avvio (opzione "Carica dati di esempio" nella schermata di configurazione).
// Scenario: dealer/cantiere nautico con rete di segnalatori (broker, marina, cantieri partner, skipper).
'use strict';
const crypto = require('crypto');
const uid = () => crypto.randomBytes(6).toString('hex');

function demoData() {
  const ev = (opp, tipo, data, importo, note) => ({ id: uid(), opportunitaId: opp, tipo, data, importo: importo || null, note: note || '' });
  const eventi = [
    // o1 · Motoryacht 62' flybridge nuovo — venduto e consegnato
    ...[['segnalazione','2026-01-20'],['contatto','2026-01-24'],['incontro','2026-02-14','','Visita in cantiere'],['offerta','2026-03-05',1850000],['contratto','2026-04-10',1780000,'Sconto dealer 4%'],['pagamento','2026-04-15',534000,'Acconto 30% alla firma'],['consegna','2026-08-28','','Consegna a Marina di Portofino'],['pagamento','2026-08-30',1246000,'Saldo alla consegna']].map(a => ev('o1', ...a)),
    // o2 · Flotta charter: 2 catamarani 45' — contratto firmato, acconto incassato
    ...[['segnalazione','2026-03-02'],['incontro','2026-03-15','','Presentazione flotta'],['offerta','2026-04-01',880000],['contratto','2026-05-06',860000,'Consegna prevista primavera 2027'],['pagamento','2026-05-20',258000,'Acconto 30%']].map(a => ev('o2', ...a)),
    // o3 · Sailing yacht 54' usato — venduto e incassato
    ...[['segnalazione','2026-02-10'],['contatto','2026-02-12'],['incontro','2026-03-01','','Prova in mare a Santa Margherita'],['offerta','2026-03-20',395000],['contratto','2026-04-02',390000,'Perizia e survey ok'],['consegna','2026-05-10'],['pagamento','2026-05-12',390000,'Saldo']].map(a => ev('o3', ...a)),
    // o4 · Open 40' — in trattativa al Salone
    ...[['segnalazione','2026-08-20'],['contatto','2026-08-22'],['incontro','2026-09-19','','Visita allo stand, Salone Nautico di Genova']].map(a => ev('o4', ...a)),
    // o5 · Convenzione ormeggi — persa
    ...[['segnalazione','2026-07-10'],['offerta','2026-07-25',60000],['persa','2026-08-30','','Ha rinnovato con il marina attuale']].map(a => ev('o5', ...a)),
    // o6 · Refit completo motoryacht 80' — offerta in corso
    ...[['segnalazione','2026-06-15'],['incontro','2026-07-01','','Sopralluogo a bordo, La Spezia'],['offerta','2026-07-20',620000,'Refit interni, motori e vernici']].map(a => ev('o6', ...a)),
    // o7 · Elettronica e stabilizzatori — contratto firmato
    ...[['segnalazione','2026-07-20'],['offerta','2026-08-01',92000],['contratto','2026-09-01',92000,'Installazione a ottobre']].map(a => ev('o7', ...a)),
    // o8 · Gozzo 10 m usato — appena segnalato
    ...[['segnalazione','2026-09-10'],['contatto','2026-09-12']].map(a => ev('o8', ...a)),
    // o9 · Rimotorizzazione — concluso e incassato
    ...[['segnalazione','2026-04-10'],['offerta','2026-04-15',48000],['contratto','2026-04-20',48000],['consegna','2026-05-25'],['pagamento','2026-05-30',48000]].map(a => ev('o9', ...a)),
    // o10 · Daycruiser 28' usato — nuova segnalazione
    ...[['segnalazione','2026-09-15']].map(a => ev('o10', ...a)),
    // o11 · Explorer yacht 90' — firmato al Salone, acconto incassato
    ...[['segnalazione','2026-05-05'],['incontro','2026-05-20','','Incontro con l\'armatore a Genova'],['offerta','2026-06-30',4200000],['contratto','2026-09-05',4050000,'Firma al Salone Nautico'],['pagamento','2026-09-10',810000,'Acconto 20%']].map(a => ev('o11', ...a)),
    // o12 · Charter stagione 2027 — in contatto
    ...[['segnalazione','2026-09-20'],['contatto','2026-09-22']].map(a => ev('o12', ...a)),
  ];
  const liquidazioni = eventi
    .filter(e => (e.opportunitaId === 'o3' || e.opportunitaId === 'o9') && e.tipo === 'pagamento')
    .map(e => ({ eventoId: e.id, data: '2026-06-30', nota: 'Bonifico giugno' }));
  return {
    tipologieSegnalatore: [
      { id: 'broker',      nome: 'Broker nautico', descr: 'Professionista con P.IVA e mandato di segnalazione. Provvigione maggiorata all\'incasso.' },
      { id: 'marina',      nome: 'Marina / porto turistico', descr: 'Marina, ormeggiatori e porti turistici che segnalano armatori e società di charter.' },
      { id: 'cantiere',    nome: 'Cantiere / officina partner', descr: 'Cantieri, rimessaggi e officine che segnalano clienti per vendite e refit.' },
      { id: 'skipper',     nome: 'Skipper / comandante', descr: 'Comandanti e skipper professionisti che segnalano armatori.' },
      { id: 'dipendente',  nome: 'Referral interno', descr: 'Dipendente dell\'azienda. Premio fisso alla firma.' },
      { id: 'occasionale', nome: 'Segnalatore occasionale', descr: 'Armatore o conoscente che segnala saltuariamente.' },
    ],
    tipologieOpportunita: [
      { id: 'nuovo',     nome: 'Vendita yacht nuovo', descr: 'Vendita di imbarcazione nuova dai cantieri rappresentati.' },
      { id: 'usato',     nome: 'Brokerage usato', descr: 'Compravendita di imbarcazioni usate.' },
      { id: 'refit',     nome: 'Refit e manutenzione', descr: 'Lavori di refit, rimotorizzazione, manutenzione straordinaria.' },
      { id: 'charter',   nome: 'Charter e noleggio', descr: 'Vendita a società di charter e contratti di noleggio.' },
      { id: 'ormeggio',  nome: 'Ormeggio e servizi portuali', descr: 'Contratti di ormeggio annuali e servizi; la base provvigionale è il canone del primo anno.' },
      { id: 'accessori', nome: 'Elettronica e accessori', descr: 'Elettronica di bordo, stabilizzatori, tender, accessori.' },
    ],
    segnalatori: [
      { id: 's1', nome: 'Giorgio Parodi', tipologiaId: 'broker', email: 'giorgio.parodi@example.it', telefono: '335 1234567', piva: '01234567890', citta: 'Genova', attivo: 1, dataInizio: '2025-03-01', note: 'Broker con mandato annuale, zona Genova e Tigullio.' },
      { id: 's2', nome: 'Marina di Portofino Srl', tipologiaId: 'marina', email: 'commerciale@marinaportofino.example.it', telefono: '0185 998877', piva: '02345678901', citta: 'Portofino', attivo: 1, dataInizio: '2025-06-01', note: 'Segnala armatori ormeggiati e società di charter.' },
      { id: 's3', nome: 'Cantiere Navale Ligure Srl', tipologiaId: 'cantiere', email: 'info@cantiereligure.example.it', telefono: '0187 445566', piva: '03456789012', citta: 'La Spezia', attivo: 1, dataInizio: '2025-09-15', note: 'Cantiere partner per refit e rimessaggio.' },
      { id: 's4', nome: 'Luca Ferrando', tipologiaId: 'skipper', email: 'luca.ferrando@example.it', telefono: '347 7654321', piva: '', citta: 'Rapallo', attivo: 1, dataInizio: '2026-01-10', note: 'Comandante professionista, charter e trasferimenti.' },
      { id: 's5', nome: 'Elena Costa', tipologiaId: 'dipendente', email: 'e.costa@azienda.example.it', telefono: '', piva: '', citta: 'Genova', attivo: 1, dataInizio: '2026-02-01', note: 'Ufficio commerciale.' },
      { id: 's6', nome: 'Andrea Bruzzone', tipologiaId: 'occasionale', email: 'a.bruzzone@example.it', telefono: '', piva: '', citta: 'Chiavari', attivo: 0, dataInizio: '2025-04-01', note: 'Armatore, non più attivo dal 2026.' },
    ],
    clienti: [
      { id: 'c1',  ragioneSociale: 'Alessandro Dellepiane', piva: 'DLLLSN70A01D969X', email: 'a.dellepiane@example.it', telefono: '335 9988776', citta: 'Genova', segnalatoreId: 's1', dataInserimento: '2026-01-20', note: 'Armatore privato, già proprietario di un 50\'.' },
      { id: 'c2',  ragioneSociale: 'Blue Horizon Charter Srl', piva: '04567890123', email: 'info@bluehorizon.example.it', telefono: '0185 334455', citta: 'Lavagna', segnalatoreId: 's2', dataInserimento: '2026-03-02', note: 'Società di charter, flotta di 6 unità.' },
      { id: 'c3',  ragioneSociale: 'Rebora Holding Srl', piva: '05678901234', email: 'segreteria@rebora.example.it', telefono: '0185 223344', citta: 'Santa Margherita Ligure', segnalatoreId: 's1', dataInserimento: '2026-02-10', note: '' },
      { id: 'c4',  ragioneSociale: 'Marco Ferretti', piva: '', email: 'marco.ferretti@example.it', telefono: '338 1122334', citta: 'Milano', segnalatoreId: 's4', dataInserimento: '2026-08-20', note: 'Primo acquisto, uso familiare.' },
      { id: 'c5',  ragioneSociale: 'Liguria Yachting Club ASD', piva: '06789012345', email: 'segreteria@lyc.example.it', telefono: '0184 556677', citta: 'Sanremo', segnalatoreId: 's2', dataInserimento: '2026-07-10', note: '' },
      { id: 'c6',  ragioneSociale: 'Sea Dream Charter Sas', piva: '07890123456', email: 'ops@seadream.example.it', telefono: '0187 667788', citta: 'La Spezia', segnalatoreId: 's3', dataInserimento: '2026-06-15', note: '' },
      { id: 'c7',  ragioneSociale: 'Paolo Castagnola', piva: '', email: 'p.castagnola@example.it', telefono: '', citta: 'Torino', segnalatoreId: 's5', dataInserimento: '2026-09-10', note: '' },
      { id: 'c8',  ragioneSociale: 'Nautica Tigullio Sas', piva: '08901234567', email: 'info@nauticatigullio.example.it', telefono: '0185 778899', citta: 'Chiavari', segnalatoreId: 's3', dataInserimento: '2026-04-10', note: 'Rivenditore, gestisce anche rimessaggio.' },
      { id: 'c9',  ragioneSociale: 'Francesca Oneto', piva: '', email: '', telefono: '349 5566778', citta: 'Camogli', segnalatoreId: 's4', dataInserimento: '2026-09-15', note: '' },
      { id: 'c10', ragioneSociale: 'Mediterranean Cruises Spa', piva: '09012345678', email: 'fleet@medcruises.example.it', telefono: '010 5544332', citta: 'Genova', segnalatoreId: 's1', dataInserimento: '2026-05-05', note: 'Armatore con flotta, sede a Genova.' },
    ],
    opportunita: [
      { id: 'o1',  clienteId: 'c1',  segnalatoreId: 's1', tipologiaId: 'nuovo',     titolo: 'Motoryacht 62\' flybridge', luogo: 'Portofino', descr: 'Nuova costruzione, tre cabine, motori IPS. Permuta del 50\' attuale valutata a parte.', valoreStimato: 1850000, dataSegnalazione: '2026-01-20' },
      { id: 'o2',  clienteId: 'c2',  segnalatoreId: 's2', tipologiaId: 'charter',   titolo: 'Flotta charter: 2 catamarani 45\'', luogo: 'Marina di Portofino', descr: 'Ampliamento flotta per la stagione 2027.', valoreStimato: 900000, dataSegnalazione: '2026-03-02' },
      { id: 'o3',  clienteId: 'c3',  segnalatoreId: 's1', tipologiaId: 'usato',     titolo: 'Sailing yacht 54\' (2019)', luogo: 'Santa Margherita Ligure', descr: 'Usato in conto vendita, un solo proprietario.', valoreStimato: 420000, dataSegnalazione: '2026-02-10' },
      { id: 'o4',  clienteId: 'c4',  segnalatoreId: 's4', tipologiaId: 'nuovo',     titolo: 'Open 40\' con fuoribordo', luogo: 'Salone Nautico, Genova', descr: 'Interessato al modello esposto al Salone.', valoreStimato: 380000, dataSegnalazione: '2026-08-20' },
      { id: 'o5',  clienteId: 'c5',  segnalatoreId: 's2', tipologiaId: 'ormeggio',  titolo: 'Convenzione ormeggi soci 2027', luogo: 'Lavagna', descr: '', valoreStimato: 60000, dataSegnalazione: '2026-07-10' },
      { id: 'o6',  clienteId: 'c6',  segnalatoreId: 's3', tipologiaId: 'refit',     titolo: 'Refit completo motoryacht 80\'', luogo: 'La Spezia', descr: 'Rifacimento interni, revisione motori, verniciatura scafo.', valoreStimato: 650000, dataSegnalazione: '2026-06-15' },
      { id: 'o7',  clienteId: 'c1',  segnalatoreId: 's1', tipologiaId: 'accessori', titolo: 'Elettronica di bordo e stabilizzatori', luogo: 'Portofino', descr: 'Per il nuovo 62\'.', valoreStimato: 95000, dataSegnalazione: '2026-07-20' },
      { id: 'o8',  clienteId: 'c7',  segnalatoreId: 's5', tipologiaId: 'usato',     titolo: 'Gozzo 10 m usato', luogo: 'Camogli', descr: '', valoreStimato: 145000, dataSegnalazione: '2026-09-10' },
      { id: 'o9',  clienteId: 'c8',  segnalatoreId: 's3', tipologiaId: 'refit',     titolo: 'Rimotorizzazione e antivegetativa', luogo: 'Chiavari', descr: '', valoreStimato: 48000, dataSegnalazione: '2026-04-10' },
      { id: 'o10', clienteId: 'c9',  segnalatoreId: 's4', tipologiaId: 'usato',     titolo: 'Daycruiser 28\' usato', luogo: 'Camogli', descr: '', valoreStimato: 85000, dataSegnalazione: '2026-09-15' },
      { id: 'o11', clienteId: 'c10', segnalatoreId: 's1', tipologiaId: 'nuovo',     titolo: 'Explorer yacht 90\'', luogo: 'Genova', descr: 'Nuova costruzione, consegna 2028. Trattativa seguita con il cantiere.', valoreStimato: 4200000, dataSegnalazione: '2026-05-05' },
      { id: 'o12', clienteId: 'c5',  segnalatoreId: 's2', tipologiaId: 'charter',   titolo: 'Charter stagione 2027 (5 settimane)', luogo: 'Lavagna', descr: 'Noleggio per i soci del club.', valoreStimato: 70000, dataSegnalazione: '2026-09-20' },
    ],
    eventi,
    regole: [
      { id: 'r1', tipSegId: '',           tipOppId: '',         perc: 3,  fisso: 0,   maturaSu: 'pagamento', descr: 'Regola base' },
      { id: 'r2', tipSegId: 'broker',     tipOppId: '',         perc: 5,  fisso: 0,   maturaSu: 'pagamento', descr: 'Broker nautico: 5% all\'incasso' },
      { id: 'r3', tipSegId: '',           tipOppId: 'refit',    perc: 8,  fisso: 0,   maturaSu: 'contratto', descr: 'Refit: 8% alla firma' },
      { id: 'r4', tipSegId: 'marina',     tipOppId: 'charter',  perc: 6,  fisso: 0,   maturaSu: 'contratto', descr: 'Marina su vendite charter' },
      { id: 'r5', tipSegId: 'dipendente', tipOppId: '',         perc: 0,  fisso: 500, maturaSu: 'contratto', descr: 'Premio fisso referral interno' },
      { id: 'r6', tipSegId: 'skipper',    tipOppId: 'usato',    perc: 4,  fisso: 0,   maturaSu: 'pagamento', descr: 'Skipper su brokerage usato' },
      { id: 'r7', tipSegId: '',           tipOppId: 'ormeggio', perc: 10, fisso: 0,   maturaSu: 'contratto', descr: 'Ormeggi: 10% del canone del primo anno alla firma' },
    ],
    liquidazioni,
  };
}

module.exports = { demoData };
