'use strict';

const { ipcRenderer, shell } = require('electron');

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
const btnSaveApp = document.getElementById('btn-save-app');

const chkHotkeys = document.getElementById('chk-hotkeys');

const chkObs       = document.getElementById('chk-obs');
const obsPortInput = document.getElementById('obs-port');
const obsUrlBox    = document.getElementById('obs-url-box');
const obsUrlEl     = document.getElementById('obs-url');

const themeGrid    = document.getElementById('theme-grid');
const sizeSlider   = document.getElementById('size');
const sizeLbl      = document.getElementById('size-lbl');
const animSelect   = document.getElementById('anim');
const chkStreamer  = document.getElementById('chk-streamer');
const chkStreamerNames   = document.getElementById('chk-streamer-names');
const chkStreamerAvatars = document.getElementById('chk-streamer-avatars');
const displaySelect= document.getElementById('display-select');

const snoozeDisplay= document.getElementById('snooze-display');
const snoozeText   = document.getElementById('snooze-text');
const chkSnoozeEv  = document.getElementById('chk-snooze-everyone');
const btnSnoozeCancel = document.getElementById('btn-snooze-cancel');
const cdSlider     = document.getElementById('cd');
const cdLbl        = document.getElementById('cd-lbl');
const chkAntiraid  = document.getElementById('chk-antiraid');
const blacklistChips = document.getElementById('blacklist-chips');
const keywordChips   = document.getElementById('keyword-chips');
const keywordInput   = document.getElementById('keyword-input');
const btnAddKeyword  = document.getElementById('btn-add-keyword');

const acToken      = document.getElementById('ac-token');
const acDiscordId  = document.getElementById('ac-discord-id');
const btnConnect   = document.getElementById('btn-connect');
const channelList  = document.getElementById('channel-list');
const btnAddCh     = document.getElementById('btn-add-channel');
const btnShowTok   = document.getElementById('btn-show-token');
const btnTest      = document.getElementById('btn-test');
const sdot         = document.getElementById('sdot');
const statusText   = document.getElementById('status-text');
const historyList  = document.getElementById('history-list');
const favoritesList= document.getElementById('favorites-list');
const statsList    = document.getElementById('stats-list');
const btnStatsReset= document.getElementById('btn-stats-reset');

// ─── SVG inline ───────────────────────────────────────────────────────────────
const VID_ICON  = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
const LINK_SVG  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
const STAR_SVG  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2"/></svg>`;
const BLOCK_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
const DISCORD_SVG = `<svg width="13" height="13" viewBox="0 -28.5 256 256" fill="currentColor"><path d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193A161.094 161.094 0 0 0 79.735 175.3a136.413 136.413 0 0 1-21.846-10.632 108.636 108.636 0 0 0 5.356-4.237c42.122 19.702 87.89 19.702 129.51 0a131.66 131.66 0 0 0 5.355 4.237 136.07 136.07 0 0 1-21.886 10.653c4.006 8.02 8.638 15.67 13.873 22.848 21.142-6.58 42.646-16.637 64.815-33.213 5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.804 23.015 26.2.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18s10.148-26.2 23.014-26.2c12.867 0 23.236 11.804 23.015 26.2 0 14.375-10.148 26.18-23.015 26.18Z"/></svg>`;
const REACTIONS = ['❤️','😂','🔥','💀','👀'];

// ─── Liens externes ──────────────────────────────────────────────────────────
document.querySelectorAll('.ext-link').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); shell.openExternal(a.href); });
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`page-${tab.dataset.tab}`).classList.add('active');
  });
});

// ─── Load settings ────────────────────────────────────────────────────────────
ipcRenderer.send('get-all-settings');

