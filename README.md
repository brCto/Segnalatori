# Segnalatori

Applicazione web per la gestione di segnalatori/procacciatori, clienti segnalati, opportunità, eventi di follow-up e provvigioni.

- **Back office (azienda)**: anagrafiche, eventi di follow-up, regole provvigionali, report e liquidazioni, gestione utenti.
- **Portale segnalatore**: ogni segnalatore accede con email e password e vede solo i propri clienti, le proprie segnalazioni e le proprie provvigioni. Può inserire clienti (con controllo duplicati) e nuove segnalazioni.

Stack: Node.js (≥ 22.13) + Express, database SQLite tramite il modulo `node:sqlite` integrato (nessun modulo nativo da compilare), frontend in un singolo file HTML senza dipendenze.

## Avvio in locale

```bash
npm install
npm start
```

Poi aprire http://localhost:8765. Al primo avvio compare la **configurazione iniziale**: si crea l'utente amministratore e si può scegliere di caricare i dati di esempio. Il database viene creato in `data/segnalatori.db`.

I dati di esempio (`demo.js`) descrivono un dealer/cantiere nautico con una rete di segnalatori: broker, marina, cantieri partner, skipper e referral interni, che segnalano armatori e società di charter. Le opportunità coprono vendite di yacht nuovi e usati, refit, charter, ormeggi e accessori, con trattative a vari stadi (alcune firmate al Salone Nautico di Genova). Per ripartire da zero cancellare la cartella `data` a server fermo.

Test di integrazione delle API (usano un database temporaneo):

```bash
npm test
```

## Pubblicazione

### Con Docker (consigliato)

```bash
docker compose up -d --build
```

L'app ascolta sulla porta 8765; il database sta nel volume `segnalatori-data`. Davanti al container va messo un reverse proxy con HTTPS (Caddy, nginx, Traefik); in quel caso impostare in `docker-compose.yml`:

- `COOKIE_SECURE=1` → il cookie di sessione viene inviato solo su HTTPS;
- `TRUST_PROXY=1` → l'IP del client viene letto da `X-Forwarded-For` (serve al limite dei tentativi di login).

Esempio di Caddyfile:

```
segnalatori.esempio.it {
    reverse_proxy 127.0.0.1:8765
}
```

### Pubblicare una demo (fiera, presentazione)

1. Impostare le variabili `SETUP_ADMIN_EMAIL`, `SETUP_ADMIN_PASSWORD`, `SEED_DEMO=1` e `DEMO_SEGNALATORE_PASSWORD` (vedi `.env.example` o `docker-compose.yml`): al primo avvio l'app crea l'amministratore, carica lo scenario nautico e abilita l'accesso del broker demo (Giorgio Parodi, `giorgio.parodi@example.it`). Funziona anche su hosting che ricreano il container a ogni deploy (Render, Railway, Fly.io): a ogni riavvio con database vuoto la demo si riconfigura da sola.
2. Servire l'app in HTTPS (reverse proxy o piattaforma) con `COOKIE_SECURE=1` e `TRUST_PROXY=1`.
3. Dopo ogni dimostrazione, da **Impostazioni → Ripristina dati di esempio** si riportano i dati allo stato iniziale (gli utenti del back office restano; si può reimpostare la password del broker demo).

Le credenziali della demo sono pubbliche di fatto: non riutilizzarle in produzione.

### Render + UptimeRobot (gratis)

Il file `render.yaml` descrive il servizio. Passi:

