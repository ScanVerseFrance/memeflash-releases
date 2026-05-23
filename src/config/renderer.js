'use strict';

const { ipcRenderer } = require('electron');

// ─── Éléments ─────────────────────────────────────────────────────────────────
const avatarEl      = document.getElementById('avatar-el');
const usernameEl    = document.getElementById('username-el');
const tokenPreview  = document.getElementById('token-preview');
const channelDisplay= document.getElementById('channel-display');
const btnDisconnect = document.getElementById('btn-disconnect');
const btnReconfig   = document.getElementById('btn-reconfig');

const volSlider  = document.getElementById('vol');
const volLbl     = document.getElementById('vol-lbl');
const durSlider  = document.getElementById('dur');
const durLbl     = document.getElementById('dur-lbl');
const chkAnnounce= document.getElementById('chk-announce');
const chkRandom  = document.getElementById('chk-random');
const posGrid    = document.getElementById('pos-grid');
const btnSave    = document.getElementById('btn-save');

const acToken     = document.getElementById('ac-token');
const acChannel   = document.getElementById('ac-channel');
const acDiscordId = document.getElementById('ac-discord-id');
const btnConnect  = document.getElementById('btn-connect');
const btnShowTok  = document.getElementById('btn-show-token');
const btnTest     = document.getElementById('btn-test');
const sdot        = document.getElementById('sdot');
const statusText  = document.getElementById('status-text');
const historyList = document.getElementById('history-list');

// ─── SVG inline icons ─────────────────────────────────────────────────────────
const EYE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const VID_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;

// ─── Liens externes (ouvre dans le navigateur) ────────────────────────────────
const { shell } = require('electron');
document.querySelectorAll('.ext-link').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); shell.openExternal(a.href); });
});

// ─── Navigation entre onglets ─────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`page-${tab.dataset.tab}`).classList.add('active');
  });
});

// ─── Charger config au démarrage ─────────────────────────────────────────────
ipcRenderer.send('get-all-settings');

ipcRenderer.on('all-settings', (_e, s) => {
  volSlider.value = s.volume ?? 50;
  durSlider.value = s.imageDuration ?? 8;
  updateSlider(volSlider, `${volSlider.value}%`, volLbl);
  updateSlider(durSlider, `${durSlider.value}s`, durLbl);

  chkAnnounce.checked = s.announceSound ?? false;
  chkRandom.checked   = s.randomPosition ?? false;
  togglePositionGrid(s.randomPosition);

  setActivePos(s.selectedPosition ?? 'top');

  acToken.value   = s.token     ?? '';
  acChannel.value = s.channelId ?? '';
  if (acDiscordId) acDiscordId.value = s.discordUserId ?? '';
  channelDisplay.textContent = s.channelId ? `#${s.channelId}` : '—';

  if (s.token) {
    tokenPreview.textContent = `Token : ${s.token.slice(0, 10)}••••••••••`;
  }
});

// ─── Sliders ─────────────────────────────────────────────────────────────────
volSlider.addEventListener('input', () =>
  updateSlider(volSlider, `${volSlider.value}%`, volLbl)
);
durSlider.addEventListener('input', () =>
  updateSlider(durSlider, `${durSlider.value}s`, durLbl)
);

function updateSlider(input, label, labelEl) {
  labelEl.textContent = label;
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.background = `linear-gradient(to right, #e05a28 ${pct}%, #333 ${pct}%)`;
}

// ─── Position aléatoire ───────────────────────────────────────────────────────
chkRandom.addEventListener('change', () => togglePositionGrid(chkRandom.checked));

function togglePositionGrid(disabled) {
  document.querySelectorAll('.pos-btn').forEach(b => { b.disabled = disabled; });
}

// ─── Boutons de position ─────────────────────────────────────────────────────
posGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.pos-btn');
  if (!btn || btn.disabled) return;
  setActivePos(btn.dataset.pos);
});

function setActivePos(pos) {
  document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
  const target = document.querySelector(`.pos-btn[data-pos="${pos}"]`);
  if (target) target.classList.add('active');
}

// ─── Sauvegarder réglages ─────────────────────────────────────────────────────
btnSave.addEventListener('click', () => {
  const pos = document.querySelector('.pos-btn.active')?.dataset.pos ?? 'top';
  ipcRenderer.send('save-settings', {
    volume:          parseInt(volSlider.value, 10),
    imageDuration:   parseInt(durSlider.value, 10),
    announceSound:   chkAnnounce.checked,
    randomPosition:  chkRandom.checked,
    selectedPosition: pos,
  });
  btnSave.textContent = '✓ Sauvegardé';
  setTimeout(() => { btnSave.textContent = 'Sauvegarder'; }, 1500);
});

