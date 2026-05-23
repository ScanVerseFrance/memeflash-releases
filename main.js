'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const { autoUpdater }     = require('electron-updater');
const { Client, GatewayIntentBits } = require('discord.js');
const Store = require('electron-store');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

const store = new Store();
let mainWindow    = null;
let overlayWindow = null;
let discordClient = null;
let tray          = null;
let forceQuit     = false;
let reconnectTimer = null;
const mediaHistory = [];

// ─── Démarrage caché (autostart Windows / macOS) ─────────────────────────────
const startHidden = process.argv.includes('--hidden')
  || app.getLoginItemSettings().wasOpenedAsHidden;

// ─── Single instance lock ─────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => { showMainWindow(); });

// ─── Helper show/focus main window ───────────────────────────────────────────
function showMainWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.setSkipTaskbar(false); mainWindow.focus(); }
}

// ─── Migration depuis l'ancienne installation MemeDrop ───────────────────────
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

// ─── Nettoyage fichiers temp au démarrage ────────────────────────────────────
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

// ─── Détection TikTok ─────────────────────────────────────────────────────────
function isTikTokUrl(url) {
  return /(vm|vt|m)\.tiktok\.com\/\w+|tiktok\.com\/@[\w.]+\/video\/\d+|tiktok\.com\/t\/\w+/.test(url);
}

async function getTikTokMedia(url) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10000);
    const res  = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code === 0 && data.data?.play) {
      // Télécharge dans un fichier temp pour contourner les restrictions CDN TikTok
      const videoRes = await fetch(data.data.play, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer':    'https://www.tiktok.com/',
          'Accept':     'video/mp4,video/*,*/*',
        },
      });
      if (videoRes.ok) {
        const buf     = Buffer.from(await videoRes.arrayBuffer());
        const tmpFile = path.join(os.tmpdir(), `md_${Date.now()}.mp4`);
        fs.writeFileSync(tmpFile, buf);
        return { url: pathToFileURL(tmpFile).toString(), type: 'video' };
      }
    }
  } catch (e) { console.error('[TikTok]', e.message); }
  return null;
}

// ─── Détection Twitter / X ────────────────────────────────────────────────────
function isTwitterUrl(url) {
  return /^https?:\/\/(www\.)?(twitter|x)\.com\/\w+\/status\/\d+/.test(url);
}

async function getTwitterMedia(url) {
  const apis = [
    url.replace(/^https?:\/\/(www\.)?(twitter|x)\.com/, 'https://api.fxtwitter.com'),
    url.replace(/^https?:\/\/(www\.)?(twitter|x)\.com/, 'https://api.vxtwitter.com'),
  ];
  for (const apiUrl of apis) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      const res  = await fetch(apiUrl, { headers: { 'User-Agent': 'MemeFlash/1.0' }, signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const data  = await res.json();
      const tweet = data.tweet;
      if (tweet?.media?.videos?.length) return { url: tweet.media.videos[0].url, type: 'video' };
      if (tweet?.media?.photos?.length) return { url: tweet.media.photos[0].url, type: 'image' };
    } catch (e) { console.error('[Twitter]', apiUrl, e.message); }
  }
  return null;
}

// ─── Détection Streamable ────────────────────────────────────────────────────
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

// ─── Fenêtre de configuration ────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 520, height: 630,
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

// ─── System tray ──────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'build', process.platform === 'darwin' ? 'icon.png' : 'icon.ico');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('MemeFlash');
  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir MemeFlash', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showMainWindow);
}

