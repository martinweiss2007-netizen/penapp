const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Sirve la web (frontend/) desde el mismo servidor.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── CONFIG ────────────────────────────────────────────
const API_KEY = process.env.FOOTBALL_DATA_KEY;
const API_BASE = 'https://api.football-data.org/v4';
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

// ─── LLAMADA A FOOTBALL-DATA.ORG ───────────────────────
async function fetchLiveMatches() {
  if (!API_KEY) {
    console.error('❌ FOOTBALL_DATA_KEY no configurada en variables de entorno');
    return null;
  }
  try {
    const res = await axios.get(`${API_BASE}/matches`, {
      params: { status: 'LIVE' },
      headers: { 'X-Auth-Token': API_KEY },
      timeout: 10000,
    });
    return res.data.matches;
  } catch (err) {
    console.error('Error football-data.org:', err.message);
    return null;
  }
}

// ─── PROCESAR PARTIDOS EN VIVO ─────────────────────────
async function processLiveFixtures() {
  console.log(`[${new Date().toISOString()}] Polling football-data.org...`);

  const matches = await fetchLiveMatches();
  if (!matches) return;

  const liveData = [];

  for (const match of matches) {
    const id = match.id;
    const isShootout = match.score?.duration === 'PENALTY_SHOOTOUT';
    const penHome = match.score?.penalties?.home;
    const penAway = match.score?.penalties?.away;

    const matchData = {
      id,
      competition: match.competition?.name || '',
      leagueLogo: match.competition?.emblem || null,
      teams: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
      home: match.homeTeam.name,
      away: match.awayTeam.name,
      homeLogo: match.homeTeam.crest || null,
      awayLogo: match.awayTeam.crest || null,
      homeScore: match.score?.fullTime?.home ?? 0,
      awayScore: match.score?.fullTime?.away ?? 0,
      minute: match.status === 'PAUSED' ? 'Entretiempo' : 'En vivo',
      status: isShootout ? 'shootout' : 'live',
      // football-data.org solo da el marcador acumulado de penales convertidos,
      // no el detalle tiro a tiro (goal/miss) de cada ejecución.
      homePens: penHome != null ? Array(penHome).fill('goal') : [],
      awayPens: penAway != null ? Array(penAway).fill('goal') : [],
    };

    if (isShootout) {
      // Si es la primera vez que detectamos esta tanda, notificar
      if (!notifiedShootouts.has(id)) {
        notifiedShootouts.add(id);
        console.log(`🚨 TANDA DETECTADA: ${matchData.teams}`);
        broadcast({
          type: 'SHOOTOUT_START',
          fixture: matchData,
        });
      }

      // Detectar nuevos penales convertidos respecto al cache anterior
      const prev = fixtureCache.get(id);
      if (prev) {
        const prevTotal = prev.homePens.length + prev.awayPens.length;
        const currTotal = matchData.homePens.length + matchData.awayPens.length;
        if (currTotal > prevTotal) {
          const team = matchData.homePens.length > prev.homePens.length ? matchData.home : matchData.away;
          broadcast({
            type: 'NEW_PENALTY',
            fixture: matchData,
            penalty: { team, result: 'goal' },
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

  // Limpiar partidos que ya no están en vivo
  for (const [cachedId] of fixtureCache) {
    if (!matches.find((m) => m.id === cachedId)) {
      fixtureCache.delete(cachedId);
      notifiedShootouts.delete(cachedId);
    }
  }

  console.log(`✅ ${matches.length} partidos en vivo, ${liveData.filter((f) => f.status === 'shootout').length} tandas activas`);
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
  console.log(`🔑 API Key: ${API_KEY ? '✅ configurada' : '❌ FALTA FOOTBALL_DATA_KEY'}\n`);

  // Primer poll inmediato
  processLiveFixtures();

  // Polling cada 30 segundos
  cron.schedule(POLL_INTERVAL, processLiveFixtures);
});