let currentHistory = [];
let currentFavorites = [];
let currentBlacklist = [];
let currentKeywords = [];

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
  if (acDiscordId) acDiscordId.value = s.discordUserId ?? '';
  channelList.innerHTML = '';
  const ids = s.channelIds?.length ? s.channelIds : [];
  if (ids.length) ids.forEach(id => addChannelEntry(id));
  else addChannelEntry();
  updateChannelDisplay();

  if (s.token) tokenPreview.textContent = `Token : ${s.token.slice(0, 10)}••••••••`;

  // Hotkeys
  chkHotkeys.checked = s.hotkeysEnabled ?? true;

  // OBS
  chkObs.checked = s.obsServerEnabled ?? false;
  obsPortInput.value = s.obsServerPort ?? 7777;
  updateObsUrlDisplay();

  // Apparence
  selectTheme(s.theme || 'orange');
  sizeSlider.value = Math.round((s.overlaySize ?? 1) * 100);
  updateSlider(sizeSlider, `${sizeSlider.value}%`, sizeLbl);
  animSelect.value = s.animation || 'pop';
  chkStreamer.checked = s.streamerMode ?? false;
  chkStreamerNames.checked   = s.streamerHideNames   ?? false;
  chkStreamerAvatars.checked = s.streamerBlurAvatars ?? false;

  // Filtres
  cdSlider.value = s.userCooldown ?? 0;
  updateSlider(cdSlider, `${cdSlider.value}s`, cdLbl);
  chkAntiraid.checked = s.antiRaid ?? false;
  chkSnoozeEv.checked = s.snoozeAllowEveryone ?? false;
  currentBlacklist = s.blacklistedUsers || [];
  currentKeywords  = s.blockedKeywords || [];
  renderBlacklist(); renderKeywords();
  updateSnoozeDisplay(s.snoozeUntil);

  // Favoris / Stats
  currentFavorites = s.favorites || [];
  renderFavorites();
  renderStats(s.stats || {});

  // Moniteurs
  loadDisplays(s.displayId ?? 0);
});

function loadDisplays(currentId) {
  ipcRenderer.invoke('get-displays').then(list => {
    displaySelect.innerHTML = list.map(d =>
      `<option value="${d.id}" ${d.id === currentId ? 'selected' : ''}>${d.label}</option>`
    ).join('');
  });
}

displaySelect.addEventListener('change', () => {
  ipcRenderer.send('set-display', parseInt(displaySelect.value, 10));
});

// ─── Sliders ─────────────────────────────────────────────────────────────────
volSlider.addEventListener('input', () => updateSlider(volSlider, `${volSlider.value}%`, volLbl));
durSlider.addEventListener('input', () => updateSlider(durSlider, `${durSlider.value}s`, durLbl));
sizeSlider.addEventListener('input', () => updateSlider(sizeSlider, `${sizeSlider.value}%`, sizeLbl));
cdSlider .addEventListener('input', () => updateSlider(cdSlider , `${cdSlider .value}s`, cdLbl ));

function updateSlider(input, label, labelEl) {
  labelEl.textContent = label;
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.background = `linear-gradient(to right, #e05a28 ${pct}%, #333 ${pct}%)`;
}

// ─── Position ────────────────────────────────────────────────────────────────
chkRandom.addEventListener('change', () => togglePositionGrid(chkRandom.checked));
function togglePositionGrid(disabled) {
  document.querySelectorAll('.pos-btn').forEach(b => { b.disabled = disabled; });
}
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

// ─── Thèmes ───────────────────────────────────────────────────────────────────
themeGrid.addEventListener('click', (e) => {
  const sw = e.target.closest('.theme-swatch');
  if (!sw) return;
  selectTheme(sw.dataset.theme);
  // Apply live
  ipcRenderer.send('save-settings', collectSettings());
});
function selectTheme(theme) {
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('selected', s.dataset.theme === theme));
}