// ─── Fenêtre overlay ──────────────────────────────────────────────────────────
function createOverlayWindow() {
  const { bounds } = screen.getPrimaryDisplay();
  overlayWindow = new BrowserWindow({
    width: bounds.width + 10, height: bounds.height + 70,
    x: bounds.x - 5, y: bounds.y - 30,
    transparent: true, frame: false, thickFrame: false, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, title: '',
    show: false,                    // Caché au démarrage, montré seulement quand un média arrive
    backgroundColor: '#00000000',  // Transparent total, évite la barre DWM
    roundedCorners: false,          // Windows 11 : désactive le rendu DWM des coins
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

  overlayWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Overlay] crash :', details.reason);
    overlayWindow = null;
    createOverlayWindow();
  });
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

    // ── Ciblage par ping (obligatoire) ───────────────────────────────────
    const mentionsEveryone = message.mentions.everyone;
    if (!mentionsEveryone) {
      if (message.mentions.users.size === 0) return;
      const myDiscordId = store.get('discordUserId', '');
      if (myDiscordId) {
        const mentionedIds = [...message.mentions.users.keys()];
        if (!mentionedIds.includes(myDiscordId)) return;
      }
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

    // 2) Embed Discord (Tenor, Giphy…)
    // Attention : pour Twitter/TikTok, embed.video.url pointe sur l'URL du tweet/tiktok
    // (pas la vidéo directe). On laisse le step 3 gérer ces cas via leurs extracteurs.
    if (!mediaUrl && message.embeds.length > 0) {
      const embed = message.embeds[0];
      if (embed.video?.url && !isTwitterUrl(embed.video.url) && !isTikTokUrl(embed.video.url) && !isStreamableUrl(embed.video.url)) {
        // embed.video.proxyURL en /embeds/ = page HTML Discord, pas un flux vidéo direct
        const proxy = embed.video.proxyURL;
        if (proxy && !proxy.includes('/embeds/')) {
          mediaUrl = proxy; mediaType = 'video';
        } else if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(embed.video.url)) {
          mediaUrl = embed.video.url; mediaType = 'video';
        }
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

    // 3) Liens bruts dans le texte (TikTok, Twitter, médias directs)
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

    const randomPos = store.get('randomPosition', false);
    const positions = ['top-left','top','top-right','bottom-left','center','bottom-right'];
    const position  = randomPos
      ? positions[Math.floor(Math.random() * positions.length)]
      : store.get('selectedPosition', 'top');

    // URL source pour clic dans l'historique (TikTok/Twitter local → URL d'origine)
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
    };

    if (overlayWindow) {
      overlayWindow.showInactive();
      overlayWindow.webContents.send('show-media', payload);
    }

    mediaHistory.unshift({
      url: mediaUrl, type: mediaType, text,
      author: message.author.username,
      platform,
      messageId: message.id,
      channelId: message.channelId,
      sourceUrl,
      liked: false,
      timestamp: new Date().toISOString(),
    });
    if (mediaHistory.length > 50) mediaHistory.pop();
    if (mainWindow) mainWindow.webContents.send('history-update', mediaHistory);
  });

  discordClient.on('error', (err) => {
    console.error('[Bot] Erreur :', err.message);
    if (mainWindow) mainWindow.webContents.send('bot-status', { connected: false, error: err.message });
  });

  discordClient.login(token).catch((err) => {
    console.error('[Bot] Login échoué :', err.message);
    if (mainWindow) mainWindow.webContents.send('bot-status', { connected: false, error: `Login échoué : ${err.message}` });
    // Ne pas retenter si c'est une erreur de token (mauvais token, intent manquant)
    const isAuthError = /TOKEN_INVALID|Privileged intent|Disallowed intent/i.test(err.message);
    if (!isAuthError) {
      reconnectTimer = setTimeout(() => startDiscordBot(token, channelIds), 30000);
    }
  });
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('get-all-settings', (event) => {
  let channelIds = store.get('channelIds', null);
  if (!channelIds) {
    const old = store.get('channelId', '');
    channelIds = old ? [old] : [];
  }
  event.reply('all-settings', {
    token:            store.get('token', ''),
    channelIds,
    discordUserId:    store.get('discordUserId', ''),
    volume:           store.get('volume', 50),
    imageDuration:    store.get('imageDuration', 8),
    announceSound:    store.get('announceSound', false),
    randomPosition:   store.get('randomPosition', false),
    selectedPosition: store.get('selectedPosition', 'top'),
  });
});

