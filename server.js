try { await import('dotenv/config'); } catch(e) {}

import express from 'express';
import session from 'express-session';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { WebSocketServer } from 'ws';
import pkg from 'tiktok-live-connector';
const TikTokLiveConnection = pkg.TikTokLiveConnection || pkg.WebcastPushConnection || pkg.default?.WebcastPushConnection || pkg.default || pkg;
const SignConfig = pkg.SignConfig || pkg.default?.SignConfig || {};
import { fileURLToPath } from 'url';

import path from 'path';
import fs from 'fs';

import axios from 'axios';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("✅ Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT env var");
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
      console.log("✅ Firebase Admin initialized via Application Default Credentials");
    }
  } catch (e) {
    console.warn("⚠️ Firebase Admin initialization failed:", e.message);
  }
}

const db = getFirestore(admin.app(), 'ai-studio-android-tiktokli-c9be166c-0106-416a-aa2b-cd8e15472c06');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = 3000;
const USERNAME = process.env.TIKTOK_USERNAME || 'ceoindonesianghost';

// ===== AI Voice Avatar =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'yXG8bh6LkPVmQb2P2UdE'; // Neo Todak - cloned voice
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

app.use('/audio', express.static('audio'));


// UNTUK LOGIN SESSION ADMIN PANEL

app.use(session({
  secret: 'host-panel-secret',
  resave: false,
  saveUninitialized: false, // 🔥 penting
  cookie: {
    httpOnly: true
  }
}));

// ======================================================
// BUAT FOLDER AUDIO JIKA BELUM ADA
// ======================================================

const audioDir = path.join(__dirname, 'audio');

if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir);
}

// ======================================================
// FUNCTION TTS
// ======================================================

