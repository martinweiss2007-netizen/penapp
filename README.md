# PenApp ⚽

Web app que te avisa (notificación del navegador + sonido) apenas empieza una tanda de penales en un partido de fútbol en vivo, y te muestra el marcador de penales en tiempo real.

## Cómo funciona

- **`backend/`**: servidor Node/Express que cada 30 segundos consulta [football-data.org](https://www.football-data.org/) por partidos en vivo, detecta cuándo un partido entra en tanda de penales y transmite los eventos por WebSocket. También sirve la web estática.
- **`frontend/`**: web (HTML/CSS/JS puro, sin build) que se conecta al WebSocket, muestra los partidos en vivo y las tandas activas, y dispara notificaciones del navegador + un sonido cuando arranca una tanda (y opcionalmente en cada penal convertido).

## Puesta en marcha

1. Conseguí una API key gratuita en https://www.football-data.org/client/register — solo pedís tu email y te la muestra al instante (sin marketplace, sin tarjeta).
2. Configurá el backend:
   ```bash
   cd backend
   cp .env.example .env
   # editá .env y pegá tu FOOTBALL_DATA_KEY
   npm install
   npm start
   ```
3. Abrí el navegador en `http://localhost:3001` (el mismo servidor sirve la web).
4. Tocá **"🔔 Activar avisos"** para habilitar las notificaciones del navegador. Listo: la app queda escuchando partidos en vivo y te avisa apenas arranca una tanda de penales.

### Desarrollo con frontend separado

Si preferís servir el frontend con otra herramienta (Vite, Live Server, etc.), abrí `frontend/index.html` y usá el ⚙️ de la web para apuntar la URL del backend (por ejemplo `ws://localhost:3001`); queda guardada en el navegador.

## Notas

- Las notificaciones del navegador requieren HTTPS en producción (localhost funciona sin HTTPS).
- El plan gratuito de football-data.org tiene límite de 10 requests/minuto y acceso a un subconjunto de competiciones (principales ligas europeas y torneos de selecciones); `POLL_INTERVAL` en `backend/server.js` controla la frecuencia de sondeo.
- Esta API solo informa el marcador acumulado de penales convertidos (no el detalle gol/atajada de cada ejecución individual), así que el círculo de cada penal en la web se muestra siempre en verde.
