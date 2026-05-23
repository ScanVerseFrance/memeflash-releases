'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, globalShortcut } = require('electron');
const { autoUpdater }     = require('electron-updater');
const { Client, GatewayIntentBits } = require('discord.js');
const Store = require('electron-store');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const obsServer = require('./src/obs/server.js');

const store = new Store();
let mainWindow    = null;
let overlayWindow = null;
let discordClient = null;
let tray          = null;
let forceQuit     = false;
let reconnectTimer = null;
const mediaHistory = [];

// ─── État runtime (non persistant) ───────────────────────────────────────────
let snoozeUntil       = 0;
const userCooldown    = new Map();    // userId → lastMsgTs
const recentMsgTimes  = [];           // pour anti-raid
let lastPayload       = null;         // pour replay

// ─── Scope par bot (historique/favoris/stats/filtres scopés au bot connecté) ─
let currentScope = store.get('lastBotId', 'default');
function scoped(key) { return `${currentScope}.${key}`; }
function migrateGlobalToScoped(botId) {
  // Migre les données globales pré-v1.1 vers le scope du bot, une seule fois
  const flag = `migrated.${botId}`;
  if (store.get(flag, false)) return;
  for (const k of ['favorites','stats','blacklistedUsers','blockedKeywords']) {
    const scopedKey = `${botId}.${k}`;
    if (store.has(k) && !store.has(scopedKey)) {
      store.set(scopedKey, store.get(k));
    }
  }
  store.set(flag, true);
}
function setScope(botId) {
  if (currentScope === botId) return;
  migrateGlobalToScoped(botId);
  currentScope = botId;
  store.set('lastBotId', botId);
  // Recharge l'historique en mémoire depuis le store
  mediaHistory.length = 0;
  const saved = store.get(scoped('history'), []);
  for (const item of saved) mediaHistory.push(item);
  // Push fresh data vers l'UI
  if (mainWindow) {
    mainWindow.webContents.send('history-update',   mediaHistory);
    mainWindow.webContents.send('favorites-update', store.get(scoped('favorites'), []));
    mainWindow.webContents.send('stats-update',     store.get(scoped('stats'), {}));
    mainWindow.webContents.send('blacklist-update', store.get(scoped('blacklistedUsers'), []));
    mainWindow.webContents.send('keywords-update',  store.get(scoped('blockedKeywords'), []));
  }
}
// Charge l'historique scopé au démarrage
{
  const saved = store.get(scoped('history'), []);
  for (const item of saved) mediaHistory.push(item);
}
function persistHistory() {
  store.set(scoped('history'), mediaHistory.slice(0, 50));
}

// ─── Démarrage caché (autostart Windows / macOS) ─────────────────────────────
const startHidden = process.argv.includes('--hidden')
  || app.getLoginItemSettings().wasOpenedAsHidden;

// ─── Single instance lock ─────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => { showMainWindow(); });

function showMainWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.setSkipTaskbar(false); mainWindow.focus(); }
}

// ─── Migration ───────────────────────────────────────────────────────────────
function migrateFromOldInstall() {
  if (store.has('token') || process.platform !== 'win32') return;
  try {
    const oldCfg = path.join(os.homedir(), 'AppData', 'Roaming', 'memedrop', 'config.json');
    if (fs.existsSync(oldCfg)) {
      const old = JSON.parse(fs.readFileSync(oldCfg, 'utf8'));
      ['token','channelId','discordUserId','volume','imageDuration','announceSound','randomPosition','selectedPosition']
        .forEach(k => { if (old[k] !== undefined) store.set(k, old[k]); });
    }
  } catch (_) {}
}

// ─── Nettoyage fichiers temp ─────────────────────────────────────────────────
try {
  fs.readdirSync(os.tmpdir())
    .filter(f => f.startsWith('md_') && f.endsWith('.mp4'))
    .forEach(f => { try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch (_) {} });
} catch (_) {}

// ─── Validation URL ──────────────────────────────────────────────────────────
function isSafeMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /^(https?:\/\/|file:\/\/\/)/.test(url);
}

// ─── TikTok ───────────────────────────────────────────────────────────────────
function isTikTokUrl(url) {
  return /(vm|vt|m)\.tiktok\.com\/\w+|tiktok\.com\/@[\w.]+\/video\/\d+|tiktok\.com\/t\/\w+/.test(url);
}
// Nettoie l'URL TikTok des paramètres de tracking qui perturbent parfois l'API
function cleanTikTokUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch { return url; }
}

async function tikwmExtract(url, hd) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=${hd}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const data = await res.json();
    if (data.code !== 0) return { ok: false, reason: data.msg || `code_${data.code}` };
    const playUrl = data.data?.hdplay || data.data?.play || data.data?.wmplay;
    if (!playUrl) return { ok: false, reason: 'no_play_url' };
    return { ok: true, playUrl };
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, reason: e.message };
  }
}

