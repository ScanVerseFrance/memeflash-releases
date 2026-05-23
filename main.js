'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater }     = require('electron-updater');
const { Client, GatewayIntentBits } = require('discord.js');
const Store = require('electron-store');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');

const store = new Store();
let mainWindow    = null;
let overlayWindow = null;
let discordClient = null;
let tray          = null;
let forceQuit     = false;
const mediaHistory = [];

// ─── Migration depuis l'ancienne installation MemeDrop ───────────────────────
function migrateFromOldInstall() {
  if (store.has('token')) return;
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
  return /tiktok\.com\/@[\w.]+\/video\/\d+|vm\.tiktok\.com\/\w+|tiktok\.com\/t\/\w+/.test(url);
}

async function getTikTokMedia(url) {
  try {
    const res  = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
        return { url: `file:///${tmpFile.replace(/\\/g, '/')}`, type: 'video' };
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
  try {
    const apiUrl = url.replace(/^https?:\/\/(www\.)?(twitter|x)\.com/, 'https://api.fxtwitter.com');
    const res    = await fetch(apiUrl, { headers: { 'User-Agent': 'MemeDrop/1.0' } });
    const data   = await res.json();
    const tweet  = data.tweet;
    if (tweet?.media?.videos?.length)  return { url: tweet.media.videos[0].url,  type: 'video' };
    if (tweet?.media?.photos?.length)  return { url: tweet.media.photos[0].url,  type: 'image' };
  } catch (e) { console.error('[Twitter]', e.message); }
  return null;
}

// ─── Fenêtre de configuration ────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 520, height: 630,
    resizable: false,
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
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('MemeFlash');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir MemeFlash',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.setSkipTaskbar(false); mainWindow.focus(); } },
    },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.setSkipTaskbar(false); mainWindow.focus(); }
  });
}

// ─── Fenêtre overlay ──────────────────────────────────────────────────────────
function createOverlayWindow() {
  const { bounds } = screen.getPrimaryDisplay();
  overlayWindow = new BrowserWindow({
    width: bounds.width + 10, height: bounds.height + 70,
    x: bounds.x - 5, y: bounds.y - 30,
    transparent: true, frame: false, thickFrame: false, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, title: '',
    backgroundColor: '#00000000',  // Transparent total, évite la barre DWM
    roundedCorners: false,          // Windows 11 : désactive le rendu DWM des coins
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setSkipTaskbar(true);
  overlayWindow.removeMenu();
  overlayWindow.setMenuBarVisibility(false);
  overlayWindow.setTitle('');
  overlayWindow.loadFile(path.join(__dirname, 'src/overlay/overlay.html'));
}

// ─── Bot Discord ──────────────────────────────────────────────────────────────
function startDiscordBot(token, channelId) {
  if (discordClient) { discordClient.destroy(); discordClient = null; }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  discordClient.once('ready', () => {
    console.log(`[Bot] Connecté : ${discordClient.user.tag}`);
    if (mainWindow) mainWindow.webContents.send('bot-status', { connected: true, tag: discordClient.user.tag });
  });

  discordClient.on('messageCreate', async (message) => {
    if (message.channelId !== channelId) return;
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
    if (!mediaUrl && message.embeds.length > 0) {
      const embed = message.embeds[0];
      if (embed.video?.url) {
        mediaUrl = embed.video.proxyURL || embed.video.url; mediaType = 'video';
      } else if (embed.image?.url) {
        const u = embed.image.url.toLowerCase();
        mediaUrl = embed.image.proxyURL || embed.image.url;
        mediaType = u.includes('.gif') ? 'gif' : 'image';
      } else if (embed.thumbnail?.url) {
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

    const payload = {
      url: mediaUrl, type: mediaType || 'text', text: displayText,
      author:   message.member?.displayName || message.author.globalName || message.author.username,
      avatar:   message.author.displayAvatarURL({ size: 64 }),
      position, platform,
      volume:        store.get('volume', 50) / 100,
      imageDuration: store.get('imageDuration', 8) * 1000,
      maxDuration:   30000,
      announceSound: store.get('announceSound', false),
    };

    if (overlayWindow) overlayWindow.webContents.send('show-media', payload);

    mediaHistory.unshift({
      url: mediaUrl, type: mediaType, text,
      author: message.author.username,
      platform,
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
  });
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('get-all-settings', (event) => {
  event.reply('all-settings', {
    token:            store.get('token', ''),
    channelId:        store.get('channelId', ''),
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
  store.set('channelId',     c.channelId);
  store.set('discordUserId', c.discordUserId || '');
  startDiscordBot(c.token, c.channelId);
});

ipcMain.on('stop-bot', () => {
  if (discordClient) { discordClient.destroy(); discordClient = null; }
  if (mainWindow) mainWindow.webContents.send('bot-status', { connected: false });
});

ipcMain.on('overlay-empty', () => { /* opacité gérée par CSS */ });

ipcMain.on('overlay-hover', (_e, hovered) => {
  if (overlayWindow) overlayWindow.setIgnoreMouseEvents(!hovered, { forward: true });
});

// Supprime les fichiers temp vidéo après lecture
ipcMain.on('delete-temp', (_e, fileUrl) => {
  if (!fileUrl?.startsWith('file:///')) return;
  const filePath = decodeURIComponent(fileUrl.replace('file:///', '')).replace(/\//g, path.sep);
  fs.unlink(filePath, () => {});
});

ipcMain.on('test-overlay', () => {
  if (!overlayWindow) return;
  const positions = ['top-left','top','top-right','bottom-left','center','bottom-right'];
  const position  = store.get('randomPosition', false)
    ? positions[Math.floor(Math.random() * positions.length)]
    : store.get('selectedPosition', 'top');
  overlayWindow.webContents.send('show-media', {
    url: 'https://media.tenor.com/mCFONcUlBn8AAAAC/cat-typing.gif',
    type: 'gif', text: "Test MemeFlash — l'overlay fonctionne !",
    author: 'MemeFlash', position, platform: null,
    volume: store.get('volume', 50) / 100,
    imageDuration: store.get('imageDuration', 8) * 1000,
    maxDuration: 30000,
    announceSound: store.get('announceSound', false),
  });
});

let updateReady = false;
ipcMain.on('install-update', () => {
  if (updateReady) autoUpdater.quitAndInstall(true, true);
});

// ─── Auto-updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) return;
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
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
  }
  const token = store.get('token', ''), channelId = store.get('channelId', '');
  if (token && channelId) startDiscordBot(token, channelId);
  setupAutoUpdater();
});

app.on('before-quit', () => {
  forceQuit = true;
  if (discordClient) { discordClient.destroy(); discordClient = null; }
});

app.on('window-all-closed', () => { /* app vit dans le tray */ });
