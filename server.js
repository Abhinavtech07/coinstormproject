
// Simple CoinStorm server with token-based ad verification and admin UI endpoints.
// Reads config.json for ad/direct links and admin password.
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Missing config.json in project root.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const DB_FILE = path.join(__dirname, 'coinstorm.db');
const initDB = process.argv.includes('--initdb') || !fs.existsSync(DB_FILE);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_FILE);

function runAsync(sql, params=[]) {
  return new Promise((res, rej) => {
    db.run(sql, params, function(err) {
      if (err) return rej(err);
      res(this);
    });
  });
}
function getAsync(sql, params=[]) {
  return new Promise((res, rej) => {
    db.get(sql, params, (err, row) => {
      if (err) return rej(err);
      res(row);
    });
  });
}
function allAsync(sql, params=[]) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => {
      if (err) return rej(err);
      res(rows);
    });
  });
}

async function setup() {
  if (!initDB) return;
  await runAsync(`CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    username TEXT,
    coins INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 0,
    last_login TEXT,
    daily_count INTEGER DEFAULT 0,
    last_ad_time INTEGER DEFAULT 0
  )`);
  await runAsync(`CREATE TABLE IF NOT EXISTS ad_tokens (
    token TEXT PRIMARY KEY,
    session_id TEXT,
    created_at INTEGER
  )`);
  await runAsync(`CREATE TABLE IF NOT EXISTS redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    reward TEXT,
    amount INTEGER,
    code TEXT,
    created_at INTEGER
  )`);
  console.log('Database initialized.');
}

setup().catch(e => { console.error(e); process.exit(1); });

// Configurable values
const COIN_PER_AD = 10;      // matches frontend reward
const COOLDOWN_MS = 30 * 1000; // 30s cooldown server-side
const AD_MIN_PLAY_MS = 18 * 1000; // token must be used at least this many ms after issue
const DAILY_LIMIT = 50;

app.post('/api/session', async (req, res) => {
  let { sessionId, username } = req.body || {};
  if (sessionId) {
    const s = await getAsync('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
    if (s) return res.json({ ok: true, session: s });
  }
  if (!username) {
    username = `User${Math.floor(Math.random()*90000)+1000}`;
  }
  const newId = uuidv4();
  await runAsync('INSERT INTO sessions (session_id, username, coins, streak, last_login, daily_count, last_ad_time) VALUES (?, ?, 0, 0, ?, 0, 0)',
    [newId, username, new Date().toDateString()]);
  const session = await getAsync('SELECT * FROM sessions WHERE session_id = ?', [newId]);
  res.json({ ok: true, session });
});

app.post('/api/startAd', async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ ok: false, error: 'Missing sessionId' });
  const s = await getAsync('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (!s) return res.status(404).json({ ok: false, error: 'Session not found' });

  const now = Date.now();
  if (now - s.last_ad_time < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - s.last_ad_time))/1000);
    return res.status(429).json({ ok: false, error: `Cooldown. Wait ${remaining}s` });
  }
  if (s.daily_count >= DAILY_LIMIT) {
    return res.status(403).json({ ok: false, error: 'Daily limit reached' });
  }
  const token = uuidv4();
  await runAsync('INSERT INTO ad_tokens (token, session_id, created_at) VALUES (?, ?, ?)', [token, sessionId, now]);
  res.json({ ok: true, token, createdAt: now });
});