async function downloadVideoToTemp(url) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 20000);
    const res  = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':    'https://www.tiktok.com/',
        'Accept':     'video/mp4,video/*,*/*',
      },
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return null;             // fichier trop petit = invalide
    const tmpFile = path.join(os.tmpdir(), `md_${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, buf);
    return pathToFileURL(tmpFile).toString();
  } catch (e) {
    console.error('[TikTok DL]', e.message);
    return null;
  }
}

async function getTikTokMedia(url) {
  const clean = cleanTikTokUrl(url);
  // 3 tentatives : URL clean en HD, URL clean en SD, URL originale en HD
  const attempts = [
    [clean, 1],
    [clean, 0],
    [url,   1],
  ];
  for (let i = 0; i < attempts.length; i++) {
    const [tryUrl, hd] = attempts[i];
    const r = await tikwmExtract(tryUrl, hd);
    if (!r.ok) {
      console.warn(`[TikTok] tentative ${i + 1} échouée:`, r.reason);
      // Rate limit → attend un peu avant le prochain essai
      if (/Free Api Limit|throttl|rate|limit/i.test(r.reason)) {
        await new Promise(rs => setTimeout(rs, 1500));
      }
      continue;
    }
    const fileUrl = await downloadVideoToTemp(r.playUrl);
    if (fileUrl) return { url: fileUrl, type: 'video' };
    console.warn(`[TikTok] download échoué (tentative ${i + 1})`);
  }
  console.error('[TikTok] toutes les tentatives ont échoué pour', url);
  return null;
}

// ─── Twitter / X ──────────────────────────────────────────────────────────────
function isTwitterUrl(url) {
  return /^https?:\/\/(www\.)?(twitter|x)\.com\/\w+\/status\/\d+/.test(url);
}
async function getTwitterMedia(url) {
  // ── fxtwitter (api.fxtwitter.com) — structure: data.tweet.media.videos|photos
  try {
    const fxUrl = url.replace(/^https?:\/\/(www\.)?(twitter|x)\.com/, 'https://api.fxtwitter.com');
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(fxUrl, { headers: { 'User-Agent': 'MemeFlash/1.0' }, signal: ctrl.signal });
    clearTimeout(tid);
    if (res.ok) {
      const data  = await res.json();
      const tweet = data.tweet;
      if (tweet?.media?.videos?.length) return { url: tweet.media.videos[0].url, type: 'video' };
      if (tweet?.media?.photos?.length) return { url: tweet.media.photos[0].url, type: 'image' };
    } else {
      console.warn('[Twitter fx] http', res.status);
    }
  } catch (e) { console.error('[Twitter fx]', e.message); }

  // ── vxtwitter (api.vxtwitter.com) — structure: data.media_extended[]
  try {
    const vxUrl = url.replace(/^https?:\/\/(www\.)?(twitter|x)\.com/, 'https://api.vxtwitter.com');
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(vxUrl, { headers: { 'User-Agent': 'MemeFlash/1.0' }, signal: ctrl.signal });
    clearTimeout(tid);
    if (res.ok) {
      const data  = await res.json();
      const media = data.media_extended || [];
      const video = media.find(m => m.type === 'video' || m.type === 'gif');
      if (video?.url) return { url: video.url, type: 'video' };
      const photo = media.find(m => m.type === 'image' || m.type === 'photo');
      if (photo?.url) return { url: photo.url, type: 'image' };
    } else {
      console.warn('[Twitter vx] http', res.status);
    }
  } catch (e) { console.error('[Twitter vx]', e.message); }

  console.error('[Twitter] toutes les extractions ont échoué pour', url);
  return null;
}

// ─── Streamable ──────────────────────────────────────────────────────────────
function isStreamableUrl(url) {
  return /^https?:\/\/(www\.)?streamable\.com\/[a-z0-9]+/i.test(url);
}
async function getStreamableMedia(url) {
  try {
    const id = url.match(/streamable\.com\/([a-z0-9]+)/i)?.[1];
    if (!id) return null;
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(`https://api.streamable.com/videos/${id}`,
      { headers: { 'User-Agent': 'MemeFlash/1.0' }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    const u    = data.files?.mp4?.url;
    if (!u) return null;
    return { url: u.startsWith('//') ? `https:${u}` : u, type: 'video' };
  } catch (e) { console.error('[Streamable]', e.message); }
  return null;
}