// ─── Save ────────────────────────────────────────────────────────────────────
function collectSettings() {
  return {
    volume:            parseInt(volSlider.value, 10),
    imageDuration:     parseInt(durSlider.value, 10),
    announceSound:     chkAnnounce.checked,
    randomPosition:    chkRandom.checked,
    selectedPosition:  document.querySelector('.pos-btn.active')?.dataset.pos ?? 'top',
    userCooldown:      parseInt(cdSlider.value, 10),
    antiRaid:          chkAntiraid.checked,
    theme:             document.querySelector('.theme-swatch.selected')?.dataset.theme || 'orange',
    overlaySize:       parseInt(sizeSlider.value, 10) / 100,
    animation:         animSelect.value,
    streamerMode:        chkStreamer.checked,
    streamerHideNames:   chkStreamerNames.checked,
    streamerBlurAvatars: chkStreamerAvatars.checked,
    hotkeysEnabled:    chkHotkeys.checked,
    snoozeAllowEveryone: chkSnoozeEv.checked,
  };
}

function doSave(btn) {
  ipcRenderer.send('save-settings', collectSettings());
  const orig = btn.textContent;
  btn.textContent = '✓ Sauvegardé';
  setTimeout(() => { btn.textContent = orig; }, 1500);
}
btnSave   .addEventListener('click', () => doSave(btnSave));
btnSaveApp.addEventListener('click', () => doSave(btnSaveApp));

// Apparence : appliquer en live (sans bouton save)
[chkStreamer, chkStreamerNames, chkStreamerAvatars, animSelect, sizeSlider].forEach(el => {
  el.addEventListener('change', () => ipcRenderer.send('save-settings', collectSettings()));
});

// Filtres : appliquer en live
[chkAntiraid, chkSnoozeEv, cdSlider, chkHotkeys].forEach(el => {
  el.addEventListener('change', () => ipcRenderer.send('save-settings', collectSettings()));
});

// ─── OBS Server ──────────────────────────────────────────────────────────────
chkObs.addEventListener('change', async () => {
  const res = await ipcRenderer.invoke('obs-toggle', {
    enabled: chkObs.checked,
    port:    parseInt(obsPortInput.value, 10) || 7777,
  });
  if (!res.ok) {
    alert(`Impossible de démarrer le serveur OBS : ${res.error}`);
    chkObs.checked = false;
  }
  updateObsUrlDisplay();
});
obsPortInput.addEventListener('change', () => {
  if (chkObs.checked) chkObs.dispatchEvent(new Event('change'));
  else updateObsUrlDisplay();
});
function updateObsUrlDisplay() {
  obsUrlBox.style.display = chkObs.checked ? '' : 'none';
  obsUrlEl.textContent = `http://127.0.0.1:${obsPortInput.value || 7777}/`;
}
obsUrlEl.addEventListener('click', () => {
  shell.openExternal(`http://127.0.0.1:${obsPortInput.value || 7777}/`);
});

// ─── Snooze ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.snooze-btn').forEach(b => {
  b.addEventListener('click', () => ipcRenderer.send('set-snooze', parseInt(b.dataset.minutes, 10)));
});
btnSnoozeCancel.addEventListener('click', () => ipcRenderer.send('set-snooze', 0));

let cachedSnoozeUntil = 0;
ipcRenderer.on('snooze-update', (_e, snoozeUntil) => {
  cachedSnoozeUntil = snoozeUntil || 0;
  updateSnoozeDisplay(cachedSnoozeUntil);
});

function updateSnoozeDisplay(snoozeUntil) {
  cachedSnoozeUntil = snoozeUntil || 0;
  const active = snoozeUntil && Date.now() < snoozeUntil;
  if (active) {
    const min = Math.ceil((snoozeUntil - Date.now()) / 60000);
    snoozeText.textContent = `🔕 Snooze actif — ${min} min restantes`;
    snoozeDisplay.classList.add('visible');
  } else {
    snoozeDisplay.classList.remove('visible');
  }
}
// Refresh juste l'affichage snooze toutes les 30s (sans toucher au reste de l'UI)
setInterval(() => {
  if (cachedSnoozeUntil > 0) updateSnoozeDisplay(cachedSnoozeUntil);
}, 30000);