function speakText(text) {

    return new Promise((resolve, reject) => {

        // ==================================================
        // VALIDASI
        // ==================================================

        if (!text) {
            reject("Text kosong");
            return;
        }

        // Bersihkan text
        text = String(text)
            .replace(/"/g, '')
            .replace(/\n/g, ' ')
            .trim();

        if (text === '') {
            reject("Text kosong");
            return;
        }

        // ==================================================
        // FILE AUDIO
        // ==================================================

        const fileName =
            `tts_${Date.now()}.mp3`;

        const outputPath =
            path.join(audioDir, fileName);

        // ==================================================
        // COMMAND EDGE-TTS
        // ==================================================

        const command =
            `edge-tts --voice id-ID-GadisNeural --text "${text}" --write-media "${outputPath}"`;

        // ==================================================
        // EXECUTE
        // ==================================================

        exec(command, async (error) => {

            if (error) {

                console.warn(
                    'edge-tts CLI failed or not found, falling back to Google Translate TTS...',
                    error
                );

                try {
                    const fallbackUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=id&client=tw-ob&q=${encodeURIComponent(text)}`;
                    const res = await fetch(fallbackUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    if (!res.ok) {
                        throw new Error(`Google TTS returned status ${res.status}`);
                    }
                    const buffer = await res.arrayBuffer();
                    await fs.promises.writeFile(outputPath, Buffer.from(buffer));
                    
                    console.log('TTS Saved (via Google Fallback):', outputPath);
                    resolve(`/audio/${fileName}`);
                    
                    // Auto delete after 30 seconds
                    setTimeout(() => {
                        fs.unlink(outputPath, (err) => {
                            if (err) console.log('Gagal hapus:', fileName);
                        });
                    }, 30000);
                } catch (fallbackErr) {
                    console.error('TTS Fallback Error:', fallbackErr);
                    reject(error);
                }
                return;
            }

            console.log(
                'TTS Saved:',
                outputPath
            );

            // ==================================================
            // RETURN URL AUDIO
            // ==================================================

            resolve(`/audio/${fileName}`);

            // ==================================================
            // AUTO DELETE FILE
            // ==================================================

            setTimeout(() => {

                fs.unlink(outputPath, (err) => {

                    if (err) {
                        console.log(
                            'Gagal hapus:',
                            fileName
                        );
                    }

                });

            }, 30000);

        });

    });

}





// ======================================================
// API TTS
// ======================================================

app.use(express.json());

app.post('/tts', async (req, res) => {

    try {

        const text = req.body.text;

        if (!text) {
            return res.status(400).json({
                success: false,
                error: 'Text kosong'
            });
        }

        const audioUrl = await speakText(text);

        res.json({
            success: true,
            audioUrl
        });

    } catch (err) {

        console.error('TTS ROUTE ERROR:', err);

        res.status(500).json({
            success: false,
            error: String(err)
        });

    }

});


// ===== Supabase REST helper (reusable for all tables) =====
async function supabaseRest(method, table, query = '', body = null, headers = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false, error: 'No Supabase config' };
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err, status: res.status };
    }
    const text = await res.text();
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ======================================================
// SINKRONISASI DATA HOST DARI FIREBASE KE MEMORY SERVER
// ======================================================



// Menggunakan Listener Real-time Firestore (Hanya dipanggil SEKALI di awal server start)


// ======================================================
// SINKRONISASI DATA HOST DARI FIREBASE KE MEMORY SERVER
// ======================================================

const HOST_PINS = {};
let cachedHostsArray = [];
let firstSyncDone = false;

// Listener Firestore dengan auto reconnect
function startHostListener() {
  console.log("🔥 Starting Firestore listener...");
  console.log("🔥 [DEBUG] Firebase App name:", admin.app().name);
  
  try {
      const hostsRef = db.collection("hosts");
      console.log("🔥 [DEBUG] Listening to collection path:", hostsRef.path);
      
      hostsRef.onSnapshot(
        (snapshot) => {
          console.log(`🔥 [DEBUG] Listener active. Snapshot size: ${snapshot.size}`);
          
          Object.keys(HOST_PINS).forEach(key => delete HOST_PINS[key]);
          cachedHostsArray = [];
      
          snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`🔥 [DEBUG] Found doc: ${doc.id}, data keys: ${Object.keys(data)}`);
            cachedHostsArray.push(data);
      
            const hostPin = data.pin || doc.id;
            if (hostPin) {
              HOST_PINS[hostPin] = {
                name: data.name,
                username: data.username,
                expireDate: data.expireDate || null,
                status: data.status || 'active',
                permissions: data.permissions || {}
              };
            }
          });
      
          console.log(`🔥 [SYNC] Hosts loaded: ${cachedHostsArray.length}`);
      
          if (!firstSyncDone) {
            firstSyncDone = true;
            console.log("🔥 HOST SYSTEM READY & SYNCHRONIZED");
            printBanner();
          }
        },
        (error) => {
          console.error("❌ Firestore Listener Error:", error);
      
          // Auto reconnect
          setTimeout(() => {
            console.log("🔄 Reconnecting Firestore listener...");
            startHostListener();
          }, 5000);
        }
      );
  } catch (e) {
      console.error("❌ Error setting up listener:", e);
  }
}

// Ambil data dari RAM
async function loadHosts() {
  return cachedHostsArray;
}

// Jalankan listener SEKALI saat server start
startHostListener();

console.log("🔥 HOST SYSTEM READY & SYNCHRONIZED");



// ==========================================
// API ENDPOINT: LOGIN & AMBIL DATA FIRESTORE
// ==========================================
app.post('/api/login', async (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ success: false, message: 'PIN is required' });
  }

  try {
    console.log(`[LOGIN PROCESS] Memeriksa PIN: ${pin} ke Firestore...`);
    
    // 1. Ambil dokumen dari Firestore secara real-time berdasarkan PIN (ID Dokumen)
    const hostDoc = await db.collection("hosts").doc(pin).get();

    // 2. Jika dokumen PIN tidak ditemukan di Firestore
    if (!hostDoc.exists) {
      console.log(`❌ PIN ${pin} tidak terdaftar di Firestore.`);
      return res.status(401).json({ success: false, message: 'Invalid PIN' });
    }

    const host = hostDoc.data();
    console.log("🟢 DATA FIRESTORE BERHASIL DIRESOLVE:", host);

    // 3. Periksa status keaktifan host
    if (host.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'Your access has been disabled by admin' });
    }

    // 4. Sinkronkan ke objek HOST_PINS lokal memori server jika digunakan oleh socket.io
    if (typeof HOST_PINS !== 'undefined') {
      HOST_PINS[pin] = host;
    }

    // 5. Kirim data lengkap ke browser frontend
    return res.json({
    success: true,
    room: host.username || '',
    hostName: host.name || 'Host',
    status: host.status || 'active',
    expireDate: host.expireDate || null,

    permissions:
    host.permissions || {}
      });

  } catch (err) {
    console.error("💥 Error database saat login:", err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


// ======================================================
// 3. ENDPOINT LIST DATA UNTUK ADMIN PANEL (DENGAN PROTEKSI)
// ======================================================
app.get('/api/admin-hosts/list', async (req, res) => {
  // Proteksi: Jika bukan admin/belum login, tolak request data
  if (!req.session || !req.session.hostUser) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  
  const hosts = await loadHosts();
  res.json(hosts);
});



// ======================================================
// 🛡️ ENDPOINT 1: LOGIN ADMIN PANEL (Username + PIN)
// ======================================================
app.post('/api/admin-hosts/login', async (req, res) => {
  const { username, pin } = req.body;

  if (!username || !pin) {
    return res.status(400).json({ success: false, message: 'Missing data' });
  }

  // Reload data dari Firebase untuk memastikan data paling update saat login
  await loadHosts();

  // Cari di memory apakah ada host yang punya username dan pin yang cocok
  const hostMatch = HOST_PINS[pin];

  if (hostMatch && hostMatch.username === username) {
    // Simpan data login ke session express
    req.session.hostUser = {
      username: hostMatch.username,
      name: hostMatch.name
    };
    return res.json({ success: true, message: 'Admin Login Success' });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid Username or PIN' });
  }
});






// Tambahkan await loadHosts() di akhir setiap fungsi agar memory ter-update seketika
async function addHost(data) {
  await db.collection("hosts").doc(data.pin).set(data);
  await loadHosts(); // 🔥 Sinkronisasi otomatis ke RAM server
}

async function updateHost(pin, data) {
  await db.collection("hosts").doc(pin).update(data);
  await loadHosts(); // 🔥 Sinkronisasi otomatis ke RAM server
}

async function deleteHost(pin) {
  await db.collection("hosts").doc(pin).delete();
  await loadHosts(); // 🔥 Sinkronisasi otomatis ke RAM server
}

async function toggleHost(pin) {
  const doc = await db.collection("hosts").doc(pin).get();
  if (!doc.exists) return;
  const data = doc.data();
  await db.collection("hosts").doc(pin).update({
    status: data.status === "active" ? "inactive" : "active"
  });
  await loadHosts(); // 🔥 Sinkronisasi otomatis ke RAM server
}


// ======================================================
// 🔥 FUNGSI EXTEND HOST (UPDATED & SECURED)
// ======================================================
async function extendHost(pin, days = 30) {
  try {
    const doc = await db.collection("hosts").doc(pin).get();
    if (!doc.exists) {
      console.log(`❌ Gagal extend: Host dengan PIN ${pin} tidak ditemukan.`);
      return;
    }

    const data = doc.data();
    let currentExpire;

    // Antisipasi jika expireDate kosong, corrupt, atau salah format
    if (data.expireDate && !isNaN(Date.parse(data.expireDate))) {
      currentExpire = new Date(data.expireDate);
    } else {
      currentExpire = new Date(); // Jika kosong/invalid, mulai perpanjang dari hari ini
    }

    // Tambahkan jumlah hari (default 30 hari)
    currentExpire.setDate(currentExpire.getDate() + days);
    const newExpireDateStr = currentExpire.toISOString().split("T")[0]; // Format: YYYY-MM-DD

    // 1. Update ke Database Firebase Firestore
    await db.collection("hosts").doc(pin).update({
      expireDate: newExpireDateStr
    });

    // 2. SINKRONISASI INSTAN: Langsung update memory RAM server tanpa restart
    await loadHosts();

    console.log(`✅ Sukses memperpanjang Host PIN: ${pin} sebanyak +${days} hari. Expire baru: ${newExpireDateStr}`);
  } catch (error) {
    console.error(`❌ Error saat menjalankan extendHost untuk PIN ${pin}:`, error);
  }
}





// ===== Multi-Host: Parse HOST_PINS =====

const ACCESS_PIN = process.env.ACCESS_PIN || '';

if (ACCESS_PIN) {
  console.log(`🔐 Access PIN gate enabled`);
}

// ===== StreamSession Class =====
class StreamSession {
  constructor(username, pin, hostName) {
    this.username = username;      // TikTok username = room ID
    this.pin = pin;                // Host's auth PIN
    this.hostName = hostName;      // Display name
    this.viewers = new Map();      // Isolated viewer tracking
    this.connection = null;        // TikTok live connection
    this.connectionState = { connected: false, roomId: null, error: null };
    this.cost = { openaiTokens: 0, elevenlabsChars: 0, voiceCalls: 0 };
    this.createdAt = Date.now();
    this.demoActive = false;
    this.demoInterval = null;
    this.demoJoinTimer = null;
    this.demoStopped = false;
    this.demoViewerIdx = 0;
    this.demoViewerCount = 0;
    this.botsActive = false;
    this.botInterval = null;
    this.botActionInterval = null;
    this.botJoinTimer = null;
    this.botJoinIdx = 0;
  }

  toJSON() {
    return {
      room: this.username,
      hostName: this.hostName,
      viewerCount: this.viewers.size,
      connected: this.connectionState.connected,
      roomId: this.connectionState.roomId,
      cost: this.cost,
      costEstimate: this.getCostEstimate(),
      createdAt: this.createdAt,
      demoActive: this.demoActive,
      botsActive: this.botsActive,
    };
  }

  getCostEstimate() {
    const openaiCost = (this.cost.openaiTokens / 1_000_000) * 0.375;
    const elevenlabsCost = (this.cost.elevenlabsChars / 1000) * 0.30;
    return {
      openai: `$${openaiCost.toFixed(4)}`,
      elevenlabs: `$${elevenlabsCost.toFixed(4)}`,
      total: `$${(openaiCost + elevenlabsCost).toFixed(4)}`,
    };
  }
}

const sessions = new Map();

function getSession(room) {
  if (!room) room = '__default__';
  return sessions.get(room) || null;
}


function isHostExpired(host) {
  if (!host?.expireDate) return false;
  const today = new Date();
  const expireDate = new Date(host.expireDate + 'T23:59:59');
  return today > expireDate;
}


function getHostByRoom(room) {
  return Object.values(HOST_PINS).find(h => h.username === room);
}

function validateRoom(room) {
  const host = getHostByRoom(room);
  if (!host) return false;
  if (host.status !== 'active') return false;
  if (isHostExpired(host)) return false;
  return true;
}

function isHostActive(host) {
  return host && host.status === 'active';
}

// Neo's personality
let NEO_PERSONALITY_PROMPT = `You ARE Neo Todak (Ahmad Fadli). You're the CEO of Todak Studios and VP of Todak Gaming, streaming live on TikTok. You speak casual Manglish — mix Malay and English naturally. You're from Cyberjaya. You love AI, gaming, and tech. Keep responses SHORT — 10 to 25 words max. Sound like a real person talking, NOT reading a script. No emojis. Write exactly how it should be SPOKEN out loud.`;

async function loadNeoPersonality() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('⚠️ No Supabase config — using default Neo personality');
    return;
  }
  try {
    const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };
    const personalityRes = await fetch(`${SUPABASE_URL}/rest/v1/neo_personality?select=trait,dimension,value`, { headers });
    const personality = personalityRes.ok ? await personalityRes.json() : [];
    const factsRes = await fetch(`${SUPABASE_URL}/rest/v1/neo_facts?select=fact,domain&domain=in.(personal,social,gaming,philosophy)&limit=30`, { headers });
    const facts = factsRes.ok ? await factsRes.json() : [];

    if (personality.length === 0 && facts.length === 0) return;

    const traits = personality.map(p => `${p.trait} (${p.dimension}): ${(p.value * 100).toFixed(0)}%`).join('. ');
    const factsList = facts.map(f => f.fact).join('. ');

    NEO_PERSONALITY_PROMPT = `You ARE Neo Todak (Ahmad Fadli), live on TikTok right now. REAL personality: TRAITS: ${traits}. KEY FACTS: ${factsList}. RULES: Casual Manglish, SHORT (10-25 words), real person talk, no emojis, exactly as spoken.`;
    console.log(`🧠 Neo Digital Twin loaded: ${personality.length} traits, ${facts.length} facts`);
  } catch (err) {
    console.error('⚠️ Failed to load Digital Twin:', err.message);
  }
}

const NURIN_MYSTIC_PROMPT = `Kamu adalah Eyang, peramal tua bijaksana dan misterius di TikTok Live. Kamu membaca nasib lewat bola kristal dan kartu tarot. SELALU sebut NAMA VIEWER. Bahasa Indonesia hangat, tenang, dalam. Jangan pakai emoji. Tulis persis seperti yang harus DIUCAPKAN.`;

function buildCommentaryPrompt(eventType, eventData, recentContext, liveContext, viewerProfile, conversationLog) {
  let contextStr = '';
  if (liveContext || conversationLog) {
    const sections = [];
    if (liveContext) {
      const topStr = liveContext.topGifters?.length ? ` Top: ${liveContext.topGifters.join(', ')}` : '';
      sections.push(`[LIVE] ${liveContext.uptimeMinutes || 0}m. ${liveContext.viewerCount || 0}v. ${liveContext.totalReadings || 0}r.${topStr}`);
    }
    if (viewerProfile) {
      sections.push(`[VIEWER ${viewerProfile.name}] ${viewerProfile.isReturning ? 'RETURNING' : 'NEW'} readings: ${viewerProfile.readingsCount}, gifts: ${viewerProfile.totalGifted}💎, zodiac: ${viewerProfile.zodiac}`);
    }
    if (conversationLog?.length) {
      sections.push(`[PERCAKAPAN]\n${conversationLog.join('\n')}`);
    }
    contextStr = sections.join('\n\n');
  } else if (recentContext?.length) {
    contextStr = `Recent context: ${recentContext.join('; ')}`;
  }
  switch (eventType) {
    case 'gift': return `${contextStr}\n${eventData.nickname} sent ${eventData.repeatCount}x ${eventData.giftName} (${eventData.diamondCount} diamonds). Thank them casually.`;
    case 'chat': return `${contextStr}\n${eventData.nickname} said: "${eventData.comment}". Respond naturally.`;
    default: return `${contextStr}\nSomething happened on stream (${eventType}). Give a casual comment.`;
  }
}

// =====================================================
// Serve static files
// =====================================================

app.use(express.json());

// =======================================
// Block direct HTML access
// =======================================

// =======================================
// Middleware: Validasi Akses Room (Multi-Host)
// =======================================
app.use((req, res, next) => {
  // Abaikan API internal
  if (req.path.startsWith('/api') || req.path.startsWith('/admin-hosts')) return next();

  // Daftar file yang memerlukan proteksi room
  const protectedFiles = [
    '/overlay.html', '/game.html', '/buble2.html', '/konsermusik.html', '/wingsofdevil.html',
    '/phainonbattle.html', '/footballbattle.html', '/fishbattle.html', '/fishstrike.html',
    '/gearwars.html', '/printer.html', '/stickmanbattle.html', '/royalebattle.html',
    '/towerclimber.html', '/gokusurvival.html', '/battle2d.html', '/spiderhero.html',
    '/fishing.html', '/swimming.html', '/mbgwar.html'
  ];

  if (!protectedFiles.includes(req.path)) return next();

  // Ambil parameter room dari URL
  const room = req.query.room;
  if (!room) {
    console.log(`[AUTH] Blocked access to ${req.path} - Missing room parameter`);
    return res.status(403).send('<h1>Parameter ?room=[username] diperlukan</h1>');
  }

  // Validasi keaktifan host berdasarkan room (username)
  if (!validateRoom(room)) {
    console.log(`[AUTH] Blocked access to ${req.path} for room ${room} - Invalid or Expired`);
    return res.status(403).send('<h1>⛔ Akses Ditolak</h1><p>Masa Aktif Host tidak ditemukan atau sudah habis.</p>');
  }

  next();
});


app.get('/api/admin-hosts/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range");
  res.header("Access-Control-Expose-Headers", "Content-Length, Content-Range");
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Routes
function protectedGame(pageFile, gameKey) {
  return (req, res) => {
    const room = req.query.room;
    console.log(`[DEBUG] protectedGame called for ${pageFile}, room: ${room}`);
    if (!room) return res.status(403).send('Room Required');
    const host = getHostByRoom(room);
    console.log(`[DEBUG] host found: ${!!host}, validateRoom: ${validateRoom(room)}`);
    if (!host || !validateRoom(room)) return res.status(403).send('Access Denied');
    const fullPath = path.join(__dirname, 'public', pageFile);
    console.log(`[DEBUG] Serving file: ${fullPath}`);
    res.sendFile(fullPath);
  };
}

app.get('/buble2', protectedGame('buble2.html', 'buble2'));
app.get('/konsermusik', protectedGame('konsermusik.html', 'konsermusik'));
app.get('/wingsofdevil', protectedGame('wingsofdevil.html', 'wingsofdevil'));
app.get('/phainonbattle', protectedGame('phainonbattle.html', 'phainonbattle'));
app.get('/gearwars', protectedGame('gearwars.html', 'gearwars'));
app.get('/printer', protectedGame('printer.html', 'printer'));
app.get('/mbgwar', protectedGame('mbgwar.html', 'mbgwar'));
app.get('/footballbattle', protectedGame('footballbattle.html', 'footballbattle'));
app.get('/fishbattle', protectedGame('fishbattle.html', 'fishbattle'));
app.get('/fishstrike', protectedGame('fishstrike.html', 'fishstrike'));
app.get('/stickmanbattle', protectedGame('stickmanbattle.html', 'stickmanbattle'));
app.get('/royalebattle', protectedGame('royalebattle.html', 'royalebattle'));
app.get('/towerclimber', protectedGame('towerclimber.html', 'towerclimber'));
app.get('/gokusurvival', protectedGame('gokusurvival.html', 'gokusurvival'));
app.get('/battle2d', protectedGame('battle2d.html', 'battle2d'));
app.get('/fishing', protectedGame('fishing.html', 'fishing'));
app.get('/spiderhero', protectedGame('spiderhero.html', 'spiderhero'));
app.get('/swimming', protectedGame('swimming.html', 'swimming'));
app.get('/overlay', protectedGame('overlay.html', 'overlay'));
app.get('/game', protectedGame('game.html', 'game'));

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.set('Cache-Control', 'no-store')
}));

const isAdmin = (req, res, next) => {
  if (req.session && req.session.hostUser) next();
  else res.status(401).json({ success: false, message: "Unauthorized" });
};

app.get('/api/admin-hosts/list', isAdmin, async (req, res) => {
  const hosts = await loadHosts();
  res.json(hosts);
});

app.post('/admin-hosts/add', isAdmin, async (req, res) => {
  try {
    const { pin, name, username, expireDate, permissions } = req.body;
    await addHost({ pin, name, username, expireDate, status: 'active', permissions: permissions || {} });
    res.json({ success: true, message: "Host berhasil ditambahkan" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/admin-hosts/update', isAdmin, async (req, res) => {
  try {
    const { pin, name, username, expireDate, permissions } = req.body;
    await updateHost(pin, { name, username, expireDate, permissions: permissions || {} });
    res.json({ success: true, message: "Host berhasil diperbarui" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/admin-hosts/toggle', isAdmin, async (req, res) => {
  try { await toggleHost(req.body.pin); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/admin-hosts/extend', isAdmin, async (req, res) => {
  try { await extendHost(req.body.pin, 30); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/admin-hosts/delete', isAdmin, async (req, res) => {
  try { await deleteHost(req.body.pin); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/config', (req, res) => {
  const room = req.query.room;
  const session = getSession(room);
  res.json({
    username: session ? session.username : USERNAME,
    connected: session ? session.connectionState.connected : false,
    room: session ? session.username : '',
  });
});

app.post('/api/host/auth', async (req, res) => {
  try {
    const { username, pin } = req.body;
    if (!pin || !username) return res.status(400).json({ success: false });
    const doc = await db.collection("hosts").doc(String(pin)).get();
    if (!doc.exists) return res.status(401).json({ success: false });
    const user = doc.data();
    if (user.username !== username || user.status !== "active") return res.status(401).json({ success: false });
    req.session.hostUser = { username: user.username, pin: String(pin) };
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ success: false }); }
});

app.get('/api/auth/check', (req, res) => {
  res.json({ needsPin: cachedHostsArray.length > 0 || !!ACCESS_PIN });
});

app.get('/api/sessions', (req, res) => {
  res.json(Array.from(sessions.values()).map(s => s.toJSON()));
});

app.get('/api/session/:room/cost', (req, res) => {
  const session = sessions.get(req.params.room);
  if (!session) return res.json({ room: req.params.room, cost: { voiceCalls: 0 }, estimate: { total: "0.00" } });
  res.json({ room: session.username, cost: session.cost, estimate: session.getCostEstimate() });
});

app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl || imageUrl === 'undefined') return res.status(400).send("Invalid URL");
  try {
    const response = await fetch(imageUrl);
    const buffer = await response.buffer();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.send(buffer);
  } catch (error) { res.status(500).send("Error"); }
});

function connectToTikTok(session) {
  if (process.env.EULER_API_KEY && SignConfig) SignConfig.apiKey = process.env.EULER_API_KEY;
  const ConnectionClass = TikTokLiveConnection || pkg.WebcastPushConnection || pkg.default || pkg;
  const connection = new ConnectionClass(session.username, { enableExtendedGiftInfo: true });
  let connectionReadyAt = Infinity;

  connection.connect().then(state => {
    session.connectionState = { connected: true, roomId: state.roomId, error: null };
    io.to(session.username).emit('connection-status', session.connectionState);
    connectionReadyAt = Date.now() + 3000;
  }).catch(err => {
    console.warn(`⚠️ TikTok Live connection failed for ${session.username}: ${err.message}. Starting Demo/Simulation Mode as fallback.`);
    session.connectionState = { connected: false, roomId: null, error: err.message };
    io.to(session.username).emit('connection-status', session.connectionState);
    
    // Auto-start demo simulation fallback so mini-game and app show live activity instantly
    if (!session.demoActive) {
      session.demoActive = true;
      if (session.demoInterval) clearInterval(session.demoInterval);
      session.demoInterval = setInterval(() => {
        if (!session.demoActive) return;
        const events = ['chat', 'gift', 'like', 'member'];
        const type = events[Math.floor(Math.random() * events.length)];
        const names = ['Andi', 'Siti', 'Budi', 'Dewi', 'Rina', 'Eko', 'Sari', 'Joko'];
        const user = names[Math.floor(Math.random() * names.length)];
        const uniqueId = user.toLowerCase() + Math.floor(Math.random() * 100);
        
        if (type === 'chat') {
          const msgs = ['Halo min!', 'Gacor bang', 'Semangat cett', 'Mabar dong', 'Mantap jiwa 🔥'];
          const comment = msgs[Math.floor(Math.random() * msgs.length)];
          emitToRoom('chat', { nickname: user, uniqueId, comment, profilePic: "https://placehold.co/100" });
        } else if (type === 'gift') {
          const gifts = [{ name: 'Rose', diamonds: 1 }, { name: 'Finger Heart', diamonds: 5 }, { name: 'TikTok', diamonds: 1 }];
          const g = gifts[Math.floor(Math.random() * gifts.length)];
          const repeatCount = Math.floor(Math.random() * 3) + 1;
          emitToRoom('gift', { nickname: user, uniqueId, giftName: g.name, diamondCount: g.diamonds, repeatCount, profilePic: "https://placehold.co/100" });
        } else if (type === 'like') {
          const likeCount = Math.floor(Math.random() * 20) + 5;
          emitToRoom('like', { nickname: user, uniqueId, likeCount, totalLikes: likeCount, profilePic: "https://placehold.co/100" });
        } else if (type === 'member') {
          emitToRoom('viewer-join', { nickname: user, uniqueId, profilePic: "https://placehold.co/100" });
        }
      }, 3500);
    }
  });

  const extractUser = (data) => {
    const user = data.user || data;
    return {
      id: (user.userId || user.uniqueId || '')?.toString(),
      uniqueId: user.uniqueId || '',
      nickname: user.nickname || user.uniqueId || 'Unknown',
      profilePic: user.profilePicture?.url?.[0] || user.avatarThumb?.url?.[0] || '',
      isFollower: (user.followRole || 0) >= 1,
    };
  };

  const emitToRoom = (event, data) => { 
    io.to(session.username).emit(event, data); 
    io.to('__default__').emit(event, data); 
    try {
      const msg = JSON.stringify({ event, username: data.uniqueId || data.username || session.username, ...data });
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(msg);
        }
      });
    } catch(e) {}
  };

  connection.on('member', (data) => {
    const user = extractUser(data);
    if (Date.now() < connectionReadyAt) return;
    emitToRoom('viewer-join', user);
    io.to(session.username).emit('tiktok-action', { event: "join", username: user.uniqueId, detail: "joined", amount: 1 });
  });

  connection.on('chat', (data) => {
    const user = extractUser(data);
    if (Date.now() < connectionReadyAt) return;
    emitToRoom('chat', { ...user, comment: data.comment });
  });

  connection.on('gift', (data) => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    const user = extractUser(data);
    if (Date.now() < connectionReadyAt) return;
    const gift = { ...user, giftName: data.giftDetails?.giftName || 'Gift', diamondCount: data.giftDetails?.diamondCount || 0, repeatCount: data.repeatCount || 1 };
    emitToRoom('gift', gift);
    io.to(session.username).emit('tiktok-action', { event: "gift", username: user.uniqueId, detail: `sent ${gift.giftName}`, amount: gift.repeatCount });
  });

  connection.on('like', (data) => {
    const user = extractUser(data);
    if (Date.now() < connectionReadyAt) return;
    emitToRoom('like', { ...user, totalLikes: data.totalLikeCount });
    io.to(session.username).emit('tiktok-action', JSON.stringify({ event: "like", username: user.uniqueId, detail: "liked", amount: data.likeCount }));
  });

  connection.on('disconnected', () => {
    session.connectionState = { connected: false, roomId: null, error: 'Disconnected' };
    emitToRoom('connection-status', session.connectionState);
  });

  session.connection = connection;
}

// Socket handling
io.on('connection', (socket) => {
  const room = socket.handshake.query.room || '';
  const socketRoom = room || '__default__';
  socket.join(socketRoom);

  const session = sessions.get(room) || sessions.get('__default__');
  if (session) {
    socket.emit('connection-status', session.connectionState);
    socket.emit('viewer-list', Array.from(session.viewers.values()));
  }

  socket.on('register-unity', () => socket.emit('unity-status-ok', { connected: true, activeRoom: socketRoom }));

  socket.on('simulasi-ke-unity', (data) => {
    const paket = { event: data.event || "like", username: data.username || "Viewer", detail: data.detail || "liked", amount: data.amount || 1 };
    io.to(socketRoom).emit('tiktok-action', paket);
    io.emit('tiktok-action', paket);
  });

  socket.on('connect-tiktok', (data) => {
    let username = typeof data === 'object' ? data.username : data;
    let pin = typeof data === 'object' ? data.pin : '';
    let targetRoom = (typeof data === 'object' && data.room) ? data.room : room;

    let sess = sessions.get(targetRoom);
    if (!sess) {
      const host = HOST_PINS[pin];
      if (!host && (ACCESS_PIN || cachedHostsArray.length > 0)) return socket.emit('tiktok-error', { message: 'Invalid PIN' });
      sess = new StreamSession(host ? host.username : username, pin, host ? host.name : 'Host');
      sessions.set(sess.username, sess);
      if (!targetRoom) sessions.set('__default__', sess);
      socket.join(sess.username);
    }
    if (sess.connection) try { sess.connection.disconnect(); } catch(e) {}
    connectToTikTok(sess);
  });

  socket.on('disconnect-tiktok', async (data) => {
    const s = sessions.get(data?.room || room);
    if (s && s.connection) { await s.connection.disconnect(); s.connection = null; }
  });

  socket.on("trigger-print-winner", (data) => io.to(socketRoom).emit("print-winner-hardware", data));
  socket.on("trigger-print-gift", (data) => {
    io.to(socketRoom).emit("print-gift-hardware", data);
    const paket = { event: "gift", username: data.uniqueId, detail: data.giftName, amount: data.repeatCount };
    io.to(socketRoom).emit('tiktok-action', JSON.stringify(paket));
  });

  socket.on('toggle-demo', (data) => {
    const targetRoom = data?.room || room;
    if (!targetRoom) return;
    
    let sess = sessions.get(targetRoom);
    if (!sess) {
      // Create a temporary session if it doesn't exist
      sess = new StreamSession(targetRoom, '', 'Demo Host');
      sessions.set(targetRoom, sess);
    }

    if (sess.demoActive) {
      // STOP DEMO
      sess.demoActive = false;
      if (sess.demoInterval) clearInterval(sess.demoInterval);
      sess.demoInterval = null;
      io.to(targetRoom).emit('demo-status', { active: false });
      console.log(`[DEMO] Stopped for room: ${targetRoom}`);
    } else {
      // START DEMO
      sess.demoActive = true;
      io.to(targetRoom).emit('demo-status', { active: true });
      console.log(`[DEMO] Started for room: ${targetRoom}`);

      sess.demoInterval = setInterval(() => {
        if (!sess.demoActive) return;
        
        const events = ['chat', 'gift', 'like', 'member'];
        const type = events[Math.floor(Math.random() * events.length)];
        const names = ['Budi', 'Siti', 'Andi', 'Agus', 'Dewi', 'Rina', 'Eko', 'Sari'];
        const user = names[Math.floor(Math.random() * names.length)];
        
        let paket = { event: type, username: user, detail: "", amount: 1 };

        switch(type) {
          case 'chat':
            const msgs = ['Halo bang!', 'Gacorrr', 'Semangat!', 'Mabar dong', 'Salken', 'Keren parah'];
            paket.detail = msgs[Math.floor(Math.random() * msgs.length)];
            io.to(targetRoom).emit('chat', { nickname: user, uniqueId: user.toLowerCase(), comment: paket.detail, profilePic: "" });
            break;
          case 'gift':
            const gifts = [
              { name: 'Rose', diamonds: 1 },
              { name: 'Finger Heart', diamonds: 5 },
              { name: 'TikTok', diamonds: 1 },
              { name: 'Perfume', diamonds: 20 },
              { name: 'Cap', diamonds: 99 }
            ];
            const g = gifts[Math.floor(Math.random() * gifts.length)];
            paket.detail = `sent ${g.name}`;
            paket.amount = Math.floor(Math.random() * 5) + 1;
            io.to(targetRoom).emit('gift', { nickname: user, uniqueId: user.toLowerCase(), giftName: g.name, diamondCount: g.diamonds, repeatCount: paket.amount });
            break;
          case 'like':
            paket.detail = "liked";
            paket.amount = Math.floor(Math.random() * 50) + 10;
            io.to(targetRoom).emit('like', { nickname: user, uniqueId: user.toLowerCase(), totalLikes: paket.amount });
            break;
          case 'member':
            paket.event = "join";
            paket.detail = "joined";
            io.to(targetRoom).emit('viewer-join', { nickname: user, uniqueId: user.toLowerCase(), profilePic: "" });
            break;
        }

        io.to(targetRoom).emit('tiktok-action', paket);
      }, 3000);
    }
  });

  socket.on('stop-demo', (data) => {
    const targetRoom = data?.room || room;
    const sess = sessions.get(targetRoom);
    if (sess) {
      sess.demoActive = false;
      if (sess.demoInterval) clearInterval(sess.demoInterval);
      sess.demoInterval = null;
      io.to(targetRoom).emit('demo-status', { active: false });
    }
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/socket.io/')) {
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, req) => {
  console.log('🟢 Android / Raw WebSocket client connected');
  let currentRoom = 'stringartstudioo';
  
  ws.send(JSON.stringify({
    event: 'status',
    comment: `Terhubung ke TikTok Relay Server (@${currentRoom})`,
    isLive: true
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('📩 Raw WS Action:', data);
      const action = data.action;
      const username = data.username || data.user || currentRoom;
      
      if (action === 'SET_USER' || action === 'CONNECT') {
        currentRoom = username.replace('@', '').trim();
        let sess = sessions.get(currentRoom);
        if (!sess) {
          sess = new StreamSession(currentRoom, '', 'Host');
          sessions.set(currentRoom, sess);
        }
        if (sess.connection) try { sess.connection.disconnect(); } catch(e) {}
        connectToTikTok(sess);
        ws.send(JSON.stringify({
          event: 'status',
          comment: `Terhubung ke TikTok Relay (@${currentRoom})`,
          isLive: true
        }));
      } else if (action === 'TEST_EVENT') {
        ws.send(JSON.stringify({
          event: 'chat',
          username: 'TestViewer',
          comment: 'Halo min, selamat live streaming! 🔥'
        }));
      } else if (action === 'TOGGLE_DEMO') {
        const targetRoom = data.room || currentRoom;
        let sess = sessions.get(targetRoom);
        if (!sess) {
          sess = new StreamSession(targetRoom, '', 'Demo Host');
          sessions.set(targetRoom, sess);
        }
        sess.demoActive = !sess.demoActive;
        ws.send(JSON.stringify({
          event: 'status',
          comment: `Demo Mode ${sess.demoActive ? 'AKTIF' : 'MATI'} untuk @${targetRoom}`,
          isLive: true
        }));
      }
    } catch (e) {
      console.error('Raw WS message error:', e);
    }
  });

  ws.on('close', () => {
    console.log('🔴 Android / Raw WebSocket client disconnected');
  });
});

loadNeoPersonality().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on port ${PORT}`));
});

function printBanner() {
  console.log(`🚀 TikTok Multi-Host Server Ready on port ${PORT}`);
}
