(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const connStatus = $('connStatus');
  const notifyBtn = $('notifyBtn');
  const settingsBtn = $('settingsBtn');
  const settingsPanel = $('settingsPanel');
  const backendUrlInput = $('backendUrl');
  const saveSettingsBtn = $('saveSettings');
  const soundToggle = $('soundToggle');
  const everyKickToggle = $('everyKickToggle');
  const banner = $('banner');
  const shootoutSection = $('shootoutSection');
  const shootoutList = $('shootoutList');
  const liveList = $('liveList');
  const liveCount = $('liveCount');

  // ─── AJUSTES PERSISTIDOS ──────────────────────────────
  const defaultWsUrl = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Si la web se sirve desde el propio backend, usamos el mismo host.
    if (location.port === '3001' || location.hostname !== 'localhost') {
      return `${proto}//${location.host}`;
    }
    return `${proto}//localhost:3001`;
  };

  const settings = {
    wsUrl: localStorage.getItem('penapp.wsUrl') || defaultWsUrl(),
    sound: localStorage.getItem('penapp.sound') !== 'false',
    everyKick: localStorage.getItem('penapp.everyKick') === 'true',
  };

  backendUrlInput.value = settings.wsUrl;
  soundToggle.checked = settings.sound;
  everyKickToggle.checked = settings.everyKick;

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  saveSettingsBtn.addEventListener('click', () => {
    settings.wsUrl = backendUrlInput.value.trim() || defaultWsUrl();
    localStorage.setItem('penapp.wsUrl', settings.wsUrl);
    settingsPanel.classList.add('hidden');
    connect();
  });

  soundToggle.addEventListener('change', () => {
    settings.sound = soundToggle.checked;
    localStorage.setItem('penapp.sound', String(settings.sound));
  });

  everyKickToggle.addEventListener('change', () => {
    settings.everyKick = everyKickToggle.checked;
    localStorage.setItem('penapp.everyKick', String(settings.everyKick));
  });

  // ─── NOTIFICACIONES DEL NAVEGADOR ─────────────────────
  function updateNotifyBtn() {
    if (!('Notification' in window)) {
      notifyBtn.textContent = '🔕 No soportado';
      notifyBtn.disabled = true;
      return;
    }
    if (Notification.permission === 'granted') {
      notifyBtn.textContent = '🔔 Avisos activados';
      notifyBtn.classList.remove('btn-primary');
      notifyBtn.classList.add('btn-ghost');
    } else if (Notification.permission === 'denied') {
      notifyBtn.textContent = '🔕 Avisos bloqueados';
      notifyBtn.disabled = true;
    } else {
      notifyBtn.textContent = '🔔 Activar avisos';
    }
  }

  notifyBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    updateNotifyBtn();
    if (perm === 'granted') {
      new Notification('PenApp', { body: 'Listo, te avisaremos apenas empiece una tanda de penales ⚽' });
    }
  });

  updateNotifyBtn();

  function notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, tag: title });
        n.onclick = () => window.focus();
      } catch (e) { /* algunos navegadores móviles no soportan new Notification() */ }
    }
  }

  // ─── SONIDO (WebAudio, sin archivos externos) ─────────
  let audioCtx = null;
  function beep(freq, duration, delay = 0) {
    if (!settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const start = audioCtx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch (e) { /* audio no disponible hasta interacción del usuario */ }
  }

  function playAlertSound() {
    beep(880, 0.18, 0);
    beep(880, 0.18, 0.25);
    beep(1175, 0.25, 0.5);
  }

  function playTickSound() {
    beep(600, 0.1, 0);
  }

  // Desbloquear audio en el primer click (requerido por navegadores).
  document.addEventListener('click', () => {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
  }, { once: true });

  // ─── BANNER VISUAL ─────────────────────────────────────
  let bannerTimeout = null;
  function showBanner(text) {
    banner.textContent = '';
    const span = document.createElement('span');
    span.textContent = text;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => banner.classList.add('hidden'));
    banner.appendChild(span);
    banner.appendChild(closeBtn);
    banner.classList.remove('hidden');
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => banner.classList.add('hidden'), 12000);
  }

  // ─── RENDER ────────────────────────────────────────────
  function penDots(pens) {
    const wrap = document.createElement('div');
    wrap.className = 'pen-dots';
    pens.forEach((r) => {
      const dot = document.createElement('span');
      dot.className = `pen-dot ${r === 'goal' ? 'goal' : 'miss'}`;
      wrap.appendChild(dot);
    });
    return wrap;
  }

  function teamEl(name, logo, cls) {
    const div = document.createElement('div');
    div.className = `team ${cls}`;
    if (logo) {
      const img = document.createElement('img');
      img.src = logo;
      img.alt = '';
      div.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = name;
    div.appendChild(span);
    return div;
  }

  function buildMatchCard(m, isShootout) {
    const card = document.createElement('div');
    card.className = `card ${isShootout ? 'card-shootout' : ''}`;

    const header = document.createElement('div');
    header.className = 'match-header';
    const comp = document.createElement('span');
    comp.textContent = m.competition || '';
    const badge = document.createElement('span');
    badge.className = 'badge-live';
    badge.textContent = isShootout ? 'PENALES' : `EN VIVO ${m.minute || ''}`;
    header.appendChild(comp);
    header.appendChild(badge);
    card.appendChild(header);

    const teams = document.createElement('div');
    teams.className = 'match-teams';
    teams.appendChild(teamEl(m.home, m.homeLogo, 'home'));
    const score = document.createElement('div');
    score.className = 'score';
    score.textContent = `${m.homeScore} - ${m.awayScore}`;
    teams.appendChild(score);
    teams.appendChild(teamEl(m.away, m.awayLogo, 'away'));
    card.appendChild(teams);

    if (isShootout) {
      const penRow = document.createElement('div');
      penRow.className = 'pen-row';
      penRow.appendChild(penDots(m.homePens || []));
      const penScore = document.createElement('div');
      penScore.className = 'pen-score';
      const ph = m.homePens ? m.homePens.filter((r) => r === 'goal').length : 0;
      const pa = m.awayPens ? m.awayPens.filter((r) => r === 'goal').length : 0;
      penScore.textContent = `Penales ${ph} - ${pa}`;
      penRow.appendChild(penScore);
      penRow.appendChild(penDots(m.awayPens || []));
      card.appendChild(penRow);
    }

    return card;
  }

  function render(fixtures) {
    const shootouts = fixtures.filter((f) => f.status === 'shootout');
    const others = fixtures.filter((f) => f.status !== 'shootout');

    shootoutSection.classList.toggle('hidden', shootouts.length === 0);
    shootoutList.innerHTML = '';
    shootouts.forEach((m) => shootoutList.appendChild(buildMatchCard(m, true)));

    liveCount.textContent = String(fixtures.length);
    liveList.innerHTML = '';
    if (others.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-state';
      p.textContent = fixtures.length === 0
        ? 'No hay partidos en vivo en este momento.'
        : 'Todos los partidos en vivo están en tanda de penales 👆';
      liveList.appendChild(p);
    } else {
      others.forEach((m) => liveList.appendChild(buildMatchCard(m, false)));
    }
  }

  // ─── WEBSOCKET ─────────────────────────────────────────
  let ws = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 15000;

  function setStatus(state, label) {
    connStatus.className = `status status-${state}`;
    connStatus.innerHTML = `<span class="dot"></span> ${label}`;
  }

  function connect() {
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    setStatus('connecting', 'Conectando…');

    try {
      ws = new WebSocket(settings.wsUrl);
    } catch (e) {
      setStatus('disconnected', 'URL inválida');
      return;
    }

    ws.onopen = () => {
      setStatus('connected', 'Conectado');
      reconnectDelay = 1000;
    };

    ws.onclose = () => {
      setStatus('disconnected', 'Sin conexión — reintentando…');
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      handleMessage(data);
    };
  }

  function handleMessage(data) {
    switch (data.type) {
      case 'FEED_UPDATE':
        render(data.fixtures || []);
        break;
      case 'SHOOTOUT_START': {
        const m = data.fixture;
        const text = `🚨 ¡Arrancó la tanda de penales! ${m.home} vs ${m.away}`;
        showBanner(text);
        notify('🚨 Tanda de penales', `${m.home} vs ${m.away} — ${m.competition || ''}`);
        playAlertSound();
        break;
      }
      case 'NEW_PENALTY': {
        const m = data.fixture;
        const p = data.penalty;
        if (settings.everyKick) {
          const result = p.result === 'goal' ? 'convirtió ⚽' : 'falló ❌';
          notify('Penal ejecutado', `${p.team} ${result} — ${m.home} vs ${m.away}`);
        }
        playTickSound();
        break;
      }
      default:
        break;
    }
  }

  connect();
})();
