/**
 * TIKTOK LIVE RELAY SERVER FOR RENDER.COM & LAPTOP LOKAL (v2.0)
 * Menghubungkan siaran langsung TikTok ke aplikasi Android TikTok Stream Overlay.
 * Dilengkapi dengan API Proxy Image untuk mengatasi CORS/403 profile picture.
 */

const http = require('http');
const url = require('url');
const os = require('os');
const WebSocket = require('ws');
const fetch = require('node-fetch');

// Coba memuat library tiktok-live-connector
let LiveConnectionClass = null;
try {
    const tklib = require('tiktok-live-connector');
    LiveConnectionClass = tklib.WebcastPushConnection || tklib.TikTokLiveConnection || tklib;
} catch (e) {
    console.error('⚠️ PERINGATAN: Library tiktok-live-connector belum terpasang.');
    console.error('👉 Jalankan di terminal: npm install');
}

// Render.com menyediakan port secara dinamis melalui process.env.PORT
const PORT = process.env.PORT || 3000;
let currentTikTokUser = process.env.TIKTOK_USER || "stringartstudioo";
let currentSessionId = process.env.TIKTOK_SESSION_ID || "";
let tiktokLive = null;
let standbyTimer = null;
let isLiveActive = false;

// Cari IP Local Wi-Fi Laptop (Untuk Penggunaan Lokal)
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const localIp = getLocalIpAddress();