// ─── Déconnexion ─────────────────────────────────────────────────────────────
btnDisconnect.addEventListener('click', () => ipcRenderer.send('stop-bot'));

// ─── Reconfigurer (→ onglet Compte) ──────────────────────────────────────────
btnReconfig.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="account"]').classList.add('active');
  document.getElementById('page-account').classList.add('active');
});

// ─── Afficher/masquer token ────────────────────────────────────────────────────
btnShowTok.addEventListener('click', () => {
  const hidden = acToken.type === 'password';
  acToken.type = hidden ? 'text' : 'password';
  btnShowTok.innerHTML = hidden ? `${EYE_OFF} Masquer` : `${EYE_ICON} Afficher`;
});

// ─── Test overlay ─────────────────────────────────────────────────────────────
btnTest.addEventListener('click', () => ipcRenderer.send('test-overlay'));

// ─── Connexion depuis onglet Compte ───────────────────────────────────────────
btnConnect.addEventListener('click', () => {
  const token     = acToken.value.trim();
  const channelId = acChannel.value.trim();
  if (!token || !channelId) {
    setStatus('Remplis le token et le Channel ID !', 'error');
    return;
  }
  setStatus('Connexion en cours…', 'loading');
  btnConnect.disabled = true;
  ipcRenderer.send('save-credentials', {
    token,
    channelId,
    discordUserId: acDiscordId ? acDiscordId.value.trim() : '',
  });
});

// ─── Réception du statut bot ──────────────────────────────────────────────────
ipcRenderer.on('bot-status', (_e, s) => {
  btnConnect.disabled = false;
  if (s.connected) {
    setStatus(`Connecté : ${s.tag}`, 'online');
    usernameEl.textContent = s.tag;
    avatarEl.textContent   = s.tag[0].toUpperCase();
    channelDisplay.textContent = `#${acChannel.value || '—'}`;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="settings"]').classList.add('active');
    document.getElementById('page-settings').classList.add('active');
  } else {
    setStatus(s.error || 'Déconnecté', 'error');
    usernameEl.textContent = 'Non connecté';
    avatarEl.textContent   = '?';
  }
});

function setStatus(text, state) {
  statusText.textContent = text;
  sdot.className = 'sdot';
  if (state) sdot.classList.add(state);
}

// ─── Historique ───────────────────────────────────────────────────────────────
ipcRenderer.on('history-update', (_e, items) => {
  if (!items.length) {
    historyList.innerHTML = '<div class="empty-state">Aucun média reçu pour le moment</div>';
    return;
  }
  historyList.innerHTML = items.map(item => {
    const time      = relativeTime(new Date(item.timestamp));
    const typeLabel = item.type === 'video' ? 'Vidéo' : item.type === 'gif' ? 'GIF' : 'Image';
    const thumb     = item.type !== 'video'
      ? `<img class="history-thumb" src="${escAttr(item.url)}" alt="" onerror="this.style.opacity=0" />`
      : `<div class="history-thumb" style="display:flex;align-items:center;justify-content:center;">${VID_ICON}</div>`;
    return `
      <div class="history-item">
        ${thumb}
        <div class="h-info">
          <div class="h-author">${escHtml(item.author)}</div>
          <div class="h-time">${time}</div>
        </div>
        <span class="h-type">${typeLabel}</span>
      </div>`;
  }).join('');
});

// ─── Auto-updater ────────────────────────────────────────────────────────────
const updateBanner = document.getElementById('update-banner');
const updText      = document.getElementById('upd-text');
const updBtn       = document.getElementById('upd-btn');
const updBar       = document.getElementById('upd-bar');
let   updVersion   = '';

ipcRenderer.on('update-available', (_e, version) => {
  updVersion = version;
  updText.textContent = `Mise à jour v${version} — téléchargement…`;
  updateBanner.classList.add('visible');
  updBtn.style.display = 'none';
  if (updBar) { updBar.style.display = 'block'; updBar.value = 0; }
});

ipcRenderer.on('download-progress', (_e, percent) => {
  updText.textContent = `Mise à jour v${updVersion} — ${percent}%`;
  if (updBar) updBar.value = percent;
});

ipcRenderer.on('update-downloaded', () => {
  updText.textContent = `v${updVersion} prête — cliquez pour installer`;
  if (updBar) updBar.style.display = 'none';
  updBtn.style.display = '';
  updBtn.disabled = false;
  updateBanner.classList.add('visible');
});

updBtn.addEventListener('click', () => ipcRenderer.send('install-update'));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function relativeTime(date) {
  const diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 60) return 'Il y a quelques secondes';
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  return `Il y a ${Math.floor(diff / 3600)} h`;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