// ─── Reddit ──────────────────────────────────────────────────────────────────
function isRedditUrl(url) {
  return /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/r\/[\w]+\/comments\/\w+/.test(url)
      || /^https?:\/\/v\.redd\.it\/\w+/.test(url)
      || /^https?:\/\/(i|preview)\.redd\.it\/\S+/.test(url);
}
async function getRedditMedia(url) {
  try {
    // Liens directs i.redd.it / preview.redd.it (image)
    const directImg = url.match(/^https?:\/\/(i|preview)\.redd\.it\/[\w\-./]+\.(jpe?g|png|gif|webp)/i);
    if (directImg) {
      return { url, type: url.toLowerCase().endsWith('.gif') ? 'gif' : 'image' };
    }

    // Convertit en lien JSON Reddit
    let jsonUrl = url;
    if (/^https?:\/\/v\.redd\.it\//.test(url)) {
      // Pas d'API directe : on a besoin du post parent → skip
      return null;
    }
    jsonUrl = jsonUrl.replace(/\/$/, '') + '.json';

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(jsonUrl, { headers: { 'User-Agent': 'MemeFlash/1.0' }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) return null;

    // Vidéo native Reddit (v.redd.it) — fallback_url contient le MP4 sans audio
    if (post.media?.reddit_video?.fallback_url) {
      return { url: post.media.reddit_video.fallback_url, type: 'video' };
    }
    if (post.secure_media?.reddit_video?.fallback_url) {
      return { url: post.secure_media.reddit_video.fallback_url, type: 'video' };
    }
    // GIF/Image
    const dest = post.url_overridden_by_dest || post.url;
    if (dest) {
      if (/\.(mp4|webm)(\?|$)/i.test(dest)) return { url: dest, type: 'video' };
      if (/\.gif(\?|$)/i.test(dest))         return { url: dest, type: 'gif' };
      if (/\.(jpe?g|png|webp)(\?|$)/i.test(dest)) return { url: dest, type: 'image' };
      // GIFV imgur → MP4
      if (/^https?:\/\/i\.imgur\.com\/\w+\.gifv$/i.test(dest)) {
        return { url: dest.replace(/\.gifv$/, '.mp4'), type: 'video' };
      }
    }
    return null;
  } catch (e) { console.error('[Reddit]', e.message); }
  return null;
}

// ─── Fenêtres ────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 560, height: 700,
    resizable: false,
    show: !startHidden,
    skipTaskbar: startHidden,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    title: 'MemeFlash',
    backgroundColor: '#1a1a1a',
  });
  mainWindow.loadFile(path.join(__dirname, 'src/config/index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, 'build', process.platform === 'darwin' ? 'icon.png' : 'icon.ico');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('MemeFlash');
  refreshTrayMenu();
  tray.on('click', showMainWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  const remaining = Math.max(0, snoozeUntil - Date.now());
  const snoozeLabel = remaining > 0
    ? `🔕 Snooze actif (${Math.ceil(remaining / 60000)} min)`
    : '🔕 Snooze (silence)';

  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir MemeFlash', click: showMainWindow },
    { type: 'separator' },
    { label: snoozeLabel, submenu: [
      { label: '5 minutes',  click: () => setSnooze(5) },
      { label: '15 minutes', click: () => setSnooze(15) },
      { label: '30 minutes', click: () => setSnooze(30) },
      { label: '1 heure',    click: () => setSnooze(60) },
      { label: '2 heures',   click: () => setSnooze(120) },
      { type: 'separator' },
      { label: 'Annuler le snooze', click: () => setSnooze(0), enabled: remaining > 0 },
    ]},
    { label: '🔄 Rejouer le dernier mème', click: replayLast, enabled: !!lastPayload },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function setSnooze(minutes) {
  snoozeUntil = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  refreshTrayMenu();
  if (mainWindow) mainWindow.webContents.send('snooze-update', snoozeUntil);
  // Auto-refresh tray menu pour décrémenter le compteur
  if (minutes > 0) setTimeout(refreshTrayMenu, Math.min(60000, minutes * 60000));
}

function replayLast() {
  if (!lastPayload || !overlayWindow) return;
  overlayWindow.showInactive();
  overlayWindow.webContents.send('show-media', lastPayload);
  obsServer.broadcast('show-media', lastPayload);
}

function createOverlayWindow() {
  const displayId = store.get('displayId', 0);
  const displays  = screen.getAllDisplays();
  const display   = displays[displayId] || screen.getPrimaryDisplay();
  const { bounds } = display;

  overlayWindow = new BrowserWindow({
    width: bounds.width + 10, height: bounds.height + 70,
    x: bounds.x - 5, y: bounds.y - 30,
    transparent: true, frame: false, thickFrame: false, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, title: '',
    show: false,
    backgroundColor: '#00000000',
    roundedCorners: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setSkipTaskbar(true);
  overlayWindow.removeMenu();
  overlayWindow.setMenuBarVisibility(false);
  overlayWindow.setTitle('');
  overlayWindow.loadFile(path.join(__dirname, 'src/overlay/overlay.html'));

  overlayWindow.webContents.once('did-finish-load', () => pushOverlaySettings());
  overlayWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Overlay] crash :', details.reason);
    overlayWindow = null;
    createOverlayWindow();
  });
}

function recreateOverlayWindow() {
  if (overlayWindow) { try { overlayWindow.destroy(); } catch (_) {} overlayWindow = null; }
  createOverlayWindow();
}

function pushOverlaySettings() {
  const s = {
    theme:               store.get('theme', 'orange'),
    overlaySize:         store.get('overlaySize', 1),
    animation:           store.get('animation', 'pop'),
    streamerMode:        store.get('streamerMode', false),
    streamerHideNames:   store.get('streamerHideNames', false),
    streamerBlurAvatars: store.get('streamerBlurAvatars', false),
  };
  if (overlayWindow?.webContents) overlayWindow.webContents.send('apply-overlay-settings', s);
  obsServer.broadcast('apply-overlay-settings', s);
}

// ─── Bot Discord ──────────────────────────────────────────────────────────────
function startDiscordBot(token, channelIds) {
  if (discordClient) { discordClient.destroy(); discordClient = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  discordClient.on('ready', () => {
    console.log(`[Bot] Connecté : ${discordClient.user.tag} | channels: ${channelIds.join(', ')}`);
    // Pas d'activité RPC affichée : le bot tourne 24/7 en tray, on ne veut pas
    // qu'il affiche en permanence un statut "Regarde les mèmes" dans Discord
    try { discordClient.user.setPresence({ activities: [] }); } catch (_) {}
    // Bascule le scope sur l'ID du bot connecté → recharge histo/favoris/stats/filtres
    setScope(discordClient.user.id);
    const avatar = discordClient.user.displayAvatarURL({ size: 64, extension: 'png' });
    if (mainWindow) mainWindow.webContents.send('bot-status', { connected: true, tag: discordClient.user.tag, avatar, channelIds });
  });

  discordClient.on('shardDisconnect', () => {
    if (mainWindow) mainWindow.webContents.send('bot-status', { connected: false, error: 'Déconnecté — reconnexion auto...' });
  });

  discordClient.on('shardResume', () => {
    if (mainWindow) mainWindow.webContents.send('bot-status', { connected: true, tag: discordClient.user?.tag });
  });

  discordClient.on('messageCreate', async (message) => {
    if (!channelIds.includes(message.channelId)) return;
    if (message.author.bot) return;

    // ── Ciblage par ping ────────────────────────────────────────────────
    const mentionsEveryone = message.mentions.everyone;
    if (!mentionsEveryone) {
      if (message.mentions.users.size === 0) return;
      const myDiscordId = store.get('discordUserId', '');
      if (myDiscordId) {
        const mentionedIds = [...message.mentions.users.keys()];
        if (!mentionedIds.includes(myDiscordId)) return;
      }
    }

    // ── Snooze (ignore tout sauf @everyone) ─────────────────────────────
    if (Date.now() < snoozeUntil) {
      if (!mentionsEveryone || !store.get('snoozeAllowEveryone', false)) return;
    }

    // ── Blacklist user ──────────────────────────────────────────────────
    const blacklist = store.get(scoped('blacklistedUsers'), []);
    if (blacklist.some(b => b.id === message.author.id)) return;

    // ── Filtre mots-clés ────────────────────────────────────────────────
    const blockedWords = store.get(scoped('blockedKeywords'), []);
    if (blockedWords.length && message.content) {
      const lower = message.content.toLowerCase();
      if (blockedWords.some(w => lower.includes(w.toLowerCase()))) return;
    }

    // ── Cooldown par user ───────────────────────────────────────────────
    const cooldownSec = store.get('userCooldown', 0);
    if (cooldownSec > 0) {
      const last = userCooldown.get(message.author.id) || 0;
      if (Date.now() - last < cooldownSec * 1000) return;
      userCooldown.set(message.author.id, Date.now());
    }

    // ── Anti-raid ───────────────────────────────────────────────────────
    if (store.get('antiRaid', false)) {
      const now = Date.now();
      recentMsgTimes.push(now);
      while (recentMsgTimes.length && now - recentMsgTimes[0] > 10000) recentMsgTimes.shift();
      if (recentMsgTimes.length > 5) return;     // drop excess
    }

    const text = message.content || '';
    const displayText = text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/<@!?\d+>/g, '')
      .replace(/@everyone|@here/g, '')
      .trim();
    let mediaUrl  = null;
    let mediaType = null;
    let platform  = null;

    // 1) Pièce jointe directe
    if (message.attachments.size > 0) {
      const att  = message.attachments.first();
      const ct   = att.contentType || '';
      const name = (att.name || '').toLowerCase();
      if (ct.startsWith('image/gif') || name.endsWith('.gif'))             { mediaUrl = att.url; mediaType = 'gif'; }
      else if (ct.startsWith('image/'))                                     { mediaUrl = att.url; mediaType = 'image'; }
      else if (ct.startsWith('video/') || name.match(/\.(mp4|webm)$/))     { mediaUrl = att.url; mediaType = 'video'; }
    }

    // 2) Embed Discord (Tenor, Giphy, etc.) — MAIS PAS pour TikTok/Twitter/Reddit/Streamable
    // Pour ces plateformes, l'embed contient juste une thumbnail statique : on laisse l'étape 3
    // faire l'extraction propre via tikwm/fxtwitter/etc.
    if (!mediaUrl && message.embeds.length > 0) {
      const embed = message.embeds[0];
      const embedSrcUrl = embed.url || embed.video?.url || '';
      const isSpecialPlatform = isTikTokUrl(embedSrcUrl) || isTwitterUrl(embedSrcUrl)
                              || isStreamableUrl(embedSrcUrl) || isRedditUrl(embedSrcUrl);
      if (!isSpecialPlatform) {
        if (embed.video?.url) {
          const proxy = embed.video.proxyURL;
          if (proxy && !proxy.includes('/embeds/')) { mediaUrl = proxy; mediaType = 'video'; }
          else if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(embed.video.url)) { mediaUrl = embed.video.url; mediaType = 'video'; }
        }
        if (!mediaUrl && embed.image?.url) {
          const u = embed.image.url.toLowerCase();
          mediaUrl = embed.image.proxyURL || embed.image.url;
          mediaType = u.includes('.gif') ? 'gif' : 'image';
        }
        if (!mediaUrl && embed.thumbnail?.url) {
          mediaUrl = embed.thumbnail.proxyURL || embed.thumbnail.url; mediaType = 'image';
        }
      }
    }

    // 3) Liens bruts
    if (!mediaUrl) {
      const urls = (text.match(/https?:\/\/\S+/g) || []).map(u => u.replace(/[>)'"]+$/, ''));
      for (const url of urls) {
        if (isTikTokUrl(url)) {
          const r = await getTikTokMedia(url);
          if (r) { mediaUrl = r.url; mediaType = r.type; platform = 'tiktok'; break; }
        } else if (isTwitterUrl(url)) {
          const r = await getTwitterMedia(url);
          if (r) { mediaUrl = r.url; mediaType = r.type; platform = 'twitter'; break; }
        } else if (isStreamableUrl(url)) {
          const r = await getStreamableMedia(url);
          if (r) { mediaUrl = r.url; mediaType = r.type; break; }
        } else if (isRedditUrl(url)) {
          const r = await getRedditMedia(url);
          if (r) { mediaUrl = r.url; mediaType = r.type; platform = 'reddit'; break; }
        } else {
          const m = url.match(/\.(jpe?g|png|gif|webp|mp4|webm)(\?.*)?$/i);
          if (m) {
            mediaUrl = url;
            const ext = m[1].toLowerCase();
            mediaType = ext === 'gif' ? 'gif' : (ext === 'mp4' || ext === 'webm') ? 'video' : 'image';
            break;
          }
        }
      }
    }

    if (mediaUrl && !isSafeMediaUrl(mediaUrl)) mediaUrl = null;
    if (!mediaUrl && !displayText) return;

    // ── Stats (compteur par user) ───────────────────────────────────────
    const stats = store.get(scoped('stats'), {});
    const uname = message.author.username;
    stats[uname] = (stats[uname] || 0) + 1;
    store.set(scoped('stats'), stats);

    const randomPos = store.get('randomPosition', false);
    const positions = ['top-left','top','top-right','bottom-left','center','bottom-right'];
    const position  = randomPos
      ? positions[Math.floor(Math.random() * positions.length)]
      : store.get('selectedPosition', 'top');

    const sourceUrl = (text.match(/https?:\/\/\S+/) || [null])[0]
      || (mediaUrl && /^https?:/.test(mediaUrl) ? mediaUrl : null);

    const payload = {
      url: mediaUrl, type: mediaType || 'text', text: displayText,
      author:   message.member?.displayName || message.author.globalName || message.author.username,
      avatar:   message.author.displayAvatarURL({ size: 64 }),
      position, platform,
      volume:        store.get('volume', 50) / 100,
      imageDuration: store.get('imageDuration', 8) * 1000,
      maxDuration:   30000,
      announceSound: store.get('announceSound', false),
      messageId:     message.id,
      channelId:     message.channelId,
      guildId:       message.guildId,
    };

    lastPayload = payload;
    refreshTrayMenu();

    if (overlayWindow) {
      overlayWindow.showInactive();
      overlayWindow.webContents.send('show-media', payload);
    }
    // Diffuse aussi vers OBS si le serveur tourne
    obsServer.broadcast('show-media', payload);

    mediaHistory.unshift({
      url: mediaUrl, type: mediaType, text,
      author: message.author.username,
      authorId: message.author.id,
      platform,
      messageId: message.id,
      channelId: message.channelId,
      guildId:   message.guildId,
      sourceUrl,
      liked: false,
      reactions: [],
      timestamp: new Date().toISOString(),
    });
    if (mediaHistory.length > 50) mediaHistory.pop();
    persistHistory();
    if (mainWindow) mainWindow.webContents.send('history-update', mediaHistory);
  });

  discordClient.on('error', (err) => {
    console.error('[Bot] Erreur :', err.message);
    if (mainWindow) mainWindow.webContents.send('bot-status', { connected: false, error: err.message });
  });

  discordClient.login(token).catch((err) => {
    console.error('[Bot] Login échoué :', err.message);
    if (mainWindow) mainWindow.webContents.send('bot-status', { connected: false, error: `Login échoué : ${err.message}` });
    const isAuthError = /TOKEN_INVALID|Privileged intent|Disallowed intent/i.test(err.message);
    if (!isAuthError) {
      reconnectTimer = setTimeout(() => startDiscordBot(token, channelIds), 30000);
    }
  });
}

// ─── Hotkeys globales ────────────────────────────────────────────────────────
function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!store.get('hotkeysEnabled', true)) return;
  const reg = (accel, fn) => {
    try { globalShortcut.register(accel, fn); }
    catch (e) { console.error('[Hotkey]', accel, e.message); }
  };
  reg('CommandOrControl+Shift+M', () => { if (overlayWindow) overlayWindow.webContents.send('hotkey-skip'); });
  reg('CommandOrControl+Shift+H', () => { if (overlayWindow) overlayWindow.hide(); });
  reg('CommandOrControl+Shift+R', replayLast);
  reg('CommandOrControl+Shift+L', () => { if (overlayWindow) overlayWindow.webContents.send('hotkey-like'); });
  reg('CommandOrControl+Shift+B', () => setSnooze(15));
}

// ─── IPC : settings ──────────────────────────────────────────────────────────
ipcMain.on('get-all-settings', (event) => {
  let channelIds = store.get('channelIds', null);
  if (!channelIds) {
    const old = store.get('channelId', '');
    channelIds = old ? [old] : [];
  }
  event.reply('all-settings', {
    token:               store.get('token', ''),
    channelIds,
    discordUserId:       store.get('discordUserId', ''),
    volume:              store.get('volume', 50),
    imageDuration:       store.get('imageDuration', 8),
    announceSound:       store.get('announceSound', false),
    randomPosition:      store.get('randomPosition', false),
    selectedPosition:    store.get('selectedPosition', 'top'),
    // Nouveaux
    userCooldown:        store.get('userCooldown', 0),
    antiRaid:            store.get('antiRaid', false),
    blacklistedUsers:    store.get(scoped('blacklistedUsers'), []),
    blockedKeywords:     store.get(scoped('blockedKeywords'), []),
    theme:               store.get('theme', 'orange'),
    overlaySize:         store.get('overlaySize', 1),
    animation:           store.get('animation', 'pop'),
    streamerMode:        store.get('streamerMode', false),
    streamerHideNames:   store.get('streamerHideNames', false),
    streamerBlurAvatars: store.get('streamerBlurAvatars', false),
    displayId:           store.get('displayId', 0),
    favorites:           store.get(scoped('favorites'), []),
    stats:               store.get(scoped('stats'), {}),
    obsServerEnabled:    store.get('obsServerEnabled', false),
    obsServerPort:       store.get('obsServerPort', 7777),
    hotkeysEnabled:      store.get('hotkeysEnabled', true),
    snoozeUntil,
    snoozeAllowEveryone: store.get('snoozeAllowEveryone', false),
  });
});

ipcMain.on('save-settings', (_e, s) => {
  store.set('volume',           s.volume);
  store.set('imageDuration',    s.imageDuration);
  store.set('announceSound',    s.announceSound);
  store.set('randomPosition',   s.randomPosition);
  store.set('selectedPosition', s.selectedPosition);
  // Nouveaux
  if (s.userCooldown    != null) store.set('userCooldown',    s.userCooldown);
  if (s.antiRaid        != null) store.set('antiRaid',        s.antiRaid);
  if (s.theme           != null) store.set('theme',           s.theme);
  if (s.overlaySize     != null) store.set('overlaySize',     s.overlaySize);
  if (s.animation       != null) store.set('animation',       s.animation);
  if (s.streamerMode    != null) store.set('streamerMode',    s.streamerMode);
  if (s.streamerHideNames   != null) store.set('streamerHideNames',   s.streamerHideNames);
  if (s.streamerBlurAvatars != null) store.set('streamerBlurAvatars', s.streamerBlurAvatars);
  if (s.hotkeysEnabled  != null) store.set('hotkeysEnabled',  s.hotkeysEnabled);
  if (s.snoozeAllowEveryone != null) store.set('snoozeAllowEveryone', s.snoozeAllowEveryone);

  // Affecte overlay direct (theme, taille, animation, streamer)
  pushOverlaySettings();
  // Re-enregistre hotkeys si toggle
  registerHotkeys();
});

ipcMain.on('save-credentials', (_e, c) => {
  store.set('token',         c.token);
  store.set('channelIds',    c.channelIds);
  store.delete('channelId');
  store.set('discordUserId', c.discordUserId || '');
  startDiscordBot(c.token, c.channelIds);
});

ipcMain.on('stop-bot', () => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (discordClient) { discordClient.destroy(); discordClient = null; }
  if (mainWindow) mainWindow.webContents.send('bot-status', { connected: false });
});

