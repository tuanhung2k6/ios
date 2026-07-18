const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Try loading optional dependencies ────────────────────────────────────────
let qrcode;
try { qrcode = require('qrcode-terminal'); } catch (_) {}

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 9898;
const SCRIPTS_DIR = path.join(__dirname, 'saved_scripts');
const DATA_DIR = path.join(__dirname, 'data');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
const REGISTRATION_TIMEOUT_MS = 8000;

// Ensure required directories exist
[SCRIPTS_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Utility: Get Local WiFi IP ───────────────────────────────────────────────
function getLocalIPAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const priority = /wi-fi|wlan|en0|eth0/i.test(name) ? 0 : 1;
        candidates.push({ address: net.address, name, priority });
      }
    }
  }
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.length > 0 ? candidates[0] : null;
}

// ─── In-Memory State ──────────────────────────────────────────────────────────
let devices = {};
let webClients = new Set();
let deviceSlotCounter = 0;

// ─── Analytics State ──────────────────────────────────────────────────────────
let analytics = loadJSON(ANALYTICS_FILE, {
  totalRuns: 0, totalTaps: 0, totalSwipes: 0,
  totalRunTimeMs: 0, devices: {}, sessions: []
});

function loadJSON(filePath, defaultVal) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {}
  return defaultVal;
}

function saveJSON(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
}

