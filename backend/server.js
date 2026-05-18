const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── CONFIG ────────────────────────────────────────────
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_HOST = 'api-football-v1.p.rapidapi.com';
const POLL_INTERVAL = '*/30 * * * * *'; // cada 30 segundos

// ─── ESTADO EN MEMORIA ─────────────────────────────────
// Guarda el estado de cada partido en vivo para detectar cambios
const fixtureCache = new Map();
// Partidos que ya notificamos como "tanda iniciada"
const notifiedShootouts = new Set();

// ─── BROADCAST A TODOS LOS CLIENTES WS ────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ─── LLAMADA A API-FOOTBALL ───────────────────────────
async function fetchLiveFixtures() {
  if (!API_KEY) {
    console.error('❌ API_FOOTBALL_KEY no configurada en variables de entorno');
    return null;
  }
  try {
    const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures', {
      params: { live: 'all' },
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': API_HOST,
      },
      timeout: 10000,
    });
    return res.data.response;
  } catch (err) {
    console.error('Error API-Football:', err.message);
    return null;
  }
}

async function fetchFixtureEvents(fixtureId) {
  try {
    const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures/events', {
      params: { fixture: fixtureId },
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': API_HOST,
      },
      timeout: 10000,
    });
    return res.data.response;
  } catch (err) {
    console.error(`Error eventos fixture ${fixtureId}:`, err.message);
    return [];
  }
}

// ─── PROCESAR FIXTURES EN VIVO ─────────────────────────
async function processLiveFixtures() {
  console.log(`[${new Date().toISOString()}] Polling API-Football...`);

  const fixtures = await fetchLiveFixtures();
  if (!fixtures) return;

  const liveData = [];

  for (const fixture of fixtures) {
    const id = fixture.fixture.id;
    const status = fixture.fixture.status.short;
    const elapsed = fixture.fixture.status.elapsed;

    const matchData = {
      id,
      competition: `${fixture.league.name} · ${fixture.league.country}`,
      leagueLogo: fixture.league.logo,
      teams: `${fixture.teams.home.name} vs ${fixture.teams.away.name}`,
      home: fixture.teams.home.name,
      away: fixture.teams.away.name,
      homeLogo: fixture.teams.home.logo,
      awayLogo: fixture.teams.away.logo,
      homeScore: fixture.goals.home ?? 0,
      awayScore: fixture.goals.away ?? 0,
      minute: elapsed ? `${elapsed}'` : status,
      status: 'live',
      homePens: [],
      awayPens: [],
      penHomeScore: fixture.score?.penalty?.home ?? null,
      penAwayScore: fixture.score?.penalty?.away ?? null,
    };

    // Detectar si hay tanda de penales activa
    const isShootout = status === 'P' ||
      (fixture.score?.penalty?.home !== null && fixture.score?.penalty?.home !== undefined);

    if (isShootout) {
      matchData.status = 'shootout';

      // Buscar eventos de la tanda
      const events = await fetchFixtureEvents(id);
      const penEvents = events.filter(e =>
        e.type === 'pen_shootout_goal' || e.type === 'pen_shootout_miss'
      );

      // Separar por equipo
      penEvents.forEach(ev => {
        const isHome = ev.team.id === fixture.teams.home.id;
        const result = ev.type === 'pen_shootout_goal' ? 'goal' : 'miss';
        if (isHome) matchData.homePens.push(result);
        else matchData.awayPens.push(result);
      });

      // Si es la primera vez que detectamos esta tanda, notificar
      if (!notifiedShootouts.has(id)) {
        notifiedShootouts.add(id);
        console.log(`🚨 TANDA DETECTADA: ${matchData.teams}`);
        broadcast({
          type: 'SHOOTOUT_START',
          fixture: matchData,
        });
      }

      // Detectar nuevos tiros respecto al cache anterior
      const prev = fixtureCache.get(id);
      if (prev) {
        const prevTotal = prev.homePens.length + prev.awayPens.length;
        const currTotal = matchData.homePens.length + matchData.awayPens.length;
        if (currTotal > prevTotal) {
          // Nuevo tiro
          const lastHome = matchData.homePens[matchData.homePens.length - 1];
          const lastAway = matchData.awayPens[matchData.awayPens.length - 1];
          const lastResult = lastHome !== prev.homePens[prev.homePens.length - 1]
            ? { team: matchData.home, result: lastHome }
            : { team: matchData.away, result: lastAway };

          broadcast({
            type: 'NEW_PENALTY',
            fixture: matchData,
            penalty: lastResult,
          });
        }
      }
    }

    fixtureCache.set(id, matchData);
    liveData.push(matchData);
  }

  // Broadcast del estado completo del feed
  broadcast({
    type: 'FEED_UPDATE',
    fixtures: liveData,
    timestamp: Date.now(),
  });

  // Limpiar fixtures que ya no están en vivo
  for (const [cachedId] of fixtureCache) {
    if (!fixtures.find(f => f.fixture.id === cachedId)) {
      fixtureCache.delete(cachedId);
      notifiedShootouts.delete(cachedId);
    }
  }

  console.log(`✅ ${fixtures.length} partidos en vivo, ${liveData.filter(f => f.status === 'shootout').length} tandas activas`);
}

// ─── WEBSOCKET ─────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('Cliente conectado');

  // Enviar estado actual al conectarse
  const currentState = Array.from(fixtureCache.values());
  ws.send(JSON.stringify({
    type: 'FEED_UPDATE',
    fixtures: currentState,
    timestamp: Date.now(),
  }));

  ws.on('close', () => console.log('Cliente desconectado'));
});

// ─── RUTAS REST (para debug / healthcheck) ─────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    liveFixtures: fixtureCache.size,
    activeShootouts: Array.from(fixtureCache.values()).filter(f => f.status === 'shootout').length,
    apiKeyConfigured: !!API_KEY,
    timestamp: new Date().toISOString(),
  });
});

app.get('/fixtures', (req, res) => {
  res.json(Array.from(fixtureCache.values()));
});

// ─── ARRANCAR ──────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🟢 PenApp backend corriendo en puerto ${PORT}`);
  console.log(`📡 WebSocket listo`);
  console.log(`🔑 API Key: ${API_KEY ? '✅ configurada' : '❌ FALTA API_FOOTBALL_KEY'}\n`);

  // Primer poll inmediato
  processLiveFixtures();

  // Polling cada 30 segundos
  cron.schedule(POLL_INTERVAL, processLiveFixtures);
});