ipcMain.on('overlay-empty', () => { if (overlayWindow) overlayWindow.hide(); });

ipcMain.on('overlay-hover', (_e, hovered) => {
  if (overlayWindow) overlayWindow.setIgnoreMouseEvents(!hovered, { forward: true });
});

ipcMain.on('delete-temp', (_e, fileUrl) => {
  if (!fileUrl?.startsWith('file:')) return;
  try { fs.unlink(fileURLToPath(fileUrl), () => {}); } catch (_) {}
});

ipcMain.on('open-external', (_e, url) => {
  if (!url || typeof url !== 'string') return;
  if (!/^https?:\/\//.test(url)) return;
  shell.openExternal(url).catch(() => {});
});

// ─── IPC : réactions Discord ─────────────────────────────────────────────────
ipcMain.handle('react-message', async (_e, { channelId, messageId, emoji }) => {
  if (!discordClient || !channelId || !messageId) return { ok: false, error: 'not_connected' };
  try {
    const channel = await discordClient.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.react(emoji || '❤️');
    const item = mediaHistory.find(m => m.messageId === messageId);
    if (item) {
      if (emoji === '❤️') item.liked = true;
      if (!item.reactions.includes(emoji)) item.reactions.push(emoji);
      persistHistory();
      if (mainWindow) mainWindow.webContents.send('history-update', mediaHistory);
    }
    return { ok: true };
  } catch (err) {
    console.error('[React]', err.message);
    return { ok: false, error: err.message };
  }
});

// ─── IPC : snooze / replay ───────────────────────────────────────────────────
ipcMain.on('set-snooze', (_e, minutes) => setSnooze(minutes));
ipcMain.on('replay-last', replayLast);

// ─── IPC : blacklist / keywords (scopés au bot) ──────────────────────────────
ipcMain.on('blacklist-add', (_e, { id, username }) => {
  if (!id) return;
  const list = store.get(scoped('blacklistedUsers'), []);
  if (!list.some(b => b.id === id)) {
    list.push({ id, username: username || id });
    store.set(scoped('blacklistedUsers'), list);
  }
  if (mainWindow) mainWindow.webContents.send('blacklist-update', list);
});
ipcMain.on('blacklist-remove', (_e, id) => {
  const list = store.get(scoped('blacklistedUsers'), []).filter(b => b.id !== id);
  store.set(scoped('blacklistedUsers'), list);
  if (mainWindow) mainWindow.webContents.send('blacklist-update', list);
});
ipcMain.on('keyword-add', (_e, word) => {
  word = (word || '').trim();
  if (!word) return;
  const list = store.get(scoped('blockedKeywords'), []);
  if (!list.includes(word)) { list.push(word); store.set(scoped('blockedKeywords'), list); }
  if (mainWindow) mainWindow.webContents.send('keywords-update', list);
});
ipcMain.on('keyword-remove', (_e, word) => {
  const list = store.get(scoped('blockedKeywords'), []).filter(w => w !== word);
  store.set(scoped('blockedKeywords'), list);
  if (mainWindow) mainWindow.webContents.send('keywords-update', list);
});

// ─── IPC : favoris (scopés au bot) ───────────────────────────────────────────
ipcMain.on('favorite-add', (_e, messageId) => {
  const item = mediaHistory.find(m => m.messageId === messageId);
  if (!item) return;
  const favs = store.get(scoped('favorites'), []);
  if (!favs.some(f => f.messageId === messageId)) {
    favs.unshift({ ...item, favoritedAt: new Date().toISOString() });
    if (favs.length > 200) favs.pop();
    store.set(scoped('favorites'), favs);
  }
  if (mainWindow) mainWindow.webContents.send('favorites-update', favs);
});
ipcMain.on('favorite-remove', (_e, messageId) => {
  const favs = store.get(scoped('favorites'), []).filter(f => f.messageId !== messageId);
  store.set(scoped('favorites'), favs);
  if (mainWindow) mainWindow.webContents.send('favorites-update', favs);
});

// ─── IPC : stats (scopés au bot) ─────────────────────────────────────────────
ipcMain.on('stats-reset', () => {
  store.set(scoped('stats'), {});
  if (mainWindow) mainWindow.webContents.send('stats-update', {});
});

// ─── IPC : moniteurs ─────────────────────────────────────────────────────────
ipcMain.handle('get-displays', () => {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: i,
    label: `Écran ${i + 1} (${d.size.width}×${d.size.height})${d.id === primary.id ? ' — principal' : ''}`,
    width: d.size.width,
    height: d.size.height,
  }));
});
ipcMain.on('set-display', (_e, id) => {
  store.set('displayId', id);
  recreateOverlayWindow();
});