1. Caricare il repository su GitHub (o GitLab).
2. Su [render.com](https://render.com): **New → Blueprint**, collegare il repository. Render legge `render.yaml` e chiede i tre valori mancanti: `SETUP_ADMIN_EMAIL`, `SETUP_ADMIN_PASSWORD`, `DEMO_SEGNALATORE_PASSWORD`. Le altre variabili (HTTPS, proxy, dati demo) sono già impostate nel file.
3. Al termine del deploy l'app risponde su `https://<nome>.onrender.com`. Al primo avvio si configura da sola: amministratore, scenario nautico, accesso del broker demo `giorgio.parodi@example.it`.
4. Il piano gratuito spegne il servizio dopo 15 minuti senza traffico (riparte in circa un minuto) e non conserva il disco: a ogni riavvio i dati tornano allo stato iniziale, il che per una demo va bene.
5. Per tenerlo sveglio: su [uptimerobot.com](https://uptimerobot.com) creare un monitor HTTP(s) sull'indirizzo `https://<nome>.onrender.com/healthz` con intervallo di 5 minuti. L'endpoint `/healthz` è leggero e non crea sessioni.

### Senza Docker

Su un server con Node ≥ 22.13: copiare il progetto, `npm ci --omit=dev`, impostare le variabili di ambiente (vedi `.env.example`) e avviare `node server.js` con un supervisore (systemd, pm2). Backup = copia del file `data/segnalatori.db` (con i file `-wal`/`-shm` se presenti, oppure a server fermo).

### Variabili di ambiente

| Variabile | Default | Significato |
|---|---|---|
| `PORT` | `8765` | Porta di ascolto |
| `HOST` | `0.0.0.0` | Indirizzo di ascolto |
| `DATA_DIR` | `./data` | Cartella del database SQLite |
| `COOKIE_SECURE` | `0` | `1` se servito in HTTPS |
| `TRUST_PROXY` | `0` | `1` se dietro reverse proxy |
| `SESSION_DAYS` | `30` | Durata della sessione |

## Sicurezza

- Password salvate con scrypt (salt casuale); minimo 8 caratteri.
- Sessioni server-side con cookie `HttpOnly`, `SameSite=Lax` (+ `Secure` in HTTPS); logout e cambio password invalidano le sessioni.
- Limite di 10 tentativi di login ogni 15 minuti per IP.
- Le API che modificano dati accettano solo JSON same-origin (protezione CSRF).
- Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`.
- Ogni endpoint verifica il ruolo: il segnalatore non può leggere o modificare dati di altri segnalatori, né inserire eventi, regole o liquidazioni.

## Utenti e accessi

- **Configurazione iniziale**: crea il primo utente back office.
- **Impostazioni** (menu back office): altri utenti back office, disattivazione, cambio password.
- **Accesso di un segnalatore**: Segnalatori → Modifica anagrafica → "Password di accesso". Il segnalatore entra con la propria email. Un segnalatore "non attivo" non può accedere; l'accesso si può anche revocare.

## Schermate

**Back office**

| Pagina | Cosa mostra |
|---|---|
| Cruscotto | Indicatori generali, stato delle opportunità (imbuto), ultimi eventi, tabella riassuntiva per segnalatore. |
| Segnalatori | Anagrafica con tipologia, contatti, stato, accesso al portale. Dettaglio: portafoglio clienti, segnalazioni, provvigioni. |
| Clienti | Elenco clienti con segnalatore di riferimento. Inserimento con controllo duplicati. |
| Opportunità | Elenco con filtri. Dettaglio con timeline degli eventi e inserimento di eventi di follow-up. |
| Provvigioni | Report periodico (anno/mese/segnalatore) con liquidazione, e tabella delle regole di calcolo. |
| Tipologie | Tipologie di segnalatore e di opportunità. |
| Impostazioni | Utenti back office e segnalatori con accesso. |

**Segnalatore**

| Pagina | Cosa mostra |
|---|---|
| La mia situazione | Portafoglio, segnalazioni, provvigioni maturate/liquidate/da liquidare, riepilogo mensile, regole applicate. |
| I miei clienti | Solo i propri clienti, con inserimento e modifica. |
| Le mie segnalazioni | Solo le proprie opportunità con stato e ultimo evento (sola lettura sugli eventi). |
| Le mie provvigioni | Report periodico delle proprie provvigioni. |

La cartella `screenshots/` contiene le immagini del prototipo originale; le schermate sono le stesse, a parte la barra laterale (login reale al posto del selettore "Accesso come").

## Regole implementate

- **Cliente**: entra nel portafoglio del segnalatore che lo inserisce. Prima del salvataggio si verifica che non esista già: stessa P.IVA blocca l'inserimento; stessa email o ragione sociale simile mostra un avviso con il nome del segnalatore che lo ha già in portafoglio, superabile con una seconda conferma.
- **Opportunità**: legata a un cliente, a un segnalatore e a una tipologia. Alla creazione viene registrato l'evento "Segnalazione".
- **Eventi di follow-up** (inseriti dall'azienda): Contatto, Incontro, Offerta, Contratto, Consegna, Pagamento, Persa. Lo stato dell'opportunità è dato dall'evento più avanzato; "Persa" chiude l'opportunità. Offerta, Contratto e Pagamento portano un importo.
- **Tabella provvigioni**: ogni regola indica tipologia segnalatore (o qualsiasi), tipologia opportunità (o qualsiasi), percentuale, importo fisso e l'evento che fa maturare la provvigione. Si applica la regola più specifica: prima quella con entrambe le tipologie, poi quella con la sola tipologia segnalatore, poi con la sola tipologia opportunità, infine la regola base.
- **Calcolo**: per ogni evento "maturante" con importo si genera una riga di provvigione = importo × percentuale, più l'importo fisso una sola volta per opportunità. I pagamenti parziali generano quindi più righe. Le righe possono essere segnate come liquidate, singolarmente o per periodo.

## API (riassunto)

Tutte le risposte sono JSON; le richieste che modificano dati devono avere `Content-Type: application/json`.

| Metodo e percorso | Ruolo | Descrizione |
|---|---|---|
| `GET /api/me` | — | Utente corrente, flag configurazione iniziale |
| `POST /api/setup` | — | Solo al primo avvio: crea l'amministratore |
| `POST /api/login`, `POST /api/logout`, `POST /api/password` | tutti | Autenticazione |
| `GET /api/state` | tutti | Tutti i dati visibili al ruolo (il segnalatore riceve solo i propri) |
| `POST/PUT/DELETE /api/segnalatori[/:id]` | admin | Anagrafica; `password` abilita l'accesso, `revocaAccesso` lo toglie |
| `POST/PUT /api/clienti[/:id]`, `DELETE` | tutti / admin | `forza: true` conferma un possibile duplicato (409 con `duplicati`) |
| `POST /api/opportunita`, `PUT/DELETE /:id` | tutti / admin | Il segnalatore può creare solo su propri clienti |
| `POST /api/opportunita/:id/eventi`, `DELETE /api/eventi/:id` | admin | Eventi di follow-up |
| `POST /api/liquidazioni`, `DELETE /api/liquidazioni/:eventoId` | admin | `eventoIds`, `data`, `nota` |
| `POST/PUT/DELETE /api/regole[/:id]` | admin | Regole provvigionali |
| `POST/PUT/DELETE /api/tipologie/(segnalatore|opportunita)[/:id]` | admin | Tipologie |
| `GET/POST/PUT /api/utenti[/:id]` | admin | Utenti back office |

## Modello dati

```
tipologieSegnalatore   id, nome, descr
tipologieOpportunita   id, nome, descr
segnalatori            id, nome, tipologiaId, email, telefono, piva, citta, attivo, dataInizio, note
clienti                id, ragioneSociale, piva, email, telefono, citta, segnalatoreId, dataInserimento, note
opportunita            id, clienteId, segnalatoreId, tipologiaId, titolo, descr, valoreStimato, dataSegnalazione
eventi                 id, opportunitaId, tipo, data, importo, note
regole                 id, tipSegId, tipOppId, perc, fisso, maturaSu, descr
liquidazioni           eventoId, data, nota
users                  id, email, passwordHash, ruolo (admin|segnalatore), segnalatoreId, nome, attivo
sessions               id, userId, createdAt, expiresAt
```

## Possibili sviluppi

- Notifiche email al segnalatore sui cambi di stato.
- Esportazione del report provvigioni (CSV/PDF).
- Recupero password via email (oggi la password la reimposta il back office).
- Allegati (mandati, contratti) sulle anagrafiche.
