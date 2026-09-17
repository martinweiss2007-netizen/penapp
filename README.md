# PenApp ⚽

Web app que te avisa (notificación del navegador + sonido) apenas empieza una tanda de penales en un partido de fútbol en vivo, y te muestra el progreso tiro a tiro.

## Cómo funciona

- **`backend/`**: servidor Node/Express que consulta [API-Football](https://www.api-football.com/) por partidos en vivo (incluye ligas europeas, Libertadores, Sudamericana, Copa Argentina y cientos de competencias más), detecta cuándo un partido entra en tanda de penales y transmite los eventos por WebSocket. También sirve la web estática.
- **`frontend/`**: web (HTML/CSS/JS puro, sin build) que se conecta al WebSocket, muestra los partidos en vivo y las tandas activas, y dispara notificaciones del navegador + un sonido cuando arranca una tanda (y opcionalmente en cada penal ejecutado).

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
3. Abrí el navegador en `http://localhost:3001` (el mismo servidor sirve la web).
4. Tocá **"🔔 Activar avisos"** para habilitar las notificaciones del navegador. Listo: la app queda escuchando partidos en vivo y te avisa apenas arranca una tanda de penales.

### Desarrollo con frontend separado

Si preferís servir el frontend con otra herramienta (Vite, Live Server, etc.), abrí `frontend/index.html` y usá el ⚙️ de la web para apuntar la URL del backend (por ejemplo `ws://localhost:3001`); queda guardada en el navegador.

## Notas

- Las notificaciones del navegador requieren HTTPS en producción (localhost funciona sin HTTPS).
- El plan gratis de API-Football tiene un tope de **100 consultas/día**. Por eso el backend consulta cada 3 minutos (`POLL_INTERVAL` en `backend/server.js`) en vez de cada pocos segundos — así el cupo alcanza para varias horas seguidas de partido. Esto significa que el aviso puede demorar hasta ~3 minutos desde que arranca la tanda, no es instantáneo al segundo.
- En Render (plan free), la instancia se "duerme" tras un rato sin visitas y tarda ~50s en despertar. Conviene abrir la web un rato antes de que arranque el partido que te interesa.