// ─── Keywords ────────────────────────────────────────────────────────────────
btnAddKeyword.addEventListener('click', () => {
  const w = keywordInput.value.trim();
  if (w) { ipcRenderer.send('keyword-add', w); keywordInput.value = ''; }
});
keywordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnAddKeyword.click(); });
ipcRenderer.on('keywords-update', (_e, list) => { currentKeywords = list; renderKeywords(); });
ipcRenderer.on('blacklist-update', (_e, list) => { currentBlacklist = list; renderBlacklist(); });

function renderKeywords() {
  if (!currentKeywords.length) {
    keywordChips.innerHTML = '<span class="chip-empty">Aucun mot bloqué.</span>';
    return;
  }
  keywordChips.innerHTML = currentKeywords.map(w =>
    `<span class="chip">${escHtml(w)}<button data-w="${escAttr(w)}">×</button></span>`
  ).join('');
}
function renderBlacklist() {
  if (!currentBlacklist.length) {
    blacklistChips.innerHTML = '<span class="chip-empty">Aucun. Blackliste un user depuis l\'historique.</span>';
    return;
  }
  blacklistChips.innerHTML = currentBlacklist.map(u =>
    `<span class="chip">${escHtml(u.username)}<button data-id="${escAttr(u.id)}">×</button></span>`
  ).join('');
}
keywordChips.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-w]');
  if (btn) ipcRenderer.send('keyword-remove', btn.dataset.w);
});
blacklistChips.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (btn) ipcRenderer.send('blacklist-remove', btn.dataset.id);
});

// ─── Compte / Channels ───────────────────────────────────────────────────────
btnDisconnect.addEventListener('click', () => ipcRenderer.send('stop-bot'));
btnReconfig.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="account"]').classList.add('active');
  document.getElementById('page-account').classList.add('active');
});

let tokenVisible = false;
btnShowTok.addEventListener('click', () => {
  tokenVisible = !tokenVisible;
  acToken.type = tokenVisible ? 'text' : 'password';
  btnShowTok.textContent = tokenVisible ? 'Masquer' : 'Afficher';
});

btnTest.addEventListener('click', () => ipcRenderer.send('test-overlay'));

function addChannelEntry(value = '') {
  const entry = document.createElement('div');
  entry.className = 'channel-entry';
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'channel-id-input';
  input.placeholder = '000000000000000000'; input.value = value;
  input.addEventListener('input', updateChannelDisplay);
  const btn = document.createElement('button');
  btn.className = 'btn-remove-ch'; btn.title = 'Supprimer'; btn.textContent = '×';
  btn.addEventListener('click', () => {
    if (channelList.children.length > 1) { entry.remove(); updateChannelDisplay(); }
  });
  entry.appendChild(input); entry.appendChild(btn);
  channelList.appendChild(entry);
}
function getChannelIds() {
  return [...channelList.querySelectorAll('.channel-id-input')]
    .map(i => i.value.replace(/\D/g, ''))
    .filter(id => id.length >= 15);
}
function updateChannelDisplay() {
  const ids = getChannelIds();
  if (!ids.length) channelDisplay.textContent = '—';
  else if (ids.length === 1) channelDisplay.textContent = `#${ids[0]}`;
  else channelDisplay.textContent = `${ids.length} salons`;
}
btnAddCh.addEventListener('click', () => addChannelEntry());

btnConnect.addEventListener('click', () => {
  const token      = acToken.value.trim();
  const channelIds = getChannelIds();
  if (!token || !channelIds.length) {
    setStatus('Token ou Channel ID invalide (ex : 1234567890123456789)', 'error');
    return;
  }
  setStatus('Connexion en cours…', 'loading');
  btnConnect.disabled = true;
  ipcRenderer.send('save-credentials', {
    token, channelIds,
    discordUserId: acDiscordId ? acDiscordId.value.trim() : '',
  });
});

