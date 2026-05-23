'use strict';

const { ipcRenderer } = require('electron');

const stage     = document.getElementById('stage');
const avatar    = document.getElementById('avatar');
const authorEl  = document.getElementById('author-name');
const msgText   = document.getElementById('msg-text');
const mediaWrap = document.getElementById('media-wrap');
const progress  = document.getElementById('progress');
const queueBadge= document.getElementById('queue-badge');
const btnPause  = document.getElementById('btn-pause');
const btnSkip   = document.getElementById('btn-skip');
const btnDiscord= document.getElementById('btn-discord');
const volCtrl   = document.getElementById('vol-ctrl');
const snoozeBadge = document.getElementById('snooze-badge');
const reactionsBar = document.getElementById('reactions-bar');

let currentMsgId   = null;
let currentChanId  = null;
let currentGuildId = null;

// ─── Queue ────────────────────────────────────────────────────────────────────
const queue   = [];
let playing   = false;
let hideTimer = null;
let emptyTimer = null;
let loadTimer = null;
let paused    = false;

const PAUSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const PLAY_SVG  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

ipcRenderer.on('show-media', (_e, data) => {
  if (emptyTimer) { clearTimeout(emptyTimer); emptyTimer = null; }
  queue.push(data);
  updateBadge();
  if (!playing) processNext();
});

// ─── Hotkeys depuis main ──────────────────────────────────────────────────────
ipcRenderer.on('hotkey-skip', () => processNext());
ipcRenderer.on('hotkey-like', () => {
  const heartBtn = reactionsBar.querySelector('[data-emoji="❤️"]');
  if (heartBtn && !heartBtn.disabled) heartBtn.click();
});

// ─── Settings overlay (theme/size/anim/streamer) ─────────────────────────────
ipcRenderer.on('apply-overlay-settings', (_e, s) => {
  if (s.theme) {
    const THEMES = {
      orange: { color: '#e05a28', glow: 'rgba(224,90,40,.45)' },
      pink:   { color: '#ee1d8a', glow: 'rgba(238,29,138,.45)' },
      green:  { color: '#57f287', glow: 'rgba(87,242,135,.45)' },
      purple: { color: '#9b59ff', glow: 'rgba(155,89,255,.45)' },
      blue:   { color: '#1d9bf0', glow: 'rgba(29,155,240,.45)' },
    };
    const t = THEMES[s.theme] || THEMES.orange;
    document.documentElement.style.setProperty('--accent', t.color);
    // L'accent par défaut s'applique seulement si aucune plateforme custom n'est active
    document.documentElement.dataset.userTheme = s.theme;
  }
  if (s.overlaySize != null) {
    document.documentElement.style.setProperty('--scale', Math.max(0.5, Math.min(1.5, s.overlaySize)));
  }
  if (s.animation) {
    document.body.classList.remove('anim-pop','anim-slide','anim-fade','anim-bounce','anim-none');
    document.body.classList.add(`anim-${s.animation}`);
  }
  if (s.streamerMode != null) {
    document.body.classList.toggle('streamer', !!s.streamerMode);
  }
  if (s.streamerHideNames != null) {
    document.body.classList.toggle('streamer-names', !!s.streamerHideNames);
    streamerHideNames = !!s.streamerHideNames;
    // Met à jour le pseudo affiché si un mème est déjà à l'écran
    if (currentAuthor) authorEl.textContent = streamerHideNames ? 'Anonyme' : currentAuthor;
  }
  if (s.streamerBlurAvatars != null) {
    document.body.classList.toggle('streamer-avatars', !!s.streamerBlurAvatars);
  }
});

let streamerHideNames = false;
let currentAuthor = '';

ipcRenderer.on('snooze-update', (_e, snoozeUntil) => {
  const active = snoozeUntil && Date.now() < snoozeUntil;
  snoozeBadge.classList.toggle('visible', !!active);
});

function processNext() {
  if (queue.length === 0) {
    playing = false;
    doHide();
    return;
  }
  playing = true;
  const item = queue.shift();
  updateBadge();
  displayMedia(item);
}

function updateBadge() {
  const n = queue.length;
  if (n > 0) {
    queueBadge.textContent = `+${n} en attente`;
    queueBadge.style.display = 'block';
  } else {
    queueBadge.style.display = 'none';
  }
}