// 1. Buat HTTP Server & Web Dashboard
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const reqUrl = req.url || '/';

    // --- API PROXY IMAGE (Menghindari CORS / 403 saat load Foto Profil TikTok) ---
    if (reqUrl.startsWith('/api/proxy-image')) {
        const parsed = url.parse(reqUrl, true);
        const imageUrl = parsed.query.url;

        if (!imageUrl || imageUrl === 'undefined' || imageUrl === 'true') {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end("URL gambar tidak valid");
            return;
        }

        try {
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            if (!response.ok) throw new Error('Gagal mengambil gambar dari sumber TikTok');

            const buffer = await response.buffer();

            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Cross-Origin-Resource-Policy': 'cross-origin',
                'Content-Type': response.headers.get('content-type') || 'image/jpeg',
                'Cache-Control': 'public, max-age=86400'
            });
            res.end(buffer);
        } catch (error) {
            console.error("Proxy Image Error:", error.message);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end("Gagal memproses gambar");
        }
        return;
    }

    // Endpoint API untuk Mengubah Target Username & SessionId
    if (reqUrl.startsWith('/set-config')) {
        const parsed = url.parse(reqUrl, true);
        const newUser = parsed.query.user;
        const newSessionId = parsed.query.sessionid;

        if (newSessionId !== undefined) {
            currentSessionId = (newSessionId || '').trim();
            console.log(`[CONFIG] Session ID diperbarui.`);
        }

        if (newUser && newUser.trim().length > 0) {
            const cleanUser = newUser.trim().replace('@', '');
            console.log(`[DASHBOARD] Mengganti target TikTok ke: @${cleanUser}`);
            connectTikTok(cleanUser);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: "OK",
                target: cleanUser,
                hasSessionId: !!currentSessionId
            }));
            return;
        }
    }

    // Endpoint API Status Server
    if (reqUrl.startsWith('/status')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: isLiveActive ? "LIVE_ACTIVE" : "STANDBY",
            targetUser: currentTikTokUser,
            hasSessionId: !!currentSessionId,
            clientsConnected: wss.clients.size,
            port: PORT
        }));
        return;
    }

    // Endpoint API untuk Tes Komentar & Gift
    if (reqUrl.startsWith('/test')) {
        sendTestEvents();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: "TEST_SENT", message: "Tes chat dan gift dikirim ke HP!" }));
        return;
    }

    // Halaman Dashboard Web Server
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TikTok Live OBS Relay Server (Render & Local)</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; text-align: center; }
            .card { background: #1e293b; max-width: 620px; margin: 0 auto; padding: 28px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: left; }
            h1 { color: #38bdf8; margin-top: 0; text-align: center; font-size: 22px; }
            .badge { display: inline-block; padding: 6px 12px; border-radius: 20px; font-weight: bold; font-size: 13px; }
            .badge-live { background: #10b981; color: #fff; }
            .badge-standby { background: #f59e0b; color: #000; }
            .btn { background: #2563eb; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 10px; width: 100%; font-size: 15px; }
            .btn-test { background: #059669; margin-top: 8px; }
            input[type="text"] { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; margin-top: 6px; font-size: 15px; }
            .info-box { background: #0f172a; padding: 14px; border-radius: 8px; border-left: 4px solid #38bdf8; margin: 16px 0; font-family: monospace; font-size: 13px; line-height: 1.6; }
            label { font-size: 13px; color: #94a3b8; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🚀 TikTok Live OBS Relay Server</h1>
            <p style="text-align: center;">
                Status: <span class="badge ${isLiveActive ? 'badge-live' : 'badge-standby'}">${isLiveActive ? '🟢 LIVE AKTIF' : '🟡 STANDBY MENUNGGU LIVE'}</span>
            </p>
            
            <div class="info-box">
                <b>URL WebSocket HP Android:</b><br>
                - Render Cloud : <b>wss://${req.headers.host || 'nama-app-anda.onrender.com'}</b><br>
                - Laptop Wi-Fi  : <b>ws://${localIp}:${PORT}</b><br><br>
                Target Saat Ini : <b>@${currentTikTokUser}</b><br>
                Session ID      : <b>${currentSessionId ? 'Terpasang (Bypass 403 Aktif)' : 'Belum Dipasang'}</b>
            </div>

            <form action="/set-config" method="GET">
                <label>GANTI AKUN TIKTOK TARGET:</label>
                <input type="text" name="user" value="${currentTikTokUser}" placeholder="Contoh: stringartstudioo" required />
                
                <div style="margin-top: 14px;">
                    <label>COOKIE SESSIONID TIKTOK (Solusi jika Kena 403 / Bot):</label>
                    <input type="text" name="sessionid" value="${currentSessionId}" placeholder="Tempel sessionid dari browser di sini..." />
                </div>

                <button type="submit" class="btn">Update Pengaturan & Sambungkan</button>
            </form>

            <button onclick="fetch('/test').then(() => alert('Event tes berhasil dikirim ke HP Android!'))" class="btn btn-test">
                🧪 Kirim Tes Komentar & Gift ke HP Android
            </button>
        </div>
    </body>
    </html>
    `);
});

// 2. Buat WebSocket Server untuk HP Android
const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on('connection', ws => {
    clients.add(ws);
    console.log(`📱 [HP ANDROID TERHUBUNG] Client baru (${clients.size} HP tersambung)`);

    ws.send(JSON.stringify({
        event: 'status',
        comment: isLiveActive
            ? `🟢 Terhubung ke relay server! Live @${currentTikTokUser} sedang aktif.`
            : `🟡 Terhubung ke relay server. Menunggu @${currentTikTokUser} mulai Live...`
    }));

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            if (data.action === 'SET_USER' && data.username) {
                const newUser = data.username.replace('@', '').trim();
                if (newUser && newUser !== currentTikTokUser) {
                    console.log(`📱 [HP MINTA GANTI AKUN] Target diubah menjadi: @${newUser}`);
                    connectTikTok(newUser);
                }
            } else if (data.action === 'TEST_EVENT') {
                sendTestEvents();
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`📱 [HP TERPUTUS] Sisa client: ${clients.size}`);
    });
});

function broadcast(obj) {
    const payload = JSON.stringify(obj);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

function sendTestEvents() {
    console.log('🧪 [TES] Mengirim event simulasi chat & gift ke HP...');
    broadcast({
        event: 'chat',
        username: 'penonton_setia',
        comment: 'Halo bang! Overlay TikTok Live-nya keren banget!',
        badge: 'VIP'
    });
    setTimeout(() => {
        broadcast({
            event: 'gift',
            username: 'sultan_tiktok',
            giftName: 'TikTok Universe',
            giftCount: 1,
            diamondCount: 5000
        });
    }, 1000);
}

// Helper ekstraksi aman data TikTok
function extractUserInfo(data) {
    if (!data) return { username: 'Penonton', nickname: 'Penonton' };
    const src = data.chatMessage || data.data || data;
    const userObj = src.user || src.author || src.sender || src;

    const uniqueId = userObj.uniqueId || userObj.displayId || src.uniqueId || data.uniqueId;
    const nickname = userObj.nickname || src.nickname || data.nickname || uniqueId;

    return {
        username: uniqueId || nickname || 'Penonton',
        nickname: nickname || uniqueId || 'Penonton'
    };
}

function extractCommentText(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    const src = data.chatMessage || data.data || data;

    const comment = src.comment || src.content || src.text || src.message || src.commentText ||
                    data.comment || data.content || data.text || data.message;
    if (typeof comment === 'string' && comment.length > 0) return comment;

    for (const key of ['comment', 'content', 'text', 'message', 'msg']) {
        if (src[key] && typeof src[key] === 'string') return src[key];
        if (data[key] && typeof data[key] === 'string') return data[key];
    }
    return '';
}

function extractGiftInfo(data) {
    if (!data) return { giftName: 'Gift', count: 1, diamondCount: 1 };
    const src = data.giftMessage || data.data || data;
    const giftObj = src.gift || src.giftDetails || src;

    const giftName = giftObj.giftName || giftObj.name || src.giftName || data.giftName || 'Gift';
    const count = src.repeatCount || src.count || src.giftCount || giftObj.repeatCount || data.repeatCount || 1;
    const diamonds = src.diamondCount || src.diamonds || giftObj.diamondCount || (count * 1);

    return { giftName, count, diamondCount: diamonds };
}

// Logika Koneksi TikTok Live dengan Mode STANDBY (Auto Retry)
function connectTikTok(username) {
    if (!username) return;
    currentTikTokUser = username.replace('@', '').trim();

    if (standbyTimer) {
        clearTimeout(standbyTimer);
        standbyTimer = null;
    }

    if (tiktokLive) {
        try { tiktokLive.disconnect(); } catch (e) {}
        tiktokLive = null;
    }

    if (!LiveConnectionClass) {
        console.error('❌ Library tiktok-live-connector belum terinstall dengan benar.');
        return;
    }

    console.log(`[TARGET] Menghubungkan ke TikTok: @${currentTikTokUser}...`);
    broadcast({
        event: 'status',
        comment: `Menghubungkan ke @${currentTikTokUser}...`
    });

    try {
        const connectionOptions = {
            processInitialData: false,
            enableExtendedGiftInfo: false,
            enableWebsocketUpgrade: true,
            requestPollingIntervalMs: 2000,
            clientParams: {
                app_language: 'id-ID'
            }
        };

        if (currentSessionId && currentSessionId.trim().length > 0) {
            connectionOptions.sessionId = currentSessionId.trim();
        }

        tiktokLive = new LiveConnectionClass(currentTikTokUser, connectionOptions);

        tiktokLive.on('chat', data => {
            const userInfo = extractUserInfo(data);
            const comment = extractCommentText(data);
            const isMod = !!(data.isModerator || (data.user && data.user.isModerator) || (data.chatMessage && data.chatMessage.isModerator));
            const isSub = !!(data.isSubscriber || (data.user && data.user.isSubscriber) || (data.chatMessage && data.chatMessage.isSubscriber));
            const badge = isMod ? 'Mod' : (isSub ? 'Subscriber' : '');

            console.log(`💬 [CHAT] ${userInfo.username}: ${comment || '(pesan emote)'}`);
            broadcast({
                event: 'chat',
                username: userInfo.username,
                comment: comment || '(pesan emote)',
                badge: badge
            });
        });

        tiktokLive.on('gift', data => {
            const userInfo = extractUserInfo(data);
            const giftInfo = extractGiftInfo(data);
            console.log(`🎁 [GIFT] ${userInfo.username} kirim ${giftInfo.giftName} x${giftInfo.count}`);
            broadcast({
                event: 'gift',
                username: userInfo.username,
                giftName: giftInfo.giftName,
                giftCount: giftInfo.count,
                diamondCount: giftInfo.diamondCount
            });
        });

        tiktokLive.on('like', data => {
            const userInfo = extractUserInfo(data);
            const count = (data && (data.likeCount || data.count || (data.data && data.data.likeCount))) || 1;
            broadcast({ event: 'like', username: userInfo.username, likeCount: count });
        });

        tiktokLive.on('member', data => {
            const userInfo = extractUserInfo(data);
            console.log(`👋 [JOIN] ${userInfo.username} bergabung ke Live`);
            broadcast({ event: 'join', username: userInfo.username });
        });

        tiktokLive.on('streamEnd', () => {
            isLiveActive = false;
            console.log(`[STREAM END] Live berakhir untuk @${currentTikTokUser}. Kembali ke mode Standby...`);
            broadcast({ event: 'status', comment: 'Siaran Live telah berakhir. Masuk mode Standby...' });
            scheduleReconnect();
        });

        tiktokLive.on('error', err => {
            const msg = (err && (err.message || err.toString())) || '';
            if (msg.includes('403') || msg.includes('Failed to sign request')) {
                console.log('⚠️ [TIKTOK NOTICE] Rate limit signature 403. Mengambil jeda sebelum mencoba lagi.');
            } else {
                console.error(`⚠️ [TIKTOK NOTICE] ${msg}`);
            }
        });

        tiktokLive.connect()
            .then(state => {
                isLiveActive = true;
                const roomId = (state && state.roomId) ? state.roomId : 'Aktif';
                console.log(`=======================================================`);
                console.log(`🟢 [LIVE AKTIF] SUKSES TERHUBUNG KE TIKTOK LIVE!`);
                console.log(`   Akun Target : @${currentTikTokUser}`);
                console.log(`   Room ID     : ${roomId}`);
                console.log(`   Komentar & gift penonton langsung dikirim ke HP!`);
                console.log(`=======================================================`);
                broadcast({
                    event: 'status',
                    comment: `🟢 LIVE TERHUBUNG! Room ID: ${roomId}`
                });
            })
            .catch(err => {
                isLiveActive = false;
                const errMsg = (err && (err.message || err.toString())) || '';
                const isOffline = err && (err.name === 'UserOfflineError' || errMsg.includes('ended') || errMsg.includes('offline') || errMsg.includes('not live'));

                if (isOffline) {
                    console.log(`🟡 [STANDBY] @${currentTikTokUser} belum live. Menunggu siaran dimulai...`);
                    broadcast({
                        event: 'status',
                        comment: `STANDBY: Menunggu @${currentTikTokUser} mulai Live di TikTok...`
                    });
                    scheduleReconnect(10000);
                } else if (errMsg.includes('403') || errMsg.includes('Failed to sign request')) {
                    console.log(`⚠️ [TIKTOK 403] Rate limit signature. Menunggu 15 detik...`);
                    broadcast({
                        event: 'status',
                        comment: `PROTEKSI TIKTOK (403): Menunggu jeda antrean koneksi...`
                    });
                    scheduleReconnect(15000);
                } else {
                    console.error(`❌ [ERROR TIKTOK] ${errMsg}`);
                    scheduleReconnect(12000);
                }
            });

    } catch (e) {
        console.error(`❌ Terjadi kesalahan saat inisialisasi: ${e.message}`);
        scheduleReconnect(15000);
    }
}

function scheduleReconnect(delayMs = 10000) {
    if (standbyTimer) clearTimeout(standbyTimer);
    standbyTimer = setTimeout(() => {
        if (!isLiveActive) {
            connectTikTok(currentTikTokUser);
        }
    }, delayMs);
}

// 4. Jalankan Server
server.listen(PORT, '0.0.0.0', () => {
    console.log('==============================================================');
    console.log(`🚀 TIKTOK LIVE RELAY SERVER AKTIF DI PORT ${PORT}!`);
    console.log('==============================================================');
    console.log(`Target Awal Akun TikTok : @${currentTikTokUser}`);
    console.log(`Local Wi-Fi IP          : ${localIp}`);
    console.log('==============================================================');

    connectTikTok(currentTikTokUser);
});