ipcRenderer.on('bot-status', (_e, s) => {
  btnConnect.disabled = false;
  if (s.connected) {
    setStatus(`Connecté : ${s.tag}`, 'online');
    usernameEl.textContent = s.tag;
    setAvatar(s.avatar, s.tag);
    if (s.channelIds?.length === 1) channelDisplay.textContent = `#${s.channelIds[0]}`;
    else if (s.channelIds?.length > 1) channelDisplay.textContent = `${s.channelIds.length} salons actifs`;
    else updateChannelDisplay();
  } else {
    setStatus(s.error || 'Déconnecté', 'error');
    if (!s.tag) {
      usernameEl.textContent = 'Non connecté';
      avatarEl.innerHTML = ''; avatarEl.textContent = '?';
    }
  }
});

function setAvatar(url, tag) {
  avatarEl.innerHTML = '';
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;';
    img.onerror = () => { avatarEl.innerHTML = ''; avatarEl.textContent = tag ? tag[0].toUpperCase() : '?'; };
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = tag ? tag[0].toUpperCase() : '?';
  }
}
function setStatus(text, state) {
  statusText.textContent = text;
  sdot.className = 'sdot';
  if (state) sdot.classList.add(state);
}

// ─── Historique ───────────────────────────────────────────────────────────────
ipcRenderer.on('history-update', (_e, items) => { currentHistory = items; renderHistory(); });

function renderHistory() {
  if (!currentHistory.length) {
    historyList.innerHTML = '<div class="empty-state">Aucun média reçu pour le moment</div>';
    return;
  }
  historyList.innerHTML = currentHistory.map((item, idx) => renderItem(item, idx, 'h')).join('');
}

function renderItem(item, idx, source) {
  const time      = relativeTime(new Date(item.timestamp));
  const typeLabel = item.type === 'video' ? 'Vidéo' : item.type === 'gif' ? 'GIF' : item.type === 'text' ? 'Texte' : 'Image';
  const thumb     = item.type === 'video' || item.type === 'text'
    ? `<div class="history-thumb" style="display:flex;align-items:center;justify-content:center;">${VID_ICON}</div>`
    : `<img class="history-thumb" src="${escAttr(item.url)}" alt="" onerror="this.style.opacity=0" />`;
  const hasLink   = !!item.sourceUrl;
  const canReact  = !!item.messageId;
  const isFav     = currentFavorites.some(f => f.messageId === item.messageId);

  const reacts = canReact ? REACTIONS.map(emo => {
    const used = (item.reactions || []).includes(emo);
    return `<button class="h-react-btn ${used ? 'used' : ''}" data-action="react" data-emoji="${emo}" data-idx="${idx}" data-src="${source}" title="${emo}">${emo}</button>`;
  }).join('') : '';

  return `
    <div class="history-item">
      ${thumb}
      <div class="h-info">
        <div class="h-author">${escHtml(item.author)}</div>
        <div class="h-time">${time} · ${typeLabel}</div>
      </div>
      <div class="h-actions">
        ${reacts}
        ${canReact ? `<button class="h-btn ${isFav ? 'faved' : ''}" data-action="fav" data-idx="${idx}" data-src="${source}" title="Favori">${STAR_SVG}</button>` : ''}
        ${canReact ? `<button class="h-btn" data-action="discord" data-idx="${idx}" data-src="${source}" title="Ouvrir dans Discord (pour réagir avec ton compte)">${DISCORD_SVG}</button>` : ''}
        ${hasLink ? `<button class="h-btn" data-action="open" data-idx="${idx}" data-src="${source}" title="Ouvrir le lien">${LINK_SVG}</button>` : ''}
        ${item.authorId && source === 'h' ? `<button class="h-btn" data-action="blacklist" data-idx="${idx}" title="Blacklister ce user">${BLOCK_SVG}</button>` : ''}
      </div>
    </div>`;
}

