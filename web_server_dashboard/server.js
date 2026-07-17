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
const REGISTRATION_TIMEOUT_MS = 8000; // 8 seconds to register or disconnect

// Ensure scripts directory exists
if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

// ─── Utility: Get Local WiFi IP ───────────────────────────────────────────────
function getLocalIPAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal (127.x) and non-IPv4
      if (net.family === 'IPv4' && !net.internal) {
        // Prefer WiFi/ethernet interfaces
        const priority = /wi-fi|wlan|en0|eth0/i.test(name) ? 0 : 1;
        candidates.push({ address: net.address, prefix: net.cidr, name, priority });
      }
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.length > 0 ? candidates[0] : null;
}

// ─── In-Memory Data Store ─────────────────────────────────────────────────────
let devices = {}; // Key: udid
let webClients = new Set();
let deviceSlotCounter = 0;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── REST API: Server Info ────────────────────────────────────────────────────
app.get('/api/server-info', (req, res) => {
  const ipInfo = getLocalIPAddress();
  res.json({
    success: true,
    ip: ipInfo ? ipInfo.address : '127.0.0.1',
    port: PORT,
    networkInterface: ipInfo ? ipInfo.name : 'loopback',
    deviceCount: Object.keys(devices).length
  });
});

// ─── REST API: Scripts ────────────────────────────────────────────────────────
app.get('/api/scripts', (req, res) => {
  try {
    const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.lua'));
    const scripts = files.map(file => {
      const stats = fs.statSync(path.join(SCRIPTS_DIR, file));
      const content = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
      return { name: file, content, size: stats.size, modifiedAt: stats.mtime };
    });
    res.json({ success: true, scripts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/scripts/save', (req, res) => {
  const { name, content } = req.body;
  if (!name || content === undefined) {
    return res.status(400).json({ success: false, error: 'Missing name or content' });
  }
  const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/\.lua$/, '') + '.lua';
  try {
    fs.writeFileSync(path.join(SCRIPTS_DIR, safeName), content, 'utf8');
    res.json({ success: true, message: 'Script saved', name: safeName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/scripts/:name', (req, res) => {
  const name = req.params.name;
  try {
    const filePath = path.join(SCRIPTS_DIR, name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'Script not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── REST API: Devices ────────────────────────────────────────────────────────
app.get('/api/devices', (req, res) => {
  const list = Object.values(devices).map(d => d.info);
  res.json({ success: true, devices: list });
});

// ─── VNC WebSocket Proxy ──────────────────────────────────────────────────────
// Route: /novnc-proxy/:udid
// Proxies incoming browser WebSocket connection → device VNC daemon
server.on('upgrade', (req, socket, head) => {
  const proxyMatch = req.url.match(/^\/novnc-proxy\/([^\/]+)/);
  if (proxyMatch) {
    const targetUdid = proxyMatch[1];
    const device = devices[targetUdid];
    if (!device || !device.info.ip || !device.info.vnc_port) {
      socket.destroy();
      return;
    }

    // Raw TCP tunnel: browser ↔ server ↔ device VNC port
    const net = require('net');
    const targetSocket = net.connect(device.info.vnc_port, device.info.ip, () => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      targetSocket.pipe(socket);
      socket.pipe(targetSocket);
    });

    targetSocket.on('error', () => socket.destroy());
    socket.on('error', () => targetSocket.destroy());
    socket.on('close', () => targetSocket.destroy());
  }
});

// ─── Broadcast Helpers ────────────────────────────────────────────────────────
function broadcastToWebClients(data) {
  const payload = JSON.stringify(data);
  webClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function safeClose(ws, code = 1000, reason = '') {
  try { ws.close(code, reason); } catch (_) {}
}

// ─── WebSocket Connection Handler ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  let connectionType = null;
  let deviceUdid = null;

  // Ping-pong heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // ── Registration Timeout ──
  // If a connection doesn't identify itself in time, close it
  const registrationTimer = setTimeout(() => {
    if (connectionType === null) {
      console.warn(`[Server] Unidentified connection from ${req.socket.remoteAddress} — closing.`);
      safeClose(ws, 4000, 'Registration timeout');
    }
  }, REGISTRATION_TIMEOUT_MS);

  ws.on('message', (rawMessage) => {
    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch (e) {
      console.error('[Server] Non-JSON message received, ignoring.');
      return;
    }

    // ── Web UI Registration ──
    if (data.clientType === 'web_ui' && connectionType === null) {
      clearTimeout(registrationTimer);
      connectionType = 'web';
      webClients.add(ws);
      console.log(`[Server] Web dashboard connected from ${req.socket.remoteAddress}`);

      // Send current state to newly connected dashboard
      const ipInfo = getLocalIPAddress();
      ws.send(JSON.stringify({
        type: 'init',
        devices: Object.values(devices).map(d => d.info),
        serverInfo: {
          ip: ipInfo ? ipInfo.address : '127.0.0.1',
          port: PORT
        }
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
      console.log(`[Server] Device registered: ${data.info.name} (${deviceIp})`);

      devices[deviceUdid] = {
        ws,
        info: {
          udid: data.info.udid,
          ip: deviceIp,
          model: data.info.model || 'iPhone',
          name: data.info.name || `Device #${deviceSlotCounter}`,
          ios_version: data.info.ios_version || 'Unknown',
          battery: data.info.battery || null,
          status: 'online',
          slot: deviceSlotCounter,
          vnc_port: data.info.vnc_port || null,
          connectedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        }
      };

      broadcastToWebClients({ type: 'device_connected', device: devices[deviceUdid].info });
      return;
    }

    // ── Web UI Commands ──
    if (connectionType === 'web') {
      if (data.action === 'run_script') {
        const target = devices[data.targetUdid];
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.info.status = 'running';
          target.info.lastSeen = new Date().toISOString();
          broadcastToWebClients({ type: 'device_status_change', device: target.info });
          target.ws.send(JSON.stringify({
            type: 'run_script',
            script: data.script,
            name: data.scriptName || 'unnamed.lua'
          }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Device offline or not found.' }));
        }

      } else if (data.action === 'stop_script') {
        const target = devices[data.targetUdid];
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({ type: 'stop_script' }));
        }

      } else if (data.action === 'run_all') {
        // Run script on all online devices
        Object.values(devices).forEach(target => {
          if (target.ws.readyState === WebSocket.OPEN) {
            target.info.status = 'running';
            broadcastToWebClients({ type: 'device_status_change', device: target.info });
            target.ws.send(JSON.stringify({
              type: 'run_script',
              script: data.script,
              name: data.scriptName || 'unnamed.lua'
            }));
          }
        });

      } else if (data.action === 'stop_all') {
        Object.values(devices).forEach(target => {
          if (target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({ type: 'stop_script' }));
          }
        });

      } else if (data.action === 'request_screenshot') {
        const target = devices[data.targetUdid];
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
        broadcastToWebClients({
          type: 'device_log',
          udid: deviceUdid,
          message: data.message,
          level: data.level || 'info',
          timestamp: new Date().toLocaleTimeString('vi-VN')
        });

      } else if (data.type === 'status_report') {
        deviceInfo.status = data.status;
        if (data.battery !== undefined) deviceInfo.battery = data.battery;
        broadcastToWebClients({ type: 'device_status_change', device: deviceInfo });

      } else if (data.type === 'screenshot') {
        // Forward base64 screenshot to web dashboards
        broadcastToWebClients({
          type: 'device_screenshot',
          udid: deviceUdid,
          imageBase64: data.imageBase64,
          width: data.width,
          height: data.height
        });
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[Server] WebSocket error: ${err.message}`);
  });

  ws.on('close', () => {
    clearTimeout(registrationTimer);
    if (connectionType === 'web') {
      webClients.delete(ws);
      console.log('[Server] Web dashboard disconnected.');
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

// ─── Periodic Heartbeat (every 10s) ──────────────────────────────────────────
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });

  // Also update lastSeen for connected devices
  Object.values(devices).forEach(device => {
    if (device.ws.readyState !== WebSocket.OPEN) {
      device.info.status = 'offline';
    }
  });
}, 10000);

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const ipInfo = getLocalIPAddress();
  const ip = ipInfo ? ipInfo.address : '127.0.0.1';

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║         iOSControl Dashboard Server v2.0         ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Local:   http://localhost:${PORT}                  ║`);
  console.log(`║  Network: http://${ip}:${PORT}                 ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  Enter this IP in the iControl iOS app:          ║');
  console.log(`║  IP: ${ip.padEnd(44)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (qrcode) {
    console.log('Scan QR to open dashboard on mobile:\n');
    qrcode.generate(`http://${ip}:${PORT}`, { small: true });
  }
});
