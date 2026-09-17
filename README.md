# PenApp ⚽

Web app que te avisa (notificación push del sistema + sonido) apenas empieza una tanda de penales en un partido de fútbol en vivo, y te muestra el progreso tiro a tiro. Las notificaciones llegan aunque tengas la pestaña o el navegador cerrados.

## Cómo funciona

- **`backend/`**: servidor Node/Express que consulta [API-Football](https://www.api-football.com/) por partidos en vivo (incluye ligas europeas, Libertadores, Sudamericana, Copa Argentina y cientos de competencias más), detecta cuándo un partido entra en tanda de penales y transmite los eventos por WebSocket + notificaciones push. También sirve la web estática.
- **`frontend/`**: web (HTML/CSS/JS puro, sin build) que se conecta al WebSocket, muestra los partidos en vivo y las tandas activas, se suscribe a notificaciones push (vía service worker) y dispara un sonido cuando arranca una tanda (y opcionalmente en cada penal ejecutado).

## Puesta en marcha

1. Conseguí una API key gratuita con el alta **directa** (sin pasar por el marketplace de RapidAPI): https://dashboard.api-football.com/register — te registrás con tu email, sin tarjeta, y la clave queda visible en tu dashboard al instante.
2. Configurá el backend:
   ```bash
   cd backend
   cp .env.example .env
   # editá .env y pegá tu API_FOOTBALL_KEY
   npm install
   npm start
   ```
3. La primera vez que arranca, si no configuraste `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, el servidor genera un par nuevo y lo muestra en la consola. Copialos a tu `.env` (o a las variables de entorno de tu hosting) para que las suscripciones push no se pierdan cada vez que el servidor se reinicia.
4. Abrí el navegador en `http://localhost:3001` (el mismo servidor sirve la web).
5. Tocá **"🔔 Activar avisos"** y aceptá el permiso de notificaciones. Listo: la app queda escuchando partidos en vivo y te avisa apenas arranca una tanda de penales, aunque cierres la pestaña.

### Desarrollo con frontend separado

Si preferís servir el frontend con otra herramienta (Vite, Live Server, etc.), abrí `frontend/index.html` y usá el ⚙️ de la web para apuntar la URL del backend (por ejemplo `ws://localhost:3001`); queda guardada en el navegador.

## Notas

- Las notificaciones (tanto las del navegador como las push) requieren HTTPS en producción (localhost funciona sin HTTPS).
- El plan gratis de API-Football tiene un tope de **100 consultas/día**. Por eso el backend consulta cada 3 minutos (`POLL_INTERVAL` en `backend/server.js`) en vez de cada pocos segundos — así el cupo alcanza para varias horas seguidas de partido. Esto significa que el aviso puede demorar hasta ~3 minutos desde que arranca la tanda, no es instantáneo al segundo. Para bajar esa demora hace falta un plan pago de API-Football con más cupo diario.
- En Render (plan free), la instancia se "duerme" tras un rato sin visitas y tarda ~50s en despertar. Conviene abrir la web un rato antes de que arranque el partido que te interesa, así queda despierta y con la suscripción push renovada.
- Si el servidor se reinicia sin tener `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` fijas, las claves cambian y hay que volver a abrir la web una vez para que se resuscriba sola (la app lo hace automáticamente si ya le habías dado permiso antes).