app.post('/api/reward', async (req, res) => {
  const { sessionId, token } = req.body || {};
  if (!sessionId || !token) return res.status(400).json({ ok: false, error: 'Missing fields' });

  const t = await getAsync('SELECT * FROM ad_tokens WHERE token = ?', [token]);
  if (!t || t.session_id !== sessionId) return res.status(400).json({ ok: false, error: 'Invalid token' });

  const createdAt = t.created_at;
  const now = Date.now();
  if (now - createdAt < AD_MIN_PLAY_MS) {
    return res.status(400).json({ ok: false, error: 'Ad not played long enough' });
  }

  const s = await getAsync('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (!s) return res.status(404).json({ ok: false, error: 'Session not found' });

  if (now - s.last_ad_time < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - s.last_ad_time))/1000);
    return res.status(429).json({ ok: false, error: `Cooldown. Wait ${remaining}s` });
  }
  if (s.daily_count >= DAILY_LIMIT) {
    return res.status(403).json({ ok: false, error: 'Daily limit reached' });
  }

  const newCoins = s.coins + COIN_PER_AD;
  const newDailyCount = s.daily_count + 1;
  await runAsync('UPDATE sessions SET coins = ?, daily_count = ?, last_ad_time = ? WHERE session_id = ?',
    [newCoins, newDailyCount, now, sessionId]);
  await runAsync('DELETE FROM ad_tokens WHERE token = ?', [token]);

  let bonus = 0;
  if (newDailyCount === 10) bonus = 20;
  if (newDailyCount === 25) bonus = 50;
  if (newDailyCount === 50) bonus = 100;
  if (bonus > 0) {
    await runAsync('UPDATE sessions SET coins = coins + ? WHERE session_id = ?', [bonus, sessionId]);
  }

  const updated = await getAsync('SELECT coins, daily_count FROM sessions WHERE session_id = ?', [sessionId]);
  res.json({ ok: true, coins: updated.coins, dailyCount: updated.daily_count, bonus });
});

app.get('/api/leaderboard', async (req, res) => {
  const rows = await allAsync('SELECT username, coins FROM sessions ORDER BY coins DESC LIMIT 10');
  res.json({ ok: true, leaderboard: rows });
});

app.post('/api/redeem', async (req, res) => {
  const { sessionId, rewardId } = req.body || {};
  if (!sessionId || !rewardId) return res.status(400).json({ ok: false, error: 'Missing fields' });
  const s = await getAsync('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (!s) return res.status(404).json({ ok: false, error: 'Session not found' });

  const rewards = require('./config.json').rewards;
  const r = rewards[rewardId];
  if (!r) return res.status(400).json({ ok: false, error: 'Invalid reward' });
  if (s.coins < r.cost) return res.status(400).json({ ok: false, error: 'Not enough coins' });

  const newCoins = s.coins - r.cost;
  await runAsync('UPDATE sessions SET coins = ? WHERE session_id = ?', [newCoins, sessionId]);
  const code = `${rewardId.toUpperCase()}-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
  await runAsync('INSERT INTO redemptions (session_id, reward, amount, code, created_at) VALUES (?, ?, ?, ?, ?)', [sessionId, r.name, r.cost, code, Date.now()]);
  res.json({ ok: true, code, reward: r.name, remaining: newCoins });
});

// Admin: simple password-protected endpoints
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ ok: false, error: 'Missing password' });
  if (password !== config.server.admin_password) return res.status(403).json({ ok: false, error: 'Invalid password' });
  // return a simple token (not JWT) for admin actions - in production use real auth
  const adminToken = uuidv4();
  // store in memory (simple)
  app.locals.adminToken = adminToken;
  res.json({ ok: true, adminToken });
});

app.use((req, res, next) => {
  // basic admin middleware for endpoints starting with /api/admin/
  if (req.path.startsWith('/api/admin/')) {
    const token = req.headers['x-admin-token'] || req.body.adminToken || req.query.adminToken;
    if (!token || token !== app.locals.adminToken) return res.status(403).json({ ok: false, error: 'Admin auth required' });
  }
  next();
});

app.get('/api/admin/issued', async (req, res) => {
  const rows = await allAsync('SELECT * FROM redemptions ORDER BY created_at DESC LIMIT 100');
  res.json({ ok: true, rows });
});

app.post('/api/admin/create-code', async (req, res) => {
  const { rewardId, count } = req.body || {};
  if (!rewardId) return res.status(400).json({ ok: false, error: 'Missing rewardId' });
  const rewards = require('./config.json').rewards;
  const r = rewards[rewardId];
  if (!r) return res.status(400).json({ ok: false, error: 'Invalid rewardId' });
  const created = [];
  for (let i=0;i<(count||1);i++) {
    const code = `${rewardId.toUpperCase()}-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
    await runAsync('INSERT INTO redemptions (session_id, reward, amount, code, created_at) VALUES (?, ?, ?, ?, ?)', ['ADMIN', r.name, r.cost, code, Date.now()]);
    created.push(code);
  }
  res.json({ ok: true, created });
});

const PORT = process.env.PORT || config.server.port || 3001;
app.listen(PORT, () => {
  console.log(`CoinStorm server listening on ${PORT}`);
});