// ─── IPC : OBS Browser Source ────────────────────────────────────────────────
ipcMain.handle('obs-toggle', async (_e, { enabled, port }) => {
  store.set('obsServerEnabled', !!enabled);
  if (port) store.set('obsServerPort', port);
  if (enabled) {
    try {
      await obsServer.start(store.get('obsServerPort', 7777));
      pushOverlaySettings();
      return { ok: true, port: obsServer.getPort() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  } else {
    obsServer.stop();
    return { ok: true };
  }
});
ipcMain.handle('obs-status', () => ({
  running: obsServer.isRunning(),
  port:    obsServer.getPort() || store.get('obsServerPort', 7777),
}));

// ─── IPC : test overlay ──────────────────────────────────────────────────────
ipcMain.on('test-overlay', () => {
  if (!overlayWindow) return;
  const positions = ['top-left','top','top-right','bottom-left','center','bottom-right'];
  const position  = store.get('randomPosition', false)
    ? positions[Math.floor(Math.random() * positions.length)]
    : store.get('selectedPosition', 'top');
  const payload = {
    url: 'https://media.tenor.com/mCFONcUlBn8AAAAC/cat-typing.gif',
    type: 'gif', text: "Test MemeFlash — l'overlay fonctionne !",
    author: 'MemeFlash', position, platform: null,
    volume: store.get('volume', 50) / 100,
    imageDuration: store.get('imageDuration', 8) * 1000,
    maxDuration: 30000,
    announceSound: store.get('announceSound', false),
    messageId: null, channelId: null,
  };
  lastPayload = payload;
  refreshTrayMenu();
  overlayWindow.showInactive();
  overlayWindow.webContents.send('show-media', payload);
  obsServer.broadcast('show-media', payload);
});

// ─── IPC : auto-updater ──────────────────────────────────────────────────────
let updateReady = false;
ipcMain.on('install-update', () => {
  if (!updateReady) return;
  forceQuit = true;
  if (tray)          { tray.destroy(); tray = null; }
  if (discordClient) { discordClient.destroy(); discordClient = null; }
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
});

function setupAutoUpdater() {
  if (!app.isPackaged || process.platform === 'darwin') return;
  autoUpdater.autoDownload   = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-available', info.version);
  });
  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) mainWindow.webContents.send('download-progress', Math.floor(p.percent));
  });
  autoUpdater.on('update-downloaded', () => {
    updateReady = true;
    if (mainWindow) mainWindow.webContents.send('update-downloaded');
  });
  autoUpdater.on('error', (e) => console.error('[Updater]', e.message));
  autoUpdater.checkForUpdates().catch(() => {});
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  migrateFromOldInstall();
  createMainWindow();
  createOverlayWindow();
  createTray();
  registerHotkeys();

  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      args: ['--hidden'],
    });
  }
  app.on('activate', showMainWindow);

  const token = store.get('token', '');
  let channelIds = store.get('channelIds', null);
  if (!channelIds) { const old = store.get('channelId', ''); channelIds = old ? [old] : []; }
  if (token && channelIds.length) startDiscordBot(token, channelIds);

  // OBS server auto-start si activé
  if (store.get('obsServerEnabled', false)) {
    try { await obsServer.start(store.get('obsServerPort', 7777)); } catch (e) { console.error('[OBS] start:', e.message); }
  }

  setupAutoUpdater();
});

app.on('before-quit', () => {
  forceQuit = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (discordClient) { discordClient.destroy(); discordClient = null; }
  globalShortcut.unregisterAll();
  obsServer.stop();
});

app.on('window-all-closed', () => { /* app vit dans le tray */ });