// ─── Contrôles hover ─────────────────────────────────────────────────────────
const card = document.getElementById('card');
card.addEventListener('mouseenter', () => ipcRenderer.send('overlay-hover', true));
card.addEventListener('mouseleave', () => ipcRenderer.send('overlay-hover', false));

btnPause.addEventListener('click', () => {
  const video = mediaWrap.querySelector('video');
  if (!video) return;
  if (video.paused) {
    video.play();
    paused = false;
    btnPause.innerHTML = PAUSE_SVG;
  } else {
    video.pause();
    paused = true;
    btnPause.innerHTML = PLAY_SVG;
  }
});

volCtrl.addEventListener('input', () => {
  const video = mediaWrap.querySelector('video');
  if (video) video.volume = parseFloat(volCtrl.value);
});

btnSkip.addEventListener('click', processNext);

btnDiscord.addEventListener('click', () => {
  if (!currentMsgId || !currentChanId) return;
  // Deep link Discord : @me = DM, sinon guild/channel/message
  const path = currentGuildId
    ? `${currentGuildId}/${currentChanId}/${currentMsgId}`
    : `@me/${currentChanId}/${currentMsgId}`;
  ipcRenderer.send('open-external', `https://discord.com/channels/${path}`);
});

// ─── Réactions multi-emoji ────────────────────────────────────────────────────
reactionsBar.addEventListener('click', async (e) => {
  const btn = e.target.closest('.reaction-btn');
  if (!btn || btn.disabled) return;
  if (!currentMsgId || !currentChanId) return;
  btn.disabled = true;
  const res = await ipcRenderer.invoke('react-message', {
    channelId: currentChanId,
    messageId: currentMsgId,
    emoji:     btn.dataset.emoji,
  });
  if (res?.ok) btn.classList.add('used');
  setTimeout(() => { btn.disabled = false; }, 800);
});

// ─── Affichage ────────────────────────────────────────────────────────────────
let currentTempUrl = null;

function displayMedia({ url, type, text, author, avatar: avatarUrl, position, platform, volume, imageDuration, maxDuration, announceSound, messageId, channelId, guildId }) {
  if (currentTempUrl) { ipcRenderer.send('delete-temp', currentTempUrl); currentTempUrl = null; }
  if (url?.startsWith('file:///')) currentTempUrl = url;

  clearTimeout(hideTimer);
  stopMedia();
  resetProgress();

  paused = false;
  btnPause.innerHTML = PAUSE_SVG;
  volCtrl.value = volume ?? 0.5;

  const isVideo = type === 'video';
  btnPause.style.display = isVideo ? '' : 'none';
  volCtrl.style.display  = isVideo ? '' : 'none';

  currentMsgId   = messageId  || null;
  currentChanId  = channelId  || null;
  currentGuildId = guildId    || null;
  reactionsBar.querySelectorAll('.reaction-btn').forEach(b => {
    b.classList.remove('used');
    b.disabled = !currentMsgId;
  });
  btnDiscord.style.display = currentMsgId ? '' : 'none';

  const valid = ['top-left','top','top-right','center','bottom-left','bottom-right'];
  stage.className = valid.includes(position) ? position : 'top';

  currentAuthor = author || 'Utilisateur';
  authorEl.textContent = streamerHideNames ? 'Anonyme' : currentAuthor;
  setAvatar(author, avatarUrl);
  msgText.textContent  = type === 'text' ? '' : (text || '');

  // Couleur accent : plateforme > theme user > défaut
  const PLATFORM_COLORS = {
    tiktok:  ['#ee1d52', 'rgba(238,29,82,.45)'],
    twitter: ['#1D9BF0', 'rgba(29,155,240,.45)'],
    reddit:  ['#ff4500', 'rgba(255,69,0,.45)'],
  };
  let col, glow;
  if (PLATFORM_COLORS[platform]) {
    [col, glow] = PLATFORM_COLORS[platform];
  } else {
    // Utilise le thème user défini par apply-overlay-settings
    const userTheme = document.documentElement.dataset.userTheme || 'green';
    const THEMES = {
      orange: ['#e05a28', 'rgba(224,90,40,.45)'],
      pink:   ['#ee1d8a', 'rgba(238,29,138,.45)'],
      green:  ['#57f287', 'rgba(87,242,135,.45)'],
      purple: ['#9b59ff', 'rgba(155,89,255,.45)'],
      blue:   ['#1d9bf0', 'rgba(29,155,240,.45)'],
    };
    [col, glow] = THEMES[userTheme] || THEMES.green;
  }
  document.documentElement.style.setProperty('--color', col);
  document.documentElement.style.setProperty('--glow',  glow);

  const platBadge = document.getElementById('platform-badge');
  if (platBadge) {
    platBadge.textContent = platform === 'tiktok' ? 'TikTok'
      : platform === 'twitter' ? 'X / Twitter'
      : platform === 'reddit'  ? 'Reddit'
      : 'Discord';
  }

  if (announceSound) playBeep();

  const imgDur = imageDuration ?? 8000;
  const maxDur = maxDuration   ?? 30000;

  if (type === 'video') buildVideo(url, volume ?? 0.5, maxDur);
  else if (type === 'text') buildText(text, imgDur);
  else                  buildImage(url, imgDur);

  requestAnimationFrame(() => stage.classList.add('visible'));
}

