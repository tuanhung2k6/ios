const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const SCRIPTS_DIR = path.join(__dirname, 'saved_scripts');

// Ensure scripts directory exists
if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

// In-memory data store
let devices = {}; // Key: udid, Value: { ws, info: { udid, ip, model, name, status, lastSeen } }
let webClients = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Web API for listing saved scripts
app.get('/api/scripts', (req, res) => {
  try {
    const files = fs.readdirSync(SCRIPTS_DIR).filter(file => file.endsWith('.lua'));
    const scripts = files.map(file => {
      const content = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
      return { name: file, content };
    });
    res.json({ success: true, scripts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Web API for saving a script
app.post('/api/scripts/save', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ success: false, error: 'Missing name or content' });
  }
  const safeName = name.endsWith('.lua') ? name : `${name}.lua`;
  try {
    fs.writeFileSync(path.join(SCRIPTS_DIR, safeName), content, 'utf8');
    res.json({ success: true, message: 'Script saved successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Web API for deleting a script
app.delete('/api/scripts/:name', (req, res) => {
  const name = req.params.name;
  try {
    const filePath = path.join(SCRIPTS_DIR, name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true, message: 'Script deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Script not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Broadcast to all Web Clients
function broadcastToWebClients(data) {
  const payload = JSON.stringify(data);
  webClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
  let connectionType = null; // 'web' or 'device'
  let deviceUdid = null;

  // Simple ping-pong to keep connections alive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Handle Web Client requests
      if (data.clientType === 'web_ui') {
        connectionType = 'web';
        webClients.add(ws);
        console.log('Web dashboard client connected.');
        
        // Send initial device list
        const deviceList = Object.values(devices).map(d => d.info);
        ws.send(JSON.stringify({ type: 'device_list', devices: deviceList }));
        return;
      }

      // Handle Device Registration
      if (data.type === 'register_device') {
        connectionType = 'device';
        deviceUdid = data.info.udid;
        
        console.log(`Device connected: ${data.info.name} (${deviceUdid})`);
        devices[deviceUdid] = {
          ws: ws,
          info: {
            udid: data.info.udid,
            ip: data.info.ip || req.socket.remoteAddress,
            model: data.info.model || 'Unknown iOS Device',
            name: data.info.name || 'iPhone',
            status: 'online',
            lastSeen: new Date().toISOString()
          }
        };

        // Notify all web dashboards
        broadcastToWebClients({
          type: 'device_status_change',
          device: devices[deviceUdid].info
        });
        return;
      }

      // Handle execution command forwarding from Web UI -> Device
      if (connectionType === 'web') {
        if (data.action === 'run_script') {
          const targetDevice = devices[data.targetUdid];
          if (targetDevice && targetDevice.ws.readyState === WebSocket.OPEN) {
            targetDevice.info.status = 'running';
            // Notify UI
            broadcastToWebClients({ type: 'device_status_change', device: targetDevice.info });
            // Forward command to device
            targetDevice.ws.send(JSON.stringify({
              type: 'run_script',
              script: data.script,
              name: data.scriptName
            }));
            console.log(`Forwarding run_script command to device ${data.targetUdid}`);
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Device is offline or not found' }));
          }
        } else if (data.action === 'stop_script') {
          const targetDevice = devices[data.targetUdid];
          if (targetDevice && targetDevice.ws.readyState === WebSocket.OPEN) {
            targetDevice.ws.send(JSON.stringify({ type: 'stop_script' }));
            console.log(`Forwarding stop_script command to device ${data.targetUdid}`);
          }
        }
        return;
      }

      // Handle script execution reports from Device -> Web UI
      if (connectionType === 'device') {
        if (data.type === 'log') {
          console.log(`[Log from ${deviceUdid}]: ${data.message}`);
          broadcastToWebClients({
            type: 'device_log',
            udid: deviceUdid,
            message: data.message,
            timestamp: new Date().toLocaleTimeString()
          });
        } else if (data.type === 'status_report') {
          if (devices[deviceUdid]) {
            devices[deviceUdid].info.status = data.status; // 'online' or 'running' or 'error'
            broadcastToWebClients({
              type: 'device_status_change',
              device: devices[deviceUdid].info
            });
          }
        }
      }

    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (connectionType === 'web') {
      webClients.delete(ws);
      console.log('Web dashboard client disconnected.');
    } else if (connectionType === 'device' && deviceUdid) {
      console.log(`Device disconnected: ${deviceUdid}`);
      if (devices[deviceUdid]) {
        devices[deviceUdid].info.status = 'offline';
        broadcastToWebClients({
          type: 'device_status_change',
          device: devices[deviceUdid].info
        });
        delete devices[deviceUdid];
      }
    }
  });
});

// Periodic heartbeat to clean up stale connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