ipcMain.on('save-settings', (_e, s) => {
  store.set('volume',           s.volume);
  store.set('imageDuration',    s.imageDuration);
  store.set('announceSound',    s.announceSound);
  store.set('randomPosition',   s.randomPosition);
  store.set('selectedPosition', s.selectedPosition);
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

ipcMain.on('overlay-empty', () => {
  if (overlayWindow) overlayWindow.hide();
});

ipcMain.on('overlay-hover', (_e, hovered) => {
  if (overlayWindow) overlayWindow.setIgnoreMouseEvents(!hovered, { forward: true });
});

// Supprime les fichiers temp vidéo après lecture
ipcMain.on('delete-temp', (_e, fileUrl) => {
  if (!fileUrl?.startsWith('file:')) return;
  try { fs.unlink(fileURLToPath(fileUrl), () => {}); } catch (_) {}
});

// Ouvre une URL dans le navigateur par défaut (clic sur item d'historique)
ipcMain.on('open-external', (_e, url) => {
  if (!url || typeof url !== 'string') return;
  if (!/^https?:\/\//.test(url)) return;   // bloque file://, javascript:, etc.
  shell.openExternal(url).catch(() => {});
});

// Ajoute une réaction ❤️ sur le message Discord d'origine
ipcMain.handle('react-message', async (_e, { channelId, messageId, emoji }) => {
  if (!discordClient || !channelId || !messageId) return { ok: false, error: 'not_connected' };
  try {
    const channel = await discordClient.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.react(emoji || '❤️');
    // Marque l'item comme liké dans l'historique
    const item = mediaHistory.find(m => m.messageId === messageId);
    if (item) {
      item.liked = true;
      if (mainWindow) mainWindow.webContents.send('history-update', mediaHistory);
    }
    return { ok: true };
  } catch (err) {
    console.error('[React]', err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.on('test-overlay', () => {
  if (!overlayWindow) return;
  const positions = ['top-left','top','top-right','bottom-left','center','bottom-right'];
  const position  = store.get('randomPosition', false)
    ? positions[Math.floor(Math.random() * positions.length)]
    : store.get('selectedPosition', 'top');
  overlayWindow.showInactive();
  overlayWindow.webContents.send('show-media', {
    url: 'https://media.tenor.com/mCFONcUlBn8AAAAC/cat-typing.gif',
    type: 'gif', text: "Test MemeFlash — l'overlay fonctionne !",
    author: 'MemeFlash', position, platform: null,
    volume: store.get('volume', 50) / 100,
    imageDuration: store.get('imageDuration', 8) * 1000,
    maxDuration: 30000,
    announceSound: store.get('announceSound', false),
    messageId: null, channelId: null,
  });
});

let updateReady = false;
ipcMain.on('install-update', () => {
  if (!updateReady) return;
  // Libère le close handler du tray avant de quitter
  forceQuit = true;
  if (tray)          { tray.destroy(); tray = null; }
  if (discordClient) { discordClient.destroy(); discordClient = null; }
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
});

// ─── Auto-updater ─────────────────────────────────────────────────────────────
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
app.whenReady().then(() => {
  migrateFromOldInstall();
  createMainWindow();
  createOverlayWindow();
  createTray();
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,         // macOS
      args: ['--hidden'],         // Windows : passé au lancement par le système
    });
  }
  app.on('activate', showMainWindow);
  const token = store.get('token', '');
  let channelIds = store.get('channelIds', null);
  if (!channelIds) { const old = store.get('channelId', ''); channelIds = old ? [old] : []; }
  if (token && channelIds.length) startDiscordBot(token, channelIds);
  setupAutoUpdater();
});

app.on('before-quit', () => {
  forceQuit = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (discordClient) { discordClient.destroy(); discordClient = null; }
});

app.on('window-all-closed', () => { /* app vit dans le tray */ });