function recordAnalytics(udid, event, data = {}) {
  if (!analytics.devices[udid]) {
    analytics.devices[udid] = { udid, runs: 0, taps: 0, swipes: 0, totalMs: 0, lastRun: null };
  }
  const dev = analytics.devices[udid];
  if (event === 'run_start') {
    analytics.totalRuns++;
    dev.runs++;
    dev.lastRun = new Date().toISOString();
  } else if (event === 'tap') {
    analytics.totalTaps++;
    dev.taps++;
  } else if (event === 'swipe') {
    analytics.totalSwipes++;
    dev.swipes = (dev.swipes || 0) + 1;
  } else if (event === 'run_end') {
    const ms = data.ms || 0;
    analytics.totalRunTimeMs += ms;
    dev.totalMs += ms;
    analytics.sessions.push({ udid, startedAt: data.startedAt, durationMs: ms });
    if (analytics.sessions.length > 200) analytics.sessions = analytics.sessions.slice(-200);
  }
  saveJSON(ANALYTICS_FILE, analytics);
  broadcastToWebClients({ type: 'analytics_update', analytics });
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
let schedules = loadJSON(SCHEDULES_FILE, []);
let schedulerCheckerInterval = null;
let scriptRunTimers = {}; // scheduleId → timeout handle

function startScheduler() {
  if (schedulerCheckerInterval) clearInterval(schedulerCheckerInterval);
  schedulerCheckerInterval = setInterval(checkSchedules, 30000); // check every 30s
  checkSchedules(); // immediate check on start
}

function checkSchedules() {
  const now = new Date();
  const HH = String(now.getHours()).padStart(2, '0');
  const MM = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${HH}:${MM}`;
  const currentDay = now.getDay(); // 0=Sun...6=Sat

  schedules.forEach(schedule => {
    if (!schedule.enabled) return;
    if (schedule.time !== currentTime) return;
    if (schedule.days && schedule.days.length > 0 && !schedule.days.includes(currentDay)) return;

    // Avoid double-fire within same minute
    const lastFired = schedule.lastFired ? new Date(schedule.lastFired) : null;
    if (lastFired && (now - lastFired) < 60000) return;

    console.log(`[Scheduler] Firing schedule "${schedule.name}" at ${currentTime}`);
    schedule.lastFired = now.toISOString();
    saveJSON(SCHEDULES_FILE, schedules);
    broadcastToWebClients({ type: 'schedule_fired', scheduleId: schedule.id, name: schedule.name });

    // Execute on target devices
    const targetUdids = schedule.deviceUdids || Object.keys(devices);
    const scriptContent = schedule.scriptContent || '';

    targetUdids.forEach(udid => {
      const target = devices[udid];
      if (target && target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(JSON.stringify({
          type: 'run_script',
          script: scriptContent,
          name: schedule.scriptName || 'scheduled.lua',
          loopCount: schedule.loopCount || 1,
          loopDelay: schedule.loopDelay || 0
        }));
      }
    });
  });
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── REST API: Server Info ────────────────────────────────────────────────────
app.get('/api/server-info', (req, res) => {
  const ipInfo = getLocalIPAddress();
  res.json({ success: true, ip: ipInfo ? ipInfo.address : '127.0.0.1', port: PORT, deviceCount: Object.keys(devices).length });
});

// ─── REST API: Scripts (with folder support) ──────────────────────────────────

// Helper: sanitize folder path so it stays within SCRIPTS_DIR
function resolveScriptsPath(folder) {
  const resolved = folder ? path.resolve(SCRIPTS_DIR, folder) : SCRIPTS_DIR;
  if (!resolved.startsWith(SCRIPTS_DIR)) return SCRIPTS_DIR; // safety
  return resolved;
}

app.get('/api/scripts', (req, res) => {
  const folder = req.query.folder || '';
  const dir = resolveScriptsPath(folder);
  try {
    if (!fs.existsSync(dir)) return res.json({ success: true, scripts: [], folders: [] });
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const scripts = entries
      .filter(e => e.isFile() && e.name.endsWith('.lua'))
      .map(e => {
        const fullPath = path.join(dir, e.name);
        const stats = fs.statSync(fullPath);
        return { name: e.name, folder, size: stats.size, modifiedAt: stats.mtime, content: fs.readFileSync(fullPath, 'utf8') };
      });
    const folders = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: folder ? `${folder}/${e.name}` : e.name }));
    res.json({ success: true, scripts, folders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/scripts/save', (req, res) => {
  const { name, content, folder } = req.body;
  if (!name || content === undefined) return res.status(400).json({ success: false, error: 'Missing name or content' });
  const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/\.lua$/, '') + '.lua';
  const dir = resolveScriptsPath(folder || '');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, safeName), content, 'utf8');
    res.json({ success: true, name: safeName, folder: folder || '' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/scripts/:name', (req, res) => {
  const folder = req.query.folder || '';
  const dir = resolveScriptsPath(folder);
  const filePath = path.join(dir, req.params.name);
  try {
    if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); res.json({ success: true }); }
    else res.status(404).json({ success: false, error: 'Not found' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/folders/create', (req, res) => {
  const { name, parent } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Missing name' });
  const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, '_');
  const dir = path.join(resolveScriptsPath(parent || ''), safeName);
  try {
    fs.mkdirSync(dir, { recursive: true });
    res.json({ success: true, path: parent ? `${parent}/${safeName}` : safeName });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/folders/:name', (req, res) => {
  const folder = req.query.parent || '';
  const dir = path.join(resolveScriptsPath(folder), req.params.name);
  try {
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true }); res.json({ success: true }); }
    else res.status(404).json({ success: false, error: 'Not found' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── REST API: Devices ────────────────────────────────────────────────────────
app.get('/api/devices', (req, res) => {
  res.json({ success: true, devices: Object.values(devices).map(d => d.info) });
});

// ─── REST API: Schedules ──────────────────────────────────────────────────────
app.get('/api/schedules', (req, res) => {
  res.json({ success: true, schedules });
});

app.post('/api/schedules', (req, res) => {
  const s = req.body;
  if (!s.time || !s.scriptContent) return res.status(400).json({ success: false, error: 'Missing time or scriptContent' });
  const schedule = {
    id: `sch_${Date.now()}`,
    name: s.name || 'Unnamed Schedule',
    time: s.time,
    days: s.days || [0,1,2,3,4,5,6],
    scriptName: s.scriptName || 'scheduled.lua',
    scriptContent: s.scriptContent,
    deviceUdids: s.deviceUdids || [],
    loopCount: s.loopCount || 1,
    loopDelay: s.loopDelay || 0,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastFired: null
  };
  schedules.push(schedule);
  saveJSON(SCHEDULES_FILE, schedules);
  res.json({ success: true, schedule });
});

app.patch('/api/schedules/:id', (req, res) => {
  const idx = schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
  schedules[idx] = { ...schedules[idx], ...req.body };
  saveJSON(SCHEDULES_FILE, schedules);
  broadcastToWebClients({ type: 'schedules_updated', schedules });
  res.json({ success: true, schedule: schedules[idx] });
});

app.delete('/api/schedules/:id', (req, res) => {
  const before = schedules.length;
  schedules = schedules.filter(s => s.id !== req.params.id);
  saveJSON(SCHEDULES_FILE, schedules);
  if (schedules.length < before) res.json({ success: true });
  else res.status(404).json({ success: false, error: 'Not found' });
});

// ─── REST API: Analytics ──────────────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  res.json({ success: true, analytics });
});

app.delete('/api/analytics', (req, res) => {
  analytics = { totalRuns: 0, totalTaps: 0, totalSwipes: 0, totalRunTimeMs: 0, devices: {}, sessions: [] };
  saveJSON(ANALYTICS_FILE, analytics);
  broadcastToWebClients({ type: 'analytics_update', analytics });
  res.json({ success: true });
});

// ─── Broadcast Helper ─────────────────────────────────────────────────────────
function broadcastToWebClients(data) {
  const payload = JSON.stringify(data);
  webClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function safeClose(ws, code = 1000, reason = '') {
  try { ws.close(code, reason); } catch (_) {}
}

// ─── WebSocket Connection Handler ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  let connectionType = null;
  let deviceUdid = null;
  let scriptStartTime = null;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const registrationTimer = setTimeout(() => {
    if (connectionType === null) {
      console.warn(`[Server] Unidentified connection — closing.`);
      safeClose(ws, 4000, 'Registration timeout');
    }
  }, REGISTRATION_TIMEOUT_MS);

  ws.on('message', (rawMessage) => {
    let data;
    try { data = JSON.parse(rawMessage); } catch { return; }

    // ── Web UI ──
    if (data.clientType === 'web_ui' && connectionType === null) {
      clearTimeout(registrationTimer);
      connectionType = 'web';
      webClients.add(ws);
      const ipInfo = getLocalIPAddress();
      ws.send(JSON.stringify({
        type: 'init',
        devices: Object.values(devices).map(d => d.info),
        serverInfo: { ip: ipInfo ? ipInfo.address : '127.0.0.1', port: PORT },
        schedules,
        analytics
      }));
      return;
    }

    // ── Device Registration ──
    if (data.type === 'register_device' && connectionType === null) {
      clearTimeout(registrationTimer);
      connectionType = 'device';
      deviceUdid = data.info.udid;
      deviceSlotCounter++;
      const deviceIp = data.info.ip || req.socket.remoteAddress;
      devices[deviceUdid] = {
        ws,
        info: {
          udid: data.info.udid, ip: deviceIp,
          model: data.info.model || 'iPhone',
          name: data.info.name || `Device #${deviceSlotCounter}`,
          ios_version: data.info.ios_version || 'Unknown',
          battery: data.info.battery || null,
          status: 'online', slot: deviceSlotCounter,
          vnc_port: data.info.vnc_port || null,
          connectedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        }
      };
      console.log(`[Server] Device registered: ${data.info.name} (${deviceIp})`);
      broadcastToWebClients({ type: 'device_connected', device: devices[deviceUdid].info });
      return;
    }

    // ── Web UI Commands ──
    if (connectionType === 'web') {
      const target = devices[data.targetUdid];

      if (data.action === 'run_script') {
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.info.status = 'running';
          target.info.lastSeen = new Date().toISOString();
          broadcastToWebClients({ type: 'device_status_change', device: target.info });
          target.ws.send(JSON.stringify({
            type: 'run_script', script: data.script, name: data.scriptName || 'unnamed.lua',
            loopCount: data.loopCount || 1, loopDelay: data.loopDelay || 0
          }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Device offline or not found.' }));
        }
      } else if (data.action === 'stop_script') {
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({ type: 'stop_script' }));
        }
      } else if (data.action === 'run_all') {
        Object.values(devices).forEach(t => {
          if (t.ws.readyState === WebSocket.OPEN) {
            t.info.status = 'running';
            broadcastToWebClients({ type: 'device_status_change', device: t.info });
            t.ws.send(JSON.stringify({
              type: 'run_script', script: data.script, name: data.scriptName || 'unnamed.lua',
              loopCount: data.loopCount || 1, loopDelay: data.loopDelay || 0
            }));
          }
        });
      } else if (data.action === 'stop_all') {
        Object.values(devices).forEach(t => {
          if (t.ws.readyState === WebSocket.OPEN) t.ws.send(JSON.stringify({ type: 'stop_script' }));
        });
      } else if (data.action === 'request_screenshot') {
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({ type: 'request_screenshot' }));
        }
      }
      return;
    }

    // ── Device Reports ──
    if (connectionType === 'device' && deviceUdid && devices[deviceUdid]) {
      const deviceInfo = devices[deviceUdid].info;
      deviceInfo.lastSeen = new Date().toISOString();

      if (data.type === 'log') {
        // Parse analytics from log messages
        const msg = data.message || '';
        if (msg.startsWith('Click:') || msg.includes('tap')) recordAnalytics(deviceUdid, 'tap');
        else if (msg.includes('Vuốt') || msg.includes('swipe')) recordAnalytics(deviceUdid, 'swipe');

        broadcastToWebClients({
          type: 'device_log', udid: deviceUdid,
          message: msg, level: data.level || 'info',
          timestamp: new Date().toLocaleTimeString('vi-VN')
        });
      } else if (data.type === 'status_report') {
        const wasRunning = deviceInfo.status === 'running';
        deviceInfo.status = data.status;
        if (data.battery !== undefined) deviceInfo.battery = data.battery;

        if (wasRunning && data.status === 'online') {
          // Script just finished
          const elapsedMs = scriptStartTime ? Date.now() - scriptStartTime : 0;
          recordAnalytics(deviceUdid, 'run_end', { ms: elapsedMs, startedAt: scriptStartTime ? new Date(scriptStartTime).toISOString() : null });
          scriptStartTime = null;
        } else if (!wasRunning && data.status === 'running') {
          scriptStartTime = Date.now();
          recordAnalytics(deviceUdid, 'run_start');
        }

        broadcastToWebClients({ type: 'device_status_change', device: deviceInfo });
      } else if (data.type === 'screenshot') {
        broadcastToWebClients({
          type: 'device_screenshot', udid: deviceUdid,
          imageBase64: data.imageBase64, width: data.width, height: data.height
        });
      }
    }
  });

  ws.on('error', err => console.error(`[Server] WS error: ${err.message}`));

  ws.on('close', () => {
    clearTimeout(registrationTimer);
    if (connectionType === 'web') {
      webClients.delete(ws);
    } else if (connectionType === 'device' && deviceUdid) {
      console.log(`[Server] Device disconnected: ${deviceUdid}`);
      if (devices[deviceUdid]) {
        const info = { ...devices[deviceUdid].info, status: 'offline' };
        broadcastToWebClients({ type: 'device_disconnected', device: info });
        delete devices[deviceUdid];
      }
    }
  });
});

// ─── VNC WebSocket Proxy ──────────────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const proxyMatch = req.url.match(/^\/novnc-proxy\/([^\/]+)/);
  if (proxyMatch) {
    const device = devices[proxyMatch[1]];
    if (!device || !device.info.vnc_port) { socket.destroy(); return; }
    const net = require('net');
    const ts = net.connect(device.info.vnc_port, device.info.ip, () => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      ts.pipe(socket); socket.pipe(ts);
    });
    ts.on('error', () => socket.destroy());
    socket.on('error', () => ts.destroy());
    socket.on('close', () => ts.destroy());
  }
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 10000);

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const ipInfo = getLocalIPAddress();
  const ip = ipInfo ? ipInfo.address : '127.0.0.1';
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║         iOSControl Dashboard Server v3.0         ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Local:   http://localhost:${PORT}                  ║`);
  console.log(`║  Network: http://${ip}:${PORT}                 ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  IP cho iOS App: ${ip.padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
  if (qrcode) { console.log('QR Code:\n'); qrcode.generate(`http://${ip}:${PORT}`, { small: true }); }
  startScheduler();
});
