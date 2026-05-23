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
const volCtrl   = document.getElementById('vol-ctrl');

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

// ─── Affichage ────────────────────────────────────────────────────────────────
let currentTempUrl = null;

function displayMedia({ url, type, text, author, avatar: avatarUrl, position, platform, volume, imageDuration, maxDuration, announceSound }) {
  // Supprime le fichier temp de la vidéo précédente
  if (currentTempUrl) { ipcRenderer.send('delete-temp', currentTempUrl); currentTempUrl = null; }
  if (url?.startsWith('file:///')) currentTempUrl = url;

  clearTimeout(hideTimer);
  stopMedia();
  resetProgress();

  paused = false;
  btnPause.innerHTML = PAUSE_SVG;
  volCtrl.value = volume ?? 0.5;

  // Pause + volume uniquement pour les vidéos
  const isVideo = type === 'video';
  btnPause.style.display = isVideo ? '' : 'none';
  volCtrl.style.display  = isVideo ? '' : 'none';

  // Position
  const valid = ['top-left','top','top-right','center','bottom-left','bottom-right'];
  stage.className = valid.includes(position) ? position : 'top';

  // Header
  authorEl.textContent = author || 'Utilisateur';
  setAvatar(author, avatarUrl);
  msgText.textContent  = type === 'text' ? '' : (text || '');

  // Couleur accent + badge plateforme
  const PLATFORM_COLORS = {
    tiktok:  ['#ee1d52', 'rgba(238,29,82,.45)'],
    twitter: ['#1D9BF0', 'rgba(29,155,240,.45)'],
  };
  const [col, glow] = PLATFORM_COLORS[platform] || ['#57f287', 'rgba(87,242,135,.4)'];
  document.documentElement.style.setProperty('--color', col);
  document.documentElement.style.setProperty('--glow',  glow);

  const platBadge = document.getElementById('platform-badge');
  if (platBadge) {
    platBadge.textContent = platform === 'tiktok' ? 'TikTok' : platform === 'twitter' ? 'X / Twitter' : 'Discord';
  }

  if (announceSound) playBeep();

  const imgDur = imageDuration ?? 8000;
  const maxDur = maxDuration   ?? 30000;

  if (type === 'video') buildVideo(url, volume ?? 0.5, maxDur);
  else if (type === 'text') buildText(text, imgDur);
  else                  buildImage(url, imgDur);

  requestAnimationFrame(() => stage.classList.add('visible'));
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
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

// ─── Vidéo (max 30 s) ────────────────────────────────────────────────────────
function buildVideo(url, volume, maxDur) {
  const video    = document.createElement('video');
  video.src      = url;
  video.autoplay = true;
  video.controls = false;
  video.loop     = false;
  video.volume   = Math.min(1, Math.max(0, volume));

  // Si la vidéo ne démarre pas dans les 10s (codec non supporté, URL invalide…), on passe au suivant
  loadTimer = setTimeout(() => { loadTimer = null; processNext(); }, 10000);

  video.addEventListener('loadedmetadata', () => {
    clearTimeout(loadTimer); loadTimer = null;
    const totalMs   = video.duration * 1000;
    const displayMs = isFinite(totalMs) ? Math.min(totalMs, maxDur) : maxDur;
    startProgress(displayMs);
    if (!isFinite(totalMs) || totalMs > maxDur) {
      hideTimer = setTimeout(processNext, maxDur);
    }
  });

  video.addEventListener('ended', processNext);
  video.addEventListener('error', () => { clearTimeout(loadTimer); loadTimer = null; processNext(); });
  video.addEventListener('pause', () => { if (!paused) video.play().catch(() => {}); });

  video.play().catch(() => {
    video.muted = true;
    video.play().catch(() => { clearTimeout(loadTimer); loadTimer = null; processNext(); });
  });

  mediaWrap.appendChild(video);
}

// ─── Image / GIF ─────────────────────────────────────────────────────────────
function buildImage(url, duration) {
  const img = document.createElement('img');
  img.alt   = '';
  img.src   = url;
  img.addEventListener('error', processNext);
  mediaWrap.appendChild(img);
  startProgress(duration);
  hideTimer = setTimeout(processNext, duration);
}

// ─── Texte seul ───────────────────────────────────────────────────────────────
function buildText(text, duration) {
  const div = document.createElement('div');
  div.style.cssText = [
    'width:100%',
    'min-height:110px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:36px 24px',
    'text-align:center',
    'font-family:\'Segoe UI Black\',\'Arial Black\',Impact,sans-serif',
    'font-size:30px',
    'font-weight:900',
    'color:#fff',
    '-webkit-text-stroke:2.5px #000',
    'paint-order:stroke fill',
    'text-shadow:0 2px 12px rgba(0,0,0,.9)',
    'white-space:pre-wrap',
    'word-break:break-word',
    'line-height:1.25',
  ].join(';');
  div.textContent = text;
  mediaWrap.appendChild(div);
  startProgress(duration);
  hideTimer = setTimeout(processNext, duration);
}

// ─── Son d'annonce ───────────────────────────────────────────────────────────
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

// ─── Barre de progression ────────────────────────────────────────────────────
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

// ─── Masquage ────────────────────────────────────────────────────────────────
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
  if (video) { video.pause(); video.src = ''; video.load(); }
  mediaWrap.innerHTML = '';
}
