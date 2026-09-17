const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json());

// Sirve la web (frontend/) desde el mismo servidor.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── CONFIG ────────────────────────────────────────────
// Clave del alta directa en dashboard.api-football.com (NO es una clave de RapidAPI).
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = 'https://v3.football.api-sports.io';
// El plan gratis tiene un tope de 100 consultas/día: con este intervalo,
// una noche entera de partido (~4h) consume ~80, dejando margen.
const POLL_INTERVAL = '0 */3 * * * *'; // cada 3 minutos

// ─── ESTADO EN MEMORIA ─────────────────────────────────
// Guarda el estado de cada partido en vivo para detectar cambios
const fixtureCache = new Map();
// Partidos que ya notificamos como "tanda iniciada"
const notifiedShootouts = new Set();
// Suscripciones a notificaciones push (funcionan aunque la pestaña esté cerrada)
const pushSubscriptions = new Map(); // endpoint -> subscription

// ─── WEB PUSH (notificaciones aunque la app esté cerrada) ─
// Si no hay claves VAPID configuradas, se generan al arrancar (se pierden
// al reiniciar el servidor: conviene copiarlas como env vars permanentes,
// ver el log de arranque).
let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
};
if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  vapidKeys = webpush.generateVAPIDKeys();
  console.log('\n⚠️  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no configuradas: generé un par nuevo.');
  console.log('   Guardalas como variables de entorno para que las suscripciones no se pierdan al reiniciar:');
  console.log(`   VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`   VAPID_PRIVATE_KEY=${vapidKeys.privateKey}\n`);
}
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:penapp@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

async function sendPushToAll(payload) {
  const body = JSON.stringify(payload);
  for (const [endpoint, sub] of pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, body);
    } catch (err) {
      // Suscripción vencida o inválida: la sacamos de la lista.
      if (err.statusCode === 404 || err.statusCode === 410) {
        pushSubscriptions.delete(endpoint);
      } else {
        console.error('Error enviando push:', err.message);
      }
    }
  }
}

// ─── BROADCAST A TODOS LOS CLIENTES WS ────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ─── LLAMADAS A API-FOOTBALL ───────────────────────────
async function fetchLiveFixtures() {
  if (!API_KEY) {
    console.error('❌ API_FOOTBALL_KEY no configurada en variables de entorno');
    return null;
  }
  try {
    const res = await axios.get(`${API_BASE}/fixtures`, {
      params: { live: 'all' },
      headers: { 'x-apisports-key': API_KEY },
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
    const res = await axios.get(`${API_BASE}/fixtures/events`, {
      params: { fixture: fixtureId },
      headers: { 'x-apisports-key': API_KEY },
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
    };

    // Detectar si hay tanda de penales activa
    const isShootout = status === 'P' ||
      (fixture.score?.penalty?.home !== null && fixture.score?.penalty?.home !== undefined);

    if (isShootout) {
      matchData.status = 'shootout';

      // Buscar eventos de la tanda (solo se pide para partidos en tanda, para cuidar el cupo diario)
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
        sendPushToAll({
          title: '🚨 ¡Tanda de penales!',
          body: `${matchData.home} vs ${matchData.away} — ${matchData.competition}`,
          tag: `shootout-${id}`,
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

// ─── RUTAS DE NOTIFICACIONES PUSH ──────────────────────
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }
  pushSubscriptions.set(sub.endpoint, sub);
  console.log(`🔔 Nueva suscripción push (total: ${pushSubscriptions.size})`);
  res.status(201).json({ ok: true });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  pushSubscriptions.delete(endpoint);
  res.json({ ok: true });
});

// ─── ARRANCAR ──────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🟢 PenApp backend corriendo en puerto ${PORT}`);
  console.log(`📡 WebSocket listo`);
  console.log(`🔑 API Key: ${API_KEY ? '✅ configurada' : '❌ FALTA API_FOOTBALL_KEY'}\n`);

  // Primer poll inmediato
  processLiveFixtures();

  // Polling cada 3 minutos (cuida el cupo gratis de 100 consultas/día)
  cron.schedule(POLL_INTERVAL, processLiveFixtures);
});