function setAvatar(author, avatarUrl) {
  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    img.onerror = () => { avatar.innerHTML = ''; avatar.textContent = (author || '?')[0].toUpperCase(); };
    avatar.innerHTML = '';
    avatar.appendChild(img);
  } else {
    avatar.innerHTML = '';
    avatar.textContent = (author || '?')[0].toUpperCase();
  }
}

function buildVideo(url, volume, maxDur) {
  const video    = document.createElement('video');
  video.src      = url;
  video.autoplay = true;
  video.controls = false;
  video.loop     = false;
  video.volume   = Math.min(1, Math.max(0, volume));

  loadTimer = setTimeout(() => { if (video._dead) return; loadTimer = null; processNext(); }, 10000);

  video.addEventListener('loadedmetadata', () => {
    if (video._dead) return;
    clearTimeout(loadTimer); loadTimer = null;
    const totalMs   = video.duration * 1000;
    const displayMs = isFinite(totalMs) ? Math.min(totalMs, maxDur) : maxDur;
    startProgress(displayMs);
    if (!isFinite(totalMs) || totalMs > maxDur) {
      hideTimer = setTimeout(processNext, maxDur);
    }
  });

  video.addEventListener('ended', () => { if (!video._dead) processNext(); });
  video.addEventListener('error', () => {
    if (video._dead) return;
    clearTimeout(loadTimer); loadTimer = null; processNext();
  });
  video.addEventListener('pause', () => {
    if (video._dead || paused) return;
    video.play().catch(() => {});
  });

  video.play().catch(() => {
    if (video._dead) return;
    video.muted = true;
    video.play().catch(() => {
      if (video._dead) return;
      clearTimeout(loadTimer); loadTimer = null; processNext();
    });
  });

  mediaWrap.appendChild(video);
}

function buildImage(url, duration) {
  const img = document.createElement('img');
  img.alt   = '';
  img.src   = url;
  img.addEventListener('error', processNext);
  mediaWrap.appendChild(img);
  startProgress(duration);
  hideTimer = setTimeout(processNext, duration);
}

function buildText(text, duration) {
  const div = document.createElement('div');
  div.style.cssText = [
    'width:100%','min-height:110px','display:flex','align-items:center','justify-content:center',
    'padding:36px 24px','text-align:center',
    'font-family:\'Segoe UI Black\',\'Arial Black\',Impact,sans-serif',
    'font-size:30px','font-weight:900','color:#fff',
    '-webkit-text-stroke:2.5px #000','paint-order:stroke fill',
    'text-shadow:0 2px 12px rgba(0,0,0,.9)',
    'white-space:pre-wrap','word-break:break-word','line-height:1.25',
  ].join(';');
  div.textContent = text;
  mediaWrap.appendChild(div);
  startProgress(duration);
  hideTimer = setTimeout(processNext, duration);
}

function playBeep() {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.25);
  } catch (_) {}
}

function startProgress(duration) {
  resetProgress();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    progress.style.transition = `transform ${duration}ms linear`;
    progress.style.transform  = 'scaleX(1)';
  }));
}

function resetProgress() {
  progress.style.transition = 'none';
  progress.style.transform  = 'scaleX(0)';
}

function doHide() {
  clearTimeout(hideTimer);
  stage.classList.remove('visible');
  resetProgress();
  emptyTimer = setTimeout(() => {
    emptyTimer = null;
    stopMedia();
    ipcRenderer.send('overlay-empty');
  }, 300);
}

function stopMedia() {
  clearTimeout(loadTimer); loadTimer = null;
  const video = mediaWrap.querySelector('video');
  if (video) {
    video._dead = true;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  mediaWrap.innerHTML = '';
}
