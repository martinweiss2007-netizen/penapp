# PenApp ⚽

Web app que te avisa (notificación del navegador + sonido) apenas empieza una tanda de penales en un partido de fútbol en vivo, y te muestra el progreso tiro a tiro.

## Cómo funciona

- **`backend/`**: servidor Node/Express que cada 30 segundos consulta [API-Football](https://rapidapi.com/api-sports/api/api-football) por partidos en vivo, detecta cuándo un partido entra en tanda de penales y transmite los eventos por WebSocket. También sirve la web estática.
- **`frontend/`**: web (HTML/CSS/JS puro, sin build) que se conecta al WebSocket, muestra los partidos en vivo y las tandas activas, y dispara notificaciones del navegador + un sonido cuando arranca una tanda (y opcionalmente en cada penal ejecutado).

## Puesta en marcha

1. Conseguí una API key gratuita de API-Football en RapidAPI: https://rapidapi.com/api-sports/api/api-football
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
- El plan gratuito de API-Football tiene límite de requests/día; `POLL_INTERVAL` en `backend/server.js` controla la frecuencia de sondeo.