async function handleItemClick(e, listType) {
  const btn = e.target.closest('.h-btn, .h-react-btn');
  if (!btn) return;
  e.stopPropagation();
  const idx = parseInt(btn.dataset.idx, 10);
  const list = listType === 'h' ? currentHistory : currentFavorites;
  const item = list[idx];
  if (!item) return;

  const action = btn.dataset.action;
  if (action === 'open' && item.sourceUrl) {
    ipcRenderer.send('open-external', item.sourceUrl);
  } else if (action === 'discord' && item.messageId) {
    const path = item.guildId
      ? `${item.guildId}/${item.channelId}/${item.messageId}`
      : `@me/${item.channelId}/${item.messageId}`;
    ipcRenderer.send('open-external', `https://discord.com/channels/${path}`);
  } else if (action === 'react' && item.messageId) {
    if (btn.disabled) return;
    btn.disabled = true;
    const res = await ipcRenderer.invoke('react-message', {
      channelId: item.channelId, messageId: item.messageId, emoji: btn.dataset.emoji,
    });
    if (res?.ok) btn.classList.add('used');
    setTimeout(() => { btn.disabled = false; }, 800);
  } else if (action === 'fav' && item.messageId) {
    if (btn.classList.contains('faved')) {
      ipcRenderer.send('favorite-remove', item.messageId);
    } else {
      ipcRenderer.send('favorite-add', item.messageId);
    }
  } else if (action === 'blacklist' && item.authorId) {
    ipcRenderer.send('blacklist-add', { id: item.authorId, username: item.author });
  }
}

historyList.addEventListener('click',  (e) => handleItemClick(e, 'h'));
favoritesList.addEventListener('click', (e) => handleItemClick(e, 'f'));

// ─── Favoris ──────────────────────────────────────────────────────────────────
ipcRenderer.on('favorites-update', (_e, favs) => { currentFavorites = favs; renderFavorites(); renderHistory(); });

function renderFavorites() {
  if (!currentFavorites.length) {
    favoritesList.innerHTML = '<div class="empty-state">Aucun favori. Clique sur ⭐ dans l\'historique pour en ajouter.</div>';
    return;
  }
  favoritesList.innerHTML = currentFavorites.map((item, idx) => renderItem(item, idx, 'f')).join('');
}

// ─── Stats ────────────────────────────────────────────────────────────────────
ipcRenderer.on('stats-update', (_e, stats) => renderStats(stats));

function renderStats(stats) {
  const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) {
    statsList.innerHTML = '<div class="empty-state">Aucune stat pour le moment.</div>';
    return;
  }
  const max = entries[0][1];
  statsList.innerHTML = entries.map(([name, count], i) => {
    const pct = Math.round((count / max) * 100);
    return `
      <div class="stat-bar">
        <span class="stat-rank">#${i + 1}</span>
        <span class="stat-name">${escHtml(name)}</span>
        <div class="stat-track"><div class="stat-fill" style="width:${pct}%"></div></div>
        <span class="stat-count">${count}</span>
      </div>`;
  }).join('');
}

btnStatsReset.addEventListener('click', () => {
  if (confirm('Réinitialiser toutes les statistiques ?')) ipcRenderer.send('stats-reset');
});

// ─── Auto-updater ─────────────────────────────────────────────────────────────
const updateBanner = document.getElementById('update-banner');
const updText      = document.getElementById('upd-text');
const updBtn       = document.getElementById('upd-btn');
let   updVersion   = '';

ipcRenderer.on('update-available', (_e, version) => {
  updVersion = version;
  updText.textContent = `Mise à jour v${version} — téléchargement…`;
  updateBanner.classList.add('visible');
  updBtn.style.display = 'none';
});
ipcRenderer.on('download-progress', (_e, percent) => {
  updText.textContent = `Mise à jour v${updVersion} — ${percent}%`;
});
ipcRenderer.on('update-downloaded', () => {
  updText.textContent = `v${updVersion} prête — cliquez pour installer`;
  updBtn.style.display = '';
  updBtn.disabled = false;
  updateBanner.classList.add('visible');
});
updBtn.addEventListener('click', () => ipcRenderer.send('install-update'));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function relativeTime(date) {
  const diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 60) return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}
function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
