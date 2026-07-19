/* ═══════════════════════════════════════════════════════
   iOSControl Pro — Frontend Application Logic v2.0
═══════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────
let ws = null;
let wsReady = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let monacoEditor = null;

let connectedDevices = [];
let savedScripts = [];
let selectedDeviceUdid = null;
let currentScriptName = 'main.lua';

let isStreaming = false;
let streamTimer = null;
let screenshotCount = 0;
let screenshotLastTime = Date.now();

// ── Grid View State ────────────────────────────────────
let gridCols = 2;
let gridStreamActive = false;
let gridStreamTimer = null;
let deviceScreenshots = {}; // udid → latest base64

// ── DOM Refs ───────────────────────────────────────────
const $ = id => document.getElementById(id);
const deviceListEl       = $('device-list');
const scriptListEl       = $('script-list');
const deviceCountEl      = $('device-count');
const selectTargetEl     = $('select-target-device');
const runBtn             = $('btn-run');
const stopBtn            = $('btn-stop');
const saveBtn            = $('btn-save');
const newScriptBtn       = $('btn-new-script');
const scriptNameInput    = $('script-name');
const codeTextarea       = $('code-textarea');
const lineNumbersEl      = $('line-numbers');
const consoleLogsEl      = $('console-logs');
const clearConsoleBtn    = $('btn-clear-console');
const wsDotEl            = $('ws-dot');
const serverAddressEl    = $('server-address-display');
const consoleLedEl       = $('console-led');
const logFilterEl        = $('log-filter');
const screenshotBtn      = $('btn-screenshot');
const streamToggleBtn    = $('btn-stream-toggle');
const screenImageEl      = $('screen-image');
const screenPlaceholderEl= $('screen-placeholder');
const screenFpsEl        = $('screen-fps');
const deviceInfoPanelEl  = $('device-info-panel');
const runAllBtn          = $('btn-run-all');
const stopAllBtn         = $('btn-stop-all');

// ── WebSocket Connection ───────────────────────────────
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.host || 'localhost:9898';
    const passcode = encodeURIComponent(localStorage.getItem('auth_passcode') || '');
    ws = new WebSocket(`${protocol}//${host}/?passcode=${passcode}`);

    ws.onopen = () => {
        wsReady = true;
        reconnectAttempt = 0;
        clearTimeout(reconnectTimer);
        setWsStatus(true);
        logToConsole('system', 'Kết nối server thành công.');
        ws.send(JSON.stringify({ clientType: 'web_ui' }));
    };

    ws.onmessage = ({ data }) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        handleServerMessage(msg);
    };

    ws.onerror = () => {};

    ws.onclose = () => {
        wsReady = false;
        setWsStatus(false);
        reconnectAttempt++;
        const delay = Math.min(1000 * reconnectAttempt, 10000);
        logToConsole('error', `Mất kết nối server. Thử lại sau ${Math.round(delay/1000)}s...`);
        reconnectTimer = setTimeout(connectWebSocket, delay);
    };
}

function setWsStatus(online) {
    const dot = $('ws-dot');
    const dotBar = $('ws-dot-bar');
    const text = $('status-ws-indicator');
    const textBar = $('status-ws-indicator-bar');
    
    const className = 'connection-dot ' + (online ? 'connected' : 'disconnected');
    if (dot) dot.className = className;
    if (dotBar) dotBar.className = className;
    
    const statusText = online ? 'Online' : 'Offline';
    if (text) {
        text.textContent = statusText;
    }
    if (textBar) textBar.textContent = statusText;
}

// ── Server Message Router ──────────────────────────────
function handleServerMessage(msg) {
    switch (msg.type) {
        case 'init':
            connectedDevices = msg.devices || [];
            if (msg.serverInfo) serverAddressEl.textContent = `${msg.serverInfo.ip}:${msg.serverInfo.port}`;
            if (msg.schedules) { schedules = msg.schedules; renderSchedules(); }
            if (msg.analytics) updateAnalyticsUI(msg.analytics);
            renderDeviceList();
            renderGrid();
            break;

        case 'device_connected':
            if (!connectedDevices.find(d => d.udid === msg.device.udid)) {
                connectedDevices.push(msg.device);
            }
            logToConsole('success', `Thiết bị kết nối: ${msg.device.name} (${msg.device.ip})`);
            renderDeviceList();
            renderGrid();
            break;

        case 'device_disconnected':
            connectedDevices = connectedDevices.filter(d => d.udid !== msg.device.udid);
            logToConsole('warn', `Thiết bị ngắt kết nối: ${msg.device.name}`);
            if (selectedDeviceUdid === msg.device.udid) {
                selectedDeviceUdid = null;
            }
            renderDeviceList();
            renderGrid();
            break;

        case 'device_status_change':
            updateDeviceInList(msg.device);
            updateGridTile(msg.device);
            break;

        case 'device_log':
            if (!selectedDeviceUdid || selectedDeviceUdid === msg.udid) {
                const dev = connectedDevices.find(d => d.udid === msg.udid);
                const devName = dev ? dev.name : msg.udid.slice(0, 8);
                logToConsole('log', `[${devName}] ${msg.message}`, msg.timestamp);
            }
            consoleLedEl.className = 'console-led active';
            setTimeout(() => consoleLedEl.className = 'console-led', 1500);
            break;

        case 'device_screenshot':
            if (!msg.imageBase64) return;
            // Update the single-device screen tab
            deviceScreenshots[msg.udid] = msg.imageBase64;
            if (!selectedDeviceUdid || selectedDeviceUdid === msg.udid) {
                handleScreenshotReceived(msg);
            }
            // Also update the grid tile for this device
            updateGridTileScreen(msg.udid, msg.imageBase64);
            break;

        case 'error':
            logToConsole('error', msg.message);
            break;
    }
}

// ── Device List Rendering ──────────────────────────────
function renderDeviceList() {
    deviceCountEl.textContent = connectedDevices.length;
    const prevSelected = selectedDeviceUdid;

    // Rebuild dropdown
    selectTargetEl.innerHTML = '<option value="">— Chọn thiết bị —</option>';
    connectedDevices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.udid;
        opt.textContent = `${d.name} (${d.ip})`;
        if (d.udid === prevSelected) opt.selected = true;
        selectTargetEl.appendChild(opt);
    });

    // Render sidebar cards
    if (connectedDevices.length === 0) {
        deviceListEl.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" style="opacity:0.3"><rect x="5" y="2" width="14" height="20" rx="3"/></svg>
                <p>Chưa có thiết bị nào kết nối</p>
                <small>Mở app iControl trên iPhone</small>
            </div>`;
        selectedDeviceUdid = null;
        updateActionButtons();
        renderDeviceInfoPanel();
        return;
    }

    deviceListEl.innerHTML = '';
    connectedDevices.forEach(device => {
        const card = createDeviceCard(device);
        deviceListEl.appendChild(card);
    });

    if (prevSelected && connectedDevices.some(d => d.udid === prevSelected)) {
        selectedDeviceUdid = prevSelected;
    } else if (!selectedDeviceUdid && connectedDevices.length > 0) {
        selectDevice(connectedDevices[0].udid);
    }
    updateActionButtons();
}

function createDeviceCard(device) {
    const card = document.createElement('div');
    card.className = `device-card ${selectedDeviceUdid === device.udid ? 'active' : ''}`;
    card.dataset.udid = device.udid;
    card.innerHTML = `
        <div class="device-card-top">
            <div class="device-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M9 6h6"/></svg>
            </div>
            <div class="device-meta">
                <div class="device-name">${escHtml(device.name)}</div>
                <div class="device-sub">
                    <span class="status-dot ${device.status}"></span>
                    ${escHtml(device.model || 'iPhone')} · ${escHtml(device.ip)}
                </div>
            </div>
        </div>
        <div class="device-actions">
            <button class="screen-btn" data-udid="${device.udid}" title="Xem màn hình">📱 Screen</button>
            <button class="info-btn" data-udid="${device.udid}" title="Thông tin thiết bị">ℹ️ Info</button>
        </div>`;

    card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        selectDevice(device.udid);
    });
    card.querySelector('.screen-btn').addEventListener('click', () => openScreenTab(device.udid));
    card.querySelector('.info-btn').addEventListener('click', () => openInfoTab(device.udid));
    return card;
}

function updateDeviceInList(updatedDevice) {
    const idx = connectedDevices.findIndex(d => d.udid === updatedDevice.udid);
    if (idx !== -1) {
        connectedDevices[idx] = { ...connectedDevices[idx], ...updatedDevice };
    } else if (updatedDevice.status !== 'offline') {
        connectedDevices.push(updatedDevice);
    }
    renderDeviceList();
    if (selectedDeviceUdid === updatedDevice.udid) renderDeviceInfoPanel();
}

function selectDevice(udid) {
    selectedDeviceUdid = udid;
    selectTargetEl.value = udid;
    renderDeviceList();
    updateActionButtons();
    renderDeviceInfoPanel();
    const d = connectedDevices.find(x => x.udid === udid);
    if (d) {
        logToConsole('system', `Đã chọn: ${d.name}`);
        const quickInfo = $('quick-device-info');
        if (quickInfo) quickInfo.textContent = "Thiết bị: " + d.name;
    } else {
        const quickInfo = $('quick-device-info');
        if (quickInfo) quickInfo.textContent = "Không có thiết bị chọn";
    }
}

function openScreenTab(udid) {
    selectDevice(udid);
    activateTab('screen');
    sendWs({ action: 'request_screenshot', targetUdid: udid });
}

function openInfoTab(udid) {
    selectDevice(udid);
    activateTab('info');
    if (typeof showDeviceDetail === 'function') showDeviceDetail(udid);
}

// ── Device Info Panel ──────────────────────────────────
function renderDeviceInfoPanel() {
    const device = connectedDevices.find(d => d.udid === selectedDeviceUdid);
    if (!device) {
        deviceInfoPanelEl.innerHTML = `
            <div class="no-device-selected">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:0.3"><rect x="5" y="2" width="14" height="20" rx="3"/></svg>
                <p>Chọn một thiết bị để xem thông tin</p>
            </div>`;
        return;
    }

    const battery = device.battery ?? null;
    const batteryClass = battery !== null ? (battery < 20 ? 'low' : battery < 50 ? 'mid' : '') : '';
    const connTime = device.connectedAt ? new Date(device.connectedAt).toLocaleTimeString('vi-VN') : '—';

    deviceInfoPanelEl.innerHTML = `
        <div class="info-grid">
            <div class="info-card full">
                <div class="info-card-label">Thiết Bị</div>
                <div class="info-card-value highlight">${escHtml(device.name)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${escHtml(device.model || 'Unknown')} · iOS ${escHtml(device.ios_version || '?')}</div>
            </div>
            <div class="info-card">
                <div class="info-card-label">Địa Chỉ IP</div>
                <div class="info-card-value">${escHtml(device.ip)}</div>
            </div>
            <div class="info-card">
                <div class="info-card-label">Trạng Thái</div>
                <div class="info-card-value" style="text-transform:capitalize">${device.status}</div>
            </div>
            <div class="info-card">
                <div class="info-card-label">Device ID</div>
                <div class="info-card-value" style="font-size:10px;word-break:break-all">${escHtml(device.udid)}</div>
            </div>
            <div class="info-card">
                <div class="info-card-label">Kết Nối Lúc</div>
                <div class="info-card-value">${connTime}</div>
            </div>
            ${battery !== null ? `
            <div class="info-card full">
                <div class="info-card-label">Pin — ${battery}%</div>
                <div class="battery-bar"><div class="battery-fill ${batteryClass}" style="width:${battery}%"></div></div>
            </div>` : ''}
            ${device.vnc_port ? `
            <div class="info-card full">
                <div class="info-card-label">VNC Screen</div>
                <div class="info-card-value">Port ${device.vnc_port} <button class="btn-action" onclick="openVNC('${device.udid}')" style="display:inline-flex;margin-left:8px">Mở noVNC</button></div>
            </div>` : ''}
        </div>`;
}

// ── Tab System ─────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

function activateTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
}

// ── Screen / Screenshot ────────────────────────────────
function handleScreenshotReceived(msg) {
    if (!msg.imageBase64) return;
    screenPlaceholderEl.style.display = 'none';
    screenImageEl.style.display = 'block';
    screenImageEl.src = `data:image/jpeg;base64,${msg.imageBase64}`;

    // FPS counter
    screenshotCount++;
    const now = Date.now();
    if (now - screenshotLastTime >= 1000) {
        screenFpsEl.textContent = `${screenshotCount} fps`;
        screenshotCount = 0;
        screenshotLastTime = now;
    }
}

screenshotBtn.addEventListener('click', () => {
    if (!selectedDeviceUdid) {
        logToConsole('warn', 'Chọn thiết bị trước khi chụp màn hình');
        return;
    }
    sendWs({ action: 'request_screenshot', targetUdid: selectedDeviceUdid });
    logToConsole('system', 'Yêu cầu chụp màn hình...');
    activateTab('screen');
});

streamToggleBtn.addEventListener('click', () => {
    if (!selectedDeviceUdid) return;
    isStreaming = !isStreaming;
    streamToggleBtn.innerHTML = isStreaming
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Tắt Stream`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Bật Stream`;

    if (isStreaming) {
        logToConsole('success', 'Bắt đầu stream màn hình...');
        activateTab('screen');
        streamTimer = setInterval(() => {
            if (selectedDeviceUdid && wsReady) {
                sendWs({ action: 'request_screenshot', targetUdid: selectedDeviceUdid });
            }
        }, 500);
    } else {
        clearInterval(streamTimer);
        screenFpsEl.textContent = '';
        logToConsole('system', 'Đã tắt stream màn hình.');
    }
});

function openVNC(udid) {
    const device = connectedDevices.find(d => d.udid === udid);
    if (!device || !device.vnc_port) return;
    const host = location.hostname;
    const vncUrl = `http://${host}:6080/vnc.html?host=${host}&port=6080&path=novnc-proxy/${udid}`;
    window.open(vncUrl, '_blank');
}

// ── Script Management ──────────────────────────────────
async function loadScripts() {
    try {
        const res = await fetch('/api/scripts');
        const data = await res.json();
        if (data.success) {
            savedScripts = data.scripts;
            renderScriptList();
        }
    } catch (e) {
        console.error('Load scripts error:', e);
    }
}

function renderScriptList() {
    if (savedScripts.length === 0) {
        scriptListEl.innerHTML = '<div class="empty-state"><small>Chưa có script</small></div>';
        return;
    }
    scriptListEl.innerHTML = '';
    savedScripts.forEach(script => {
        const item = document.createElement('div');
        item.className = `script-item ${currentScriptName === script.name ? 'active' : ''}`;
        item.innerHTML = `
            <span class="script-title">${escHtml(script.name)}</span>
            <button class="script-del-btn" title="Xóa">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>`;
        item.addEventListener('click', e => {
            if (!e.target.closest('.script-del-btn')) openScript(script.name);
        });
        item.querySelector('.script-del-btn').addEventListener('click', e => {
            e.stopPropagation();
            deleteScript(script.name);
        });
        scriptListEl.appendChild(item);
    });
}

function openScript(name) {
    const s = savedScripts.find(x => x.name === name);
    if (!s) return;
    currentScriptName = s.name;
    scriptNameInput.value = s.name;
    codeTextarea.value = s.content;
    if (monacoEditor) {
        monacoEditor.setValue(s.content);
    }
    updateLineNumbers();
    renderScriptList();
    logToConsole('system', `Mở script: ${name}`);
    activateTab('editor');

// Automatically update Sileo repo URL display in instructions
const repoUrlEl = document.getElementById('repo-url-display');
if (repoUrlEl) {
    const serverHost = window.location.host || 'localhost:9898';
    repoUrlEl.textContent = 'http://' + serverHost + '/sileo_repo';
}
}

async function saveScript() {
    const name = scriptNameInput.value.trim();
    const content = codeTextarea.value;
    if (!name) { logToConsole('error', 'Vui lòng nhập tên Script'); return; }
    try {
        const res = await fetch('/api/scripts/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content })
        });
        const data = await res.json();
        if (data.success) {
            currentScriptName = data.name;
            scriptNameInput.value = data.name;
            logToConsole('success', `Đã lưu: ${data.name}`);
            await loadScripts();
        } else {
            logToConsole('error', 'Lỗi lưu script: ' + data.error);
        }
    } catch (e) {
        logToConsole('error', 'Lỗi kết nối khi lưu script');
    }
}

async function deleteScript(name) {
    if (!confirm(`Xóa script "${name}"?`)) return;
    try {
        const res = await fetch(`/api/scripts/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            logToConsole('system', `Đã xóa: ${name}`);
            if (currentScriptName === name) {
                currentScriptName = '';
                scriptNameInput.value = '';
                codeTextarea.value = '';
                updateLineNumbers();
            }
            await loadScripts();
        }
    } catch {}
}

// ── Action Buttons ─────────────────────────────────────
function updateActionButtons() {
    const device = connectedDevices.find(d => d.udid === selectedDeviceUdid);
    const hasDevice = !!device;
    const isRunning = hasDevice && device.status === 'running';
    runBtn.disabled = !hasDevice || isRunning;
    stopBtn.disabled = !hasDevice || !isRunning;
}

runBtn.addEventListener('click', () => {
    if (!selectedDeviceUdid) return;
    const content = codeTextarea.value.trim();
    if (!content) { logToConsole('warn', 'Editor đang trống, không có gì để chạy'); return; }
    sendWs({ action: 'run_script', targetUdid: selectedDeviceUdid, script: content, scriptName: scriptNameInput.value.trim() });
    logToConsole('info', `Gửi script "${scriptNameInput.value}" tới ${connectedDevices.find(d=>d.udid===selectedDeviceUdid)?.name}...`);
});

stopBtn.addEventListener('click', () => {
    if (!selectedDeviceUdid) return;
    sendWs({ action: 'stop_script', targetUdid: selectedDeviceUdid });
    logToConsole('warn', 'Gửi lệnh DỪNG...');
});

runAllBtn.addEventListener('click', () => {
    const content = codeTextarea.value.trim();
    if (!content) { logToConsole('warn', 'Editor đang trống'); return; }
    if (connectedDevices.length === 0) { logToConsole('warn', 'Không có thiết bị nào'); return; }
    sendWs({ action: 'run_all', script: content, scriptName: scriptNameInput.value.trim() });
    logToConsole('info', `Chạy script trên ${connectedDevices.length} thiết bị...`);
});

stopAllBtn.addEventListener('click', () => {
    sendWs({ action: 'stop_all' });
    logToConsole('warn', 'Dừng tất cả thiết bị...');
});

saveBtn.addEventListener('click', saveScript);

newScriptBtn.addEventListener('click', () => {
    currentScriptName = 'new_script.lua';
    scriptNameInput.value = currentScriptName;
    codeTextarea.value = `-- iOSControl Lua Script
-- Lệnh cơ bản: tap(x,y), swipe(x1,y1,x2,y2,duration), sleep(seconds)

tap(100, 200)
sleep(1)
swipe(200, 600, 200, 200, 0.5)
log("Xong!")
`;
    updateLineNumbers();
    renderScriptList();
    activateTab('editor');

// Automatically update Sileo repo URL display in instructions
const repoUrlEl = document.getElementById('repo-url-display');
if (repoUrlEl) {
    const serverHost = window.location.host || 'localhost:9898';
    repoUrlEl.textContent = 'http://' + serverHost + '/sileo_repo';
}
});

selectTargetEl.addEventListener('change', e => {
    if (e.target.value) selectDevice(e.target.value);
    else { selectedDeviceUdid = null; updateActionButtons(); }
});

clearConsoleBtn.addEventListener('click', () => { consoleLogsEl.innerHTML = ''; });

$('btn-refresh-devices').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        if (data.success) {
            connectedDevices = data.devices;
            renderDeviceList();
        }
    } catch {}
});

// ── Code Editor Helpers ────────────────────────────────
function updateLineNumbers() {}







// Tab key support in editor
codeTextarea.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const s = codeTextarea.selectionStart;
        codeTextarea.value = codeTextarea.value.substring(0, s) + '  ' + codeTextarea.value.substring(codeTextarea.selectionEnd);
        codeTextarea.selectionStart = codeTextarea.selectionEnd = s + 2;
        updateLineNumbers();
    }
});

// ── Console Logger ─────────────────────────────────────
const LOG_COLORS = { system: 'system', success: 'success', error: 'error', warn: 'warn', info: 'info', log: 'log' };

function logToConsole(type, message, time) {
    const filterVal = logFilterEl.value;
    if (filterVal !== 'all' && type !== filterVal) return;

    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.dataset.type = type;

    const badge = document.createElement('span');
    badge.className = `log-badge ${LOG_COLORS[type] || 'log'}`;
    badge.textContent = { system: 'SYS', success: 'OK', error: 'ERR', warn: 'WARN', info: 'INFO', log: 'LOG' }[type] || 'LOG';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = time || new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const msgSpan = document.createElement('span');
    msgSpan.className = 'log-msg';
    msgSpan.textContent = message;

    line.appendChild(badge);
    line.appendChild(timeSpan);
    line.appendChild(msgSpan);

    consoleLogsEl.appendChild(line);
    consoleLogsEl.scrollTop = consoleLogsEl.scrollHeight;

    // Limit to 500 lines
    while (consoleLogsEl.children.length > 500) {
        consoleLogsEl.removeChild(consoleLogsEl.firstChild);
    }
}

// ── Utility ────────────────────────────────────────────
function sendWs(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        logToConsole('error', 'Chưa kết nối server!');
        return;
    }
    ws.send(JSON.stringify(obj));
}

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Load Server Info ───────────────────────────────────
async function loadServerInfo() {
    try {
        const res = await fetch('/api/server-info');
        const data = await res.json();
        if (data.success) {
            serverAddressEl.textContent = `${data.ip}:${data.port}`;
        }
    } catch {}
}

// ══════════════════════════════════════════════════════
// GRID VIEW — Multi Device Management
// ══════════════════════════════════════════════════════

const gridContainerEl = $('grid-container');
const gridDeviceCountEl = $('grid-device-count');
const gridStreamLabelEl = $('grid-stream-label');

// Set CSS variable for grid column count
function setGridCols(cols) {
    gridCols = cols;
    gridContainerEl.style.setProperty('--grid-cols', cols);
    document.querySelectorAll('.grid-size-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.cols) === cols);
    });
    renderGrid();
}

// Wire up size buttons
document.querySelectorAll('.grid-size-btn').forEach(btn => {
    btn.addEventListener('click', () => setGridCols(parseInt(btn.dataset.cols)));
});

// Render the entire grid from current device list
function renderGrid() {
    // Update badge count
    const online = connectedDevices.filter(d => d.status !== 'offline');
    gridDeviceCountEl.textContent = online.length || '';
    gridDeviceCountEl.dataset.zero = online.length === 0 ? 'true' : 'false';

    if (connectedDevices.length === 0) {
        gridContainerEl.innerHTML = `
            <div class="grid-empty-state" id="grid-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="56" height="56" style="opacity:0.2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                <p>Chưa có thiết bị nào kết nối</p>
                <small>Mở app iControl trên các iPhone để xem Grid View</small>
            </div>`;
        return;
    }

    // Remove empty state, then rebuild tiles for each device
    gridContainerEl.style.setProperty('--grid-cols', gridCols);

    // Remove stale tiles
    const existingUdids = new Set([...gridContainerEl.querySelectorAll('.device-tile')].map(el => el.dataset.udid));
    const currentUdids = new Set(connectedDevices.map(d => d.udid));

    existingUdids.forEach(udid => {
        if (!currentUdids.has(udid)) {
            const el = gridContainerEl.querySelector(`[data-udid="${udid}"]`);
            if (el) el.remove();
        }
    });

    // Remove empty state if present
    const emptyState = gridContainerEl.querySelector('.grid-empty-state');
    if (emptyState) emptyState.remove();

    connectedDevices.forEach(device => {
        const existing = gridContainerEl.querySelector(`.device-tile[data-udid="${device.udid}"]`);
        if (existing) {
            // Just update status badge and footer
            updateGridTile(device);
        } else {
            const tile = createGridTile(device);
            gridContainerEl.appendChild(tile);
        }
    });
}

// Create a new device tile element
function createGridTile(device) {
    const battery = device.battery ?? null;
    const battClass = battery !== null ? (battery < 20 ? 'low' : battery < 50 ? 'mid' : '') : '';
    const battPct = battery !== null ? battery : '—';
    const hasScreen = !!deviceScreenshots[device.udid];

    const tile = document.createElement('div');
    tile.className = `device-tile ${device.status}`;
    tile.dataset.udid = device.udid;
    tile.innerHTML = `
        <div class="tile-header">
            <span class="tile-name">${escHtml(device.name)}</span>
            <span class="tile-status ${device.status}">
                <span class="tile-status-dot"></span>
                ${device.status === 'running' ? '⚡ Running' : device.status === 'online' ? 'Online' : 'Offline'}
            </span>
        </div>
        <div class="tile-screen">
            <span class="tile-live-badge" id="live-${device.udid}">● LIVE</span>
            ${hasScreen
                ? `<img class="tile-screen-img loaded" src="data:image/jpeg;base64,${deviceScreenshots[device.udid]}" alt="Screen">`
                : `<div class="tile-screen-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="28" height="28"><rect x="5" y="2" width="14" height="20" rx="3"/></svg>
                    <span>Tap 📸 để chụp màn hình</span>
                </div>`
            }
            <div class="tile-screen-overlay">
                <button class="tile-overlay-btn run-btn" data-action="run" data-udid="${device.udid}" title="Chạy Script">▶</button>
                <button class="tile-overlay-btn screen-btn" data-action="screenshot" data-udid="${device.udid}" title="Chụp màn hình">📸</button>
                <button class="tile-overlay-btn stop-btn" data-action="stop" data-udid="${device.udid}" title="Dừng">■</button>
            </div>
        </div>
        <div class="tile-footer">
            <span class="tile-ip">${escHtml(device.ip)}</span>
            ${battery !== null ? `
            <div class="tile-battery">
                <div class="tile-battery-bar">
                    <div class="tile-battery-fill ${battClass}" style="width:${battery}%"></div>
                </div>
                <span class="tile-battery-pct">${battPct}%</span>
            </div>` : ''}
        </div>`;

    // Wire overlay button events
    tile.querySelectorAll('.tile-overlay-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const { action, udid } = btn.dataset;
            if (action === 'run') {
                const content = document.getElementById('code-textarea').value.trim();
                if (!content) { logToConsole('warn', 'Editor trống, không có gì để chạy'); return; }
                sendWs({ action: 'run_script', targetUdid: udid, script: content, scriptName: document.getElementById('script-name').value.trim() });
                logToConsole('info', `Chạy script trên: ${device.name}`);
            } else if (action === 'stop') {
                sendWs({ action: 'stop_script', targetUdid: udid });
                logToConsole('warn', `Dừng script trên: ${device.name}`);
            } else if (action === 'screenshot') {
                sendWs({ action: 'request_screenshot', targetUdid: udid });
                logToConsole('system', `Chụp màn hình: ${device.name}`);
            }
        });
    });

    // Click tile header to select device + open screen tab
    tile.addEventListener('click', e => {
        if (e.target.closest('.tile-overlay-btn')) return;
        selectDevice(device.udid);
        activateTab('screen');
        if (deviceScreenshots[device.udid]) {
            handleScreenshotReceived({ imageBase64: deviceScreenshots[device.udid] });
        }
    });

    return tile;
}

// Live update a tile's status without full re-render
function updateGridTile(device) {
    const tile = gridContainerEl.querySelector(`.device-tile[data-udid="${device.udid}"]`);
    if (!tile) { renderGrid(); return; }

    tile.className = `device-tile ${device.status}`;
    const statusEl = tile.querySelector('.tile-status');
    if (statusEl) {
        statusEl.className = `tile-status ${device.status}`;
        statusEl.innerHTML = `<span class="tile-status-dot"></span>${device.status === 'running' ? '⚡ Running' : device.status === 'online' ? 'Online' : 'Offline'}`;
    }

    // Update battery if present
    if (device.battery !== undefined) {
        const fill = tile.querySelector('.tile-battery-fill');
        const pct = tile.querySelector('.tile-battery-pct');
        if (fill) {
            fill.style.width = `${device.battery}%`;
            fill.className = `tile-battery-fill ${device.battery < 20 ? 'low' : device.battery < 50 ? 'mid' : ''}`;
        }
        if (pct) pct.textContent = `${device.battery}%`;
    }

    // Update badge
    const online = connectedDevices.filter(d => d.status !== 'offline').length;
    gridDeviceCountEl.textContent = online || '';
}

// Update screen image in a specific tile
function updateGridTileScreen(udid, imageBase64) {
    const tile = gridContainerEl.querySelector(`.device-tile[data-udid="${udid}"]`);
    if (!tile) return;

    let img = tile.querySelector('.tile-screen-img');
    const placeholder = tile.querySelector('.tile-screen-placeholder');

    if (!img) {
        img = document.createElement('img');
        img.className = 'tile-screen-img';
        img.alt = 'Screen';
        tile.querySelector('.tile-screen').insertBefore(img, tile.querySelector('.tile-screen-overlay'));
    }

    img.src = `data:image/jpeg;base64,${imageBase64}`;
    img.classList.add('loaded');
    if (placeholder) placeholder.style.display = 'none';
}

// Grid screenshot-all button
$('grid-screenshot-all').addEventListener('click', () => {
    if (connectedDevices.length === 0) return;
    connectedDevices.forEach(d => sendWs({ action: 'request_screenshot', targetUdid: d.udid }));
    logToConsole('system', `Chụp màn hình ${connectedDevices.length} thiết bị...`);
});

// Grid stream toggle
$('grid-stream-all').addEventListener('click', () => {
    gridStreamActive = !gridStreamActive;
    gridStreamLabelEl.textContent = gridStreamActive ? 'Tắt Stream Tất Cả' : 'Bật Stream Tất Cả';

    // Toggle LIVE badges
    document.querySelectorAll('.tile-live-badge').forEach(b => b.classList.toggle('active', gridStreamActive));

    if (gridStreamActive) {
        logToConsole('success', 'Bắt đầu stream tất cả thiết bị (0.5s/frame)...');
        gridStreamTimer = setInterval(() => {
            connectedDevices.forEach(d => {
                if (d.status !== 'offline') sendWs({ action: 'request_screenshot', targetUdid: d.udid });
            });
        }, 500);
    } else {
        clearInterval(gridStreamTimer);
        logToConsole('system', 'Đã tắt stream.');
    }
});

$('grid-run-all').addEventListener('click', () => {
    const content = document.getElementById('code-textarea').value.trim();
    if (!content) { logToConsole('warn', 'Editor trống'); return; }
    sendWs({ action: 'run_all', script: content, scriptName: document.getElementById('script-name').value.trim() });
    logToConsole('info', `Chạy script trên ${connectedDevices.length} thiết bị...`);
});

$('grid-stop-all').addEventListener('click', () => {
    sendWs({ action: 'stop_all' });
    logToConsole('warn', 'Dừng tất cả thiết bị...');
});

// ══════════════════════════════════════════════════════════════
// FEATURE 1: COORDINATE PICKER
// ══════════════════════════════════════════════════════════════

let pickerActive = false;
let deviceResolution = { w: 390, h: 844 }; // default iPhone 13 mini

// Add picker button to screen toolbar dynamically
(function addPickerButton() {
    const toolbar = document.querySelector('.screen-toolbar');
    if (!toolbar) return;
    const btn = document.createElement('button');
    btn.className = 'btn-action picker-toggle-btn';
    btn.id = 'btn-picker';
    btn.title = 'Coordinate Picker — Click màn hình để lấy tọa độ';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg> 🎯 Picker`;
    toolbar.appendChild(btn);
    btn.addEventListener('click', togglePicker);
})();

function togglePicker() {
    pickerActive = !pickerActive;
    const btn = $('btn-picker');
    if (btn) btn.classList.toggle('active', pickerActive);
    document.querySelector('.screen-viewer')?.classList.toggle('picker-active', pickerActive);
    if (pickerActive) logToConsole('system', '🎯 Picker ON — Click vào ảnh màn hình để lấy tọa độ');
    else logToConsole('system', 'Picker tắt');
}

// Wire click on screen image
screenImageEl.addEventListener('click', (e) => {
    if (!pickerActive) return;
    const rect = screenImageEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const imgW = rect.width;
    const imgH = rect.height;

    // Scale to device coordinates (server reported width/height or default)
    const scaleX = deviceResolution.w / imgW;
    const scaleY = deviceResolution.h / imgH;
    const devX = Math.round(relX * scaleX);
    const devY = Math.round(relY * scaleY);

    // Insert into editor at cursor or append
    insertAtCursor(codeTextarea, `tap(${devX}, ${devY})\n`);
    updateLineNumbers();
    logToConsole('success', `Đã thêm: tap(${devX}, ${devY})`);

    // Visual flash
    const parent = screenImageEl.parentElement;
    const flash = document.createElement('div');
    flash.className = 'coord-flash';
    flash.style.left = `${relX}px`;
    flash.style.top = `${relY}px`;

    const tip = document.createElement('div');
    tip.className = 'coord-tooltip';
    tip.style.left = `${relX + 14}px`;
    tip.style.top = `${relY - 20}px`;
    tip.textContent = `tap(${devX}, ${devY})`;

    parent.appendChild(flash);
    parent.appendChild(tip);
    setTimeout(() => { flash.remove(); tip.remove(); }, 700);
});

// Handle screenshot with resolution info
function handleScreenshotReceived(msg) {
    if (!msg.imageBase64) return;
    if (msg.width && msg.height) deviceResolution = { w: msg.width, h: msg.height };
    screenPlaceholderEl.style.display = 'none';
    screenImageEl.style.display = 'block';
    screenImageEl.src = `data:image/jpeg;base64,${msg.imageBase64}`;
    screenshotCount++;
    const now = Date.now();
    if (now - screenshotLastTime >= 1000) {
        screenFpsEl.textContent = `${screenshotCount} fps`;
        screenshotCount = 0;
        screenshotLastTime = now;
    }
}

function insertAtCursor(textarea, text) {
    if (monacoEditor) {
        const selection = monacoEditor.getSelection();
        const range = new monaco.Range(
            selection.startLineNumber,
            selection.startColumn,
            selection.endLineNumber,
            selection.endColumn
        );
        const id = { major: 1, minor: 1 };
        const textEdit = { identifier: id, range: range, text: text, forceMoveMarkers: true };
        monacoEditor.executeEdits("my-source", [textEdit]);
        monacoEditor.focus();
    } else {
        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();
    }
}

// ══════════════════════════════════════════════════════════════
// FEATURE 2: SCHEDULER
// ══════════════════════════════════════════════════════════════

let schedules = [];
const scheduleCountEl = $('schedule-count');
const scheduleListEl = $('schedule-list');

async function loadSchedules() {
    try {
        const res = await fetch('/api/schedules');
        const data = await res.json();
        if (data.success) { schedules = data.schedules; renderSchedules(); }
    } catch {}
}

function renderSchedules() {
    if (scheduleCountEl) scheduleCountEl.textContent = schedules.filter(s=>s.enabled).length || '';
    if (!scheduleListEl) return;
    if (schedules.length === 0) {
        scheduleListEl.innerHTML = '<div class="empty-state"><p>Chưa có lịch nào</p><small>Tạo lịch mới để tự động chạy script</small></div>';
        return;
    }
    scheduleListEl.innerHTML = '';
    const DAY_NAMES = ['CN','T2','T3','T4','T5','T6','T7'];
    schedules.forEach(sch => {
        const days = (sch.days || []).map(d => DAY_NAMES[d]).join(', ');
        const card = document.createElement('div');
        card.className = `schedule-card ${sch.enabled ? '' : 'disabled'}`;
        card.id = `sch-card-${sch.id}`;
        card.innerHTML = `
            <button class="schedule-toggle ${sch.enabled ? 'on' : ''}" data-id="${sch.id}"></button>
            <span class="schedule-time-badge">${sch.time}</span>
            <div class="schedule-meta">
                <div class="schedule-name">${escHtml(sch.name)}</div>
                <div class="schedule-detail">
                    <span>📅 ${days}</span>
                    <span>🔁 ${sch.loopCount}x</span>
                    <span>📄 ${escHtml(sch.scriptName || 'script')}</span>
                    ${sch.lastFired ? `<span>⚡ ${new Date(sch.lastFired).toLocaleString('vi-VN')}</span>` : ''}
                </div>
            </div>
            <button class="icon-btn schedule-del-btn" data-id="${sch.id}" title="Xóa">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>`;

        card.querySelector('.schedule-toggle').addEventListener('click', () => toggleSchedule(sch.id));
        card.querySelector('.schedule-del-btn').addEventListener('click', () => deleteSchedule(sch.id));
        scheduleListEl.appendChild(card);
    });
}

async function addSchedule() {
    const name = $('sch-name').value.trim() || 'Lịch mới';
    const time = $('sch-time').value;
    const loops = parseInt($('sch-loops').value) || 1;
    const loopDelay = parseFloat($('sch-loop-delay').value) || 0;
    const scriptName = $('sch-script-name').value || 'scheduled.lua';
    const scriptContent = codeTextarea.value.trim();
    const days = [...document.querySelectorAll('.day-btn.active')].map(b => parseInt(b.dataset.day));

    if (!scriptContent) { logToConsole('warn', 'Editor trống! Nhập script trước.'); return; }
    if (!time) { logToConsole('warn', 'Chưa chọn giờ chạy.'); return; }

    try {
        const res = await fetch('/api/schedules', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, time, days, scriptName, scriptContent, loopCount: loops, loopDelay })
        });
        const data = await res.json();
        if (data.success) {
            schedules.push(data.schedule);
            renderSchedules();
            logToConsole('success', `Đã tạo lịch: ${name} — ${time}`);
            activateTab('scheduler');
        }
    } catch (e) { logToConsole('error', 'Lỗi tạo lịch: ' + e.message); }
}

async function toggleSchedule(id) {
    const sch = schedules.find(s => s.id === id);
    if (!sch) return;
    const res = await fetch(`/api/schedules/${id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ enabled: !sch.enabled }) });
    const data = await res.json();
    if (data.success) { sch.enabled = data.schedule.enabled; renderSchedules(); }
}

async function deleteSchedule(id) {
    if (!confirm('Xóa lịch này?')) return;
    const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    if ((await res.json()).success) {
        schedules = schedules.filter(s => s.id !== id);
        renderSchedules();
        logToConsole('system', 'Đã xóa lịch.');
    }
}

if ($('btn-add-schedule')) $('btn-add-schedule').addEventListener('click', addSchedule);
if ($('sch-use-current')) $('sch-use-current').addEventListener('click', () => {
    const name = scriptNameInput.value.trim() || 'script.lua';
    $('sch-script-name').value = name;
    logToConsole('system', `Đã dùng script: ${name}`);
});

// Day selector toggle
document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
});

// Handle server firing a schedule
function handleScheduleFired(msg) {
    logToConsole('success', `⏰ Lịch kích hoạt: "${msg.name}"`);
    const card = $(`sch-card-${msg.scheduleId}`);
    if (card) card.classList.add('schedule-fired-flash');
    // Update lastFired in local state
    const sch = schedules.find(s => s.id === msg.scheduleId);
    if (sch) { sch.lastFired = new Date().toISOString(); renderSchedules(); }
}

// ══════════════════════════════════════════════════════════════
// FEATURE 3: LOOP CONTROL
// ══════════════════════════════════════════════════════════════

if ($('btn-run-loop')) {
    $('btn-run-loop').addEventListener('click', () => {
        if (!selectedDeviceUdid) { logToConsole('warn', 'Chọn thiết bị trước!'); return; }
        const content = codeTextarea.value.trim();
        if (!content) { logToConsole('warn', 'Editor trống'); return; }
        const loopCount = parseInt($('loop-count').value) || 1;
        const loopDelay = parseFloat($('loop-delay').value) || 0;
        const device = connectedDevices.find(d => d.udid === selectedDeviceUdid);
        sendWs({
            action: 'run_script', targetUdid: selectedDeviceUdid,
            script: content, scriptName: scriptNameInput.value.trim(),
            loopCount, loopDelay
        });
        const loopText = loopCount === 0 ? 'vô hạn' : `${loopCount} lần`;
        const delayText = loopDelay > 0 ? ` (delay ${loopDelay}s)` : '';
        logToConsole('info', `Chạy lặp ${loopText}${delayText} trên: ${device?.name}`);
        if ($('loop-status')) $('loop-status').textContent = `⟳ Đang lặp ${loopText}${delayText}...`;
    });
}

// ══════════════════════════════════════════════════════════════
// FEATURE 4: ANALYTICS
// ══════════════════════════════════════════════════════════════

let analyticsData = null;

function updateAnalyticsUI(data) {
    if (!data) return;
    analyticsData = data;
    const fmt = n => n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n);
    if ($('stat-runs')) $('stat-runs').textContent = fmt(data.totalRuns || 0);
    if ($('stat-taps')) $('stat-taps').textContent = fmt(data.totalTaps || 0);
    if ($('stat-swipes')) $('stat-swipes').textContent = fmt(data.totalSwipes || 0);
    if ($('stat-time')) {
        const secs = Math.round((data.totalRunTimeMs || 0) / 1000);
        $('stat-time').textContent = secs >= 3600 ? `${(secs/3600).toFixed(1)}h` : secs >= 60 ? `${Math.floor(secs/60)}m${secs%60}s` : `${secs}s`;
    }
    drawDeviceChart(data);
}

async function loadAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        const data = await res.json();
        if (data.success) updateAnalyticsUI(data.analytics);
    } catch {}
}

function drawDeviceChart(data) {
    const canvas = $('device-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const devData = Object.values(data.devices || {});
    if (devData.length === 0) { ctx.clearRect(0,0,canvas.width,canvas.height); return; }

    canvas.width = canvas.parentElement.clientWidth - 32;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const BAR_W = Math.min(60, (W / devData.length) - 20);
    const maxRuns = Math.max(...devData.map(d => d.runs || 0), 1);
    const maxTaps = Math.max(...devData.map(d => d.taps || 0), 1);
    const CHART_H = H - 50;
    const GAP = (W - devData.length * BAR_W * 2) / (devData.length + 1);

    devData.forEach((dev, i) => {
        const x = GAP + i * (BAR_W * 2 + GAP);
        const name = (dev.udid || 'Device').slice(0, 8);

        // Runs bar (indigo)
        const runH = ((dev.runs || 0) / maxRuns) * CHART_H;
        ctx.fillStyle = 'rgba(99,102,241,0.7)';
        ctx.beginPath();
        ctx.roundRect(x, CHART_H - runH + 10, BAR_W, runH, [4,4,0,0]);
        ctx.fill();
        ctx.fillStyle = '#a5b4fc';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(dev.runs || 0, x + BAR_W/2, CHART_H - runH + 6);

        // Taps bar (emerald)
        const tapH = ((dev.taps || 0) / maxTaps) * CHART_H;
        ctx.fillStyle = 'rgba(16,185,129,0.7)';
        ctx.beginPath();
        ctx.roundRect(x + BAR_W + 4, CHART_H - tapH + 10, BAR_W, tapH, [4,4,0,0]);
        ctx.fill();
        ctx.fillStyle = '#6ee7b7';
        ctx.fillText(dev.taps || 0, x + BAR_W*1.5 + 4, CHART_H - tapH + 6);

        // Label
        ctx.fillStyle = '#64748b';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(name, x + BAR_W, CHART_H + 24);
    });

    // Legend
    ctx.fillStyle = 'rgba(99,102,241,0.7)';
    ctx.fillRect(W - 120, H - 18, 10, 10);
    ctx.fillStyle = '#8b92a8'; ctx.font = '10px Inter'; ctx.textAlign = 'left';
    ctx.fillText('Lần chạy', W - 108, H - 9);
    ctx.fillStyle = 'rgba(16,185,129,0.7)';
    ctx.fillRect(W - 60, H - 18, 10, 10);
    ctx.fillText('Clicks', W - 48, H - 9);
}

if ($('btn-reset-analytics')) {
    $('btn-reset-analytics').addEventListener('click', async () => {
        if (!confirm('Xóa tất cả dữ liệu thống kê?')) return;
        const res = await fetch('/api/analytics', { method: 'DELETE' });
        if ((await res.json()).success) { logToConsole('system', 'Đã xóa analytics.'); }
    });
}

// ══════════════════════════════════════════════════════════════
// FEATURE 5: SCRIPT FOLDERS
// ══════════════════════════════════════════════════════════════

let currentFolder = '';

async function loadScripts(folder) {
    currentFolder = folder !== undefined ? folder : currentFolder;
    try {
        const url = `/api/scripts${currentFolder ? '?folder=' + encodeURIComponent(currentFolder) : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
            savedScripts = data.scripts;
            renderScriptList(data.folders || []);
            updateBreadcrumb();
        }
    } catch (e) { console.error('Load scripts error:', e); }
}

function updateBreadcrumb() {
    const bc = $('folder-breadcrumb');
    if (!bc) return;
    const parts = currentFolder ? currentFolder.split('/') : [];
    bc.innerHTML = `<button class="breadcrumb-item ${!currentFolder ? 'active' : ''}" data-path="">📁 Scripts</button>`;
    let built = '';
    parts.forEach((part, i) => {
        built = built ? `${built}/${part}` : part;
        const path = built;
        bc.innerHTML += `<span class="breadcrumb-sep">›</span><button class="breadcrumb-item ${i === parts.length-1 ? 'active' : ''}" data-path="${escHtml(path)}">${escHtml(part)}</button>`;
    });
    bc.querySelectorAll('.breadcrumb-item').forEach(btn => {
        btn.addEventListener('click', () => loadScripts(btn.dataset.path));
    });
}

function renderScriptList(folders = []) {
    if (savedScripts.length === 0 && folders.length === 0) {
        scriptListEl.innerHTML = '<div class="empty-state"><small>Chưa có script hay thư mục</small></div>';
        return;
    }
    scriptListEl.innerHTML = '';

    // Render folders first
    folders.forEach(folder => {
        const item = document.createElement('div');
        item.className = 'folder-item';
        item.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span class="folder-item-name">${escHtml(folder.name)}</span>
            <button class="icon-btn folder-item-del" title="Xóa thư mục" data-folder-name="${escHtml(folder.name)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>`;
        item.querySelector('.folder-item-name').addEventListener('click', () => loadScripts(folder.path));
        item.querySelector('.folder-item-del').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`Xóa thư mục "${folder.name}"?`)) return;
            const res = await fetch(`/api/folders/${encodeURIComponent(folder.name)}?parent=${encodeURIComponent(currentFolder)}`, { method: 'DELETE' });
            if ((await res.json()).success) { logToConsole('system', `Đã xóa thư mục: ${folder.name}`); loadScripts(); }
        });
        scriptListEl.appendChild(item);
    });

    // Render script files
    savedScripts.forEach(script => {
        const item = document.createElement('div');
        item.className = `script-item ${currentScriptName === script.name && currentFolder === script.folder ? 'active' : ''}`;
        item.innerHTML = `
            <span class="script-title">${escHtml(script.name)}</span>
            <button class="script-del-btn" title="Xóa">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>`;
        item.addEventListener('click', e => { if (!e.target.closest('.script-del-btn')) openScript(script.name, script.folder); });
        item.querySelector('.script-del-btn').addEventListener('click', e => { e.stopPropagation(); deleteScript(script.name, script.folder); });
        scriptListEl.appendChild(item);
    });
}

function openScript(name, folder) {
    const s = savedScripts.find(x => x.name === name && x.folder === folder);
    if (!s) return;
    currentScriptName = s.name;
    scriptNameInput.value = s.name;
    codeTextarea.value = s.content;
    if (monacoEditor) {
        monacoEditor.setValue(s.content);
    }
    updateLineNumbers();
    renderScriptList();
    logToConsole('system', `Mở: ${folder ? folder + '/' : ''}${name}`);
    activateTab('editor');

// Automatically update Sileo repo URL display in instructions
const repoUrlEl = document.getElementById('repo-url-display');
if (repoUrlEl) {
    const serverHost = window.location.host || 'localhost:9898';
    repoUrlEl.textContent = 'http://' + serverHost + '/sileo_repo';
}
}

async function saveScript() {
    const name = scriptNameInput.value.trim();
    const content = codeTextarea.value;
    if (!name) { logToConsole('error', 'Vui lòng nhập tên Script'); return; }
    try {
        const res = await fetch('/api/scripts/save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content, folder: currentFolder })
        });
        const data = await res.json();
        if (data.success) {
            currentScriptName = data.name;
            scriptNameInput.value = data.name;
            logToConsole('success', `Đã lưu: ${data.folder ? data.folder + '/' : ''}${data.name}`);
            await loadScripts();
        } else logToConsole('error', 'Lỗi: ' + data.error);
    } catch (e) { logToConsole('error', 'Lỗi kết nối'); }
}

async function deleteScript(name, folder) {
    if (!confirm(`Xóa script "${name}"?`)) return;
    const folderQ = folder ? `?folder=${encodeURIComponent(folder)}` : '';
    try {
        const res = await fetch(`/api/scripts/${encodeURIComponent(name)}${folderQ}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            logToConsole('system', `Đã xóa: ${name}`);
            if (currentScriptName === name) { currentScriptName = ''; scriptNameInput.value = ''; codeTextarea.value = ''; updateLineNumbers(); }
            await loadScripts();
        }
    } catch {}
}

// New folder button
if ($('btn-new-folder')) {
    $('btn-new-folder').addEventListener('click', async () => {
        const name = prompt('Tên thư mục mới:');
        if (!name || !name.trim()) return;
        const res = await fetch('/api/folders/create', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), parent: currentFolder })
        });
        const data = await res.json();
        if (data.success) { logToConsole('success', `Tạo thư mục: ${name}`); loadScripts(); }
    });
}

// ══════════════════════════════════════════════════════════════
// WebSocket Analytics/Schedule Message Routing
// ══════════════════════════════════════════════════════════════

// Extend existing handleServerMessage
const _origHandleMsg = handleServerMessage;
handleServerMessage = function(msg) {
    if (msg.type === 'analytics_update') { updateAnalyticsUI(msg.analytics); return; }
    if (msg.type === 'schedule_fired') { handleScheduleFired(msg); return; }
    if (msg.type === 'schedules_updated') { schedules = msg.schedules; renderSchedules(); return; }
    _origHandleMsg(msg);
}

// ── Bootstrap ──────────────────────────────────────────
setGridCols(2);
connectWebSocket();
loadScripts();
loadSchedules();
loadAnalytics();
loadServerInfo();
updateLineNumbers();

// First tab active = editor
activateTab('editor');

// Automatically update Sileo repo URL display in instructions
const repoUrlEl = document.getElementById('repo-url-display');
if (repoUrlEl) {
    const serverHost = window.location.host || 'localhost:9898';
    repoUrlEl.textContent = 'http://' + serverHost + '/sileo_repo';
}

// --------------------------------------------------------------
// TOAST NOTIFICATION SYSTEM
// --------------------------------------------------------------

const toastContainer = document.getElementById('toast-container');

function showToast(title, msg, type, duration) {
    if (!toastContainer) return;
    if (duration === undefined) duration = 3500;
    if (!type) type = 'info';
    const icons = { success: '?', error: '?', info: '??', warn: '??', system: '??' };
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<span class="toast-icon">' + (icons[type] || '??') + '</span><div class="toast-body"><div class="toast-title">' + title + '</div>' + (msg ? '<div class="toast-msg">' + msg + '</div>' : '') + '</div>';
    toast.addEventListener('click', function() { toast.classList.add('leaving'); setTimeout(function() { toast.remove(); }, 260); });
    toastContainer.appendChild(toast);
    setTimeout(function() { toast.classList.add('leaving'); setTimeout(function() { toast.remove(); }, 260); }, duration);
}

// Toast for device events
const _existingHandleMsg = handleServerMessage;
handleServerMessage = function(msg) {
    if (msg.type === 'device_connected') { showToast('?? Thi?t b? k?t n?i', msg.device.name + ' � ' + msg.device.ip, 'success'); }
    else if (msg.type === 'device_disconnected') { showToast('?? Thi?t b? ng?t', msg.device.name, 'warn'); }
    else if (msg.type === 'schedule_fired') { showToast('? L?ch k�ch ho?t!', msg.name, 'info'); }
    _existingHandleMsg(msg);
}

// --------------------------------------------------------------
// SCRIPT TEMPLATES
// --------------------------------------------------------------

const TEMPLATES = {
    tap_basic: '-- ?? Tap co b?n\ntap(195, 422)\nsleep(0.5)\ntap(195, 422)\n',
    swipe_vertical: '-- ? Vu?t d?c (scroll down)\nswipe(195, 700, 195, 300, 0.4)\nsleep(0.8)\nswipe(195, 700, 195, 300, 0.4)\n',
    loop_tap: '-- ?? L?p click t?i m?t di?m\ntap(195, 422)\nsleep(1.5)\n',
    open_app: '-- ?? M? app theo Bundle ID\nappRun("com.apple.mobilesafari")\nsleep(2)\n',
    snapchat_farm: '-- ?? SnapChat Streak Farm\nappRun("com.toyopagroup.picaboo")\nsleep(3)\ntap(195, 820)\nsleep(1)\ntap(195, 750)\nsleep(1.5)\ntap(340, 750)\nsleep(0.5)\ntap(195, 500)\nsleep(0.5)\ntap(340, 750)\nsleep(2)\nlog("Streak g?i th�nh c�ng!")\n',
    scroll_feed: '-- ?? Vu?t Feed t? d?ng\nswipe(195, 700, 195, 200, 0.5)\nsleep(2)\nswipe(195, 700, 195, 200, 0.5)\nsleep(2)\nswipe(195, 700, 195, 200, 0.5)\nsleep(2)\nlog("Ho�n t?t cu?n feed.")\n',
    screenshot_loop: '-- ?? Ch?p m�n h�nh v� ch?\nscreenshot()\nsleep(5)\nlog("Ch?p ?nh xong.")\n'
};

(function setupTemplates() {
    var menu = document.getElementById('template-menu');
    var btn = document.getElementById('btn-templates');
    if (!btn || !menu) return;
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', function() { if (menu) menu.style.display = 'none'; });
    document.querySelectorAll('.template-item').forEach(function(item) {
        item.addEventListener('click', function() {
            var key = item.dataset.tpl;
            var tpl = TEMPLATES[key];
            if (tpl) {
                var ta = document.getElementById('code-textarea');
                var si = document.getElementById('script-name');
                if (ta) ta.value = tpl;
                if (si) si.value = key + '.lua';
                currentScriptName = key + '.lua';
                updateLineNumbers();
                showToast('?? Template t?i xong', item.textContent.trim(), 'info');
                activateTab('editor');

// Automatically update Sileo repo URL display in instructions
const repoUrlEl = document.getElementById('repo-url-display');
if (repoUrlEl) {
    const serverHost = window.location.host || 'localhost:9898';
    repoUrlEl.textContent = 'http://' + serverHost + '/sileo_repo';
}
            }
            menu.style.display = 'none';
        });
    });
})();

// --------------------------------------------------------------
// EXPORT LOGS
// --------------------------------------------------------------

var _exportLogs = [];
var _baseLogFn = logToConsole;
logToConsole = function(level, msg, ts) {
    if (typeof _baseLogFn === 'function') _baseLogFn(level, msg, ts);
    var time = ts || new Date().toLocaleTimeString('vi-VN');
    _exportLogs.push('[' + time + '] [' + level.toUpperCase() + '] ' + msg);
    if (_exportLogs.length > 5000) _exportLogs = _exportLogs.slice(-5000);
}

var exportBtn = document.getElementById('btn-export-logs');
if (exportBtn) {
    exportBtn.addEventListener('click', function() {
        var content = _exportLogs.join('\n');
        var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'icontrol-logs-' + new Date().toISOString().slice(0,19).replace(/:/g,'-') + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        showToast('?? Xu?t logs xong', _exportLogs.length + ' d�ng', 'success');
    });
}

// --------------------------------------------------------------
// DEVICE DETAIL VIEW
// --------------------------------------------------------------

function showDeviceDetail(udid) {
    var device = connectedDevices.find(function(d) { return d.udid === udid; });
    var placeholder = document.getElementById('no-device-placeholder');
    var detailView = document.getElementById('device-detail-view');
    if (!device || !detailView) return;
    if (placeholder) placeholder.style.display = 'none';
    detailView.style.display = 'block';
    function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val || '�'; }
    setText('detail-name', device.name);
    setText('detail-model', device.model || 'iPhone');
    setText('detail-ip', device.ip);
    var bat = device.battery;
    setText('detail-battery', bat !== null && bat !== undefined ? bat + '% ' + (bat < 20 ? '??' : bat < 50 ? '??' : '??') : '�');
    setText('detail-udid', device.udid);
    setText('detail-status', device.status === 'running' ? '? Ch?y script' : device.status === 'online' ? '? Online' : '? Offline');
    setText('detail-connected-at', device.connectedAt ? new Date(device.connectedAt).toLocaleString('vi-VN') : '�');
    setText('detail-last-seen', device.lastSeen ? new Date(device.lastSeen).toLocaleString('vi-VN') : '�');
    var iosBadge = document.getElementById('detail-ios');
    if (iosBadge) iosBadge.textContent = 'iOS ' + (device.ios_version || '?');
    var statusBadge = document.getElementById('detail-status-badge');
    if (statusBadge) { statusBadge.textContent = device.status === 'running' ? 'Running' : device.status === 'online' ? 'Online' : 'Offline'; statusBadge.className = 'detail-badge status ' + device.status; }
    var runBtn2 = document.getElementById('detail-btn-run');
    var ssBtn = document.getElementById('detail-btn-screenshot');
    var stopBtn2 = document.getElementById('detail-btn-stop');
    if (runBtn2) runBtn2.onclick = function() {
        var content = document.getElementById('code-textarea').value.trim();
        if (!content) { showToast('?? Editor tr?ng', 'Nh?p script tru?c', 'warn'); return; }
        sendWs({ action: 'run_script', targetUdid: udid, script: content, scriptName: document.getElementById('script-name').value.trim() });
        showToast('? �ang ch?y', 'Tr�n: ' + device.name, 'info');
    };
    if (ssBtn) ssBtn.onclick = function() { sendWs({ action: 'request_screenshot', targetUdid: udid }); activateTab('screen'); };
    if (stopBtn2) stopBtn2.onclick = function() { sendWs({ action: 'stop_script', targetUdid: udid }); showToast('? D?ng script', device.name, 'warn'); };
}

// Welcome toast
setTimeout(function() { showToast('?? iOSControl Pro v3.0', 'Server s?n s�ng. Ch? thi?t b? k?t n?i...', 'system', 5000); }, 800);

// ──────────────────────────────────────────────────────────────
// MONACO EDITOR CDN INITIALIZATION
// ──────────────────────────────────────────────────────────────
if (typeof require !== 'undefined') {
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
        const initialCode = `-- iOSControl Lua Script
-- Nhập Lua Script để điều khiển thiết bị...
tap(100, 200)
sleep(1)
swipe(100, 500, 100, 200, 0.5)
`;
        monacoEditor = monaco.editor.create(document.getElementById('editor-container'), {
            value: initialCode,
            language: 'lua',
            theme: 'vs-dark',
            automaticLayout: true,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            minimap: { enabled: false }
        });
        
        // Relay change events to app logic
        monacoEditor.onDidChangeModelContent(function() {
            codeTextarea.value = monacoEditor.getValue();
            if (typeof window._onMonacoInput === 'function') {
                window._onMonacoInput();
            }
        });
    });
} else {
    console.warn("Monaco Editor CDN is offline or blocked. Falling back to default textarea.");
    const textarea = document.getElementById('code-textarea');
    if (textarea) textarea.style.display = 'block';
    const container = document.getElementById('editor-container');
    if (container) container.style.display = 'none';
}

// ──────────────────────────────────────────────────────────────
// PREMIUM MAGNIFIER GLASS & COLOR COORDINATE PICKER (HALLMARK STYLE)
// ──────────────────────────────────────────────────────────────
const magnifierGlass = document.getElementById('magnifier-glass');
const magnifierCanvas = document.getElementById('magnifier-canvas');
const pickerInfoBar = document.getElementById('picker-info-bar');
const cacheCanvas = document.createElement('canvas');
const cacheCtx = cacheCanvas.getContext('2d');
let cacheUpdated = false;

// Update cache canvas when image loads
screenImageEl.addEventListener('load', function() {
    cacheCanvas.width = screenImageEl.naturalWidth;
    cacheCanvas.height = screenImageEl.naturalHeight;
    cacheCtx.drawImage(screenImageEl, 0, 0);
    cacheUpdated = true;
});

// Track toggle state changes to show/hide magnifier
const _origTogglePicker = togglePicker;
togglePicker = function() {
    _origTogglePicker();
    const active = pickerActive;
    if (pickerInfoBar) pickerInfoBar.style.display = active ? 'flex' : 'none';
    if (!active && magnifierGlass) magnifierGlass.style.display = 'none';
};

screenImageEl.addEventListener('mousemove', function(e) {
    if (!pickerActive) return;
    const rect = screenImageEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pctX = x / rect.width;
    const pctY = y / rect.height;

    // Scale to device resolution
    const devX = Math.round(pctX * deviceResolution.w);
    const devY = Math.round(pctY * deviceResolution.h);

    // Show magnifier coordinates
    document.getElementById('picker-coords').textContent = 'x: ' + devX + '  y: ' + devY;
    document.getElementById('picker-code').textContent = 'tap(' + devX + ', ' + devY + ')';

    if (cacheUpdated && magnifierGlass && magnifierCanvas) {
        const pixelX = Math.floor(pctX * cacheCanvas.width);
        const pixelY = Math.floor(pctY * cacheCanvas.height);
        
        try {
            const pixel = cacheCtx.getImageData(pixelX, pixelY, 1, 1).data;
            const r = pixel[0], g = pixel[1], b = pixel[2];
            const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();

            // Update swatch & values
            document.getElementById('picker-color-swatch').style.backgroundColor = hex;
            document.getElementById('picker-color-hex').textContent = hex;
            document.getElementById('picker-color-rgb').textContent = '(RGB: ' + r + ', ' + g + ', ' + b + ')';

            // Position and render magnifier glass
            magnifierGlass.style.display = 'block';
            magnifierGlass.style.left = (x - 65) + 'px';
            magnifierGlass.style.top = (y - 145) + 'px';

            const magCtx = magnifierCanvas.getContext('2d');
            magCtx.clearRect(0, 0, 130, 130);
            magCtx.imageSmoothingEnabled = false;

            const srcSize = 11; // 11x11 pixel neighborhood
            const srcX = pixelX - Math.floor(srcSize / 2);
            const srcY = pixelY - Math.floor(srcSize / 2);

            magCtx.drawImage(
                cacheCanvas,
                srcX, srcY, srcSize, srcSize,
                0, 0, 130, 130
            );

            // Draw center pixel indicator
            const centerPixelSize = 130 / srcSize;
            magCtx.strokeStyle = 'rgba(255,255,255,0.7)';
            magCtx.lineWidth = 1;
            magCtx.strokeRect(65 - centerPixelSize / 2, 65 - centerPixelSize / 2, centerPixelSize, centerPixelSize);

            // Crosshair
            magCtx.strokeStyle = 'rgba(6,182,212,0.6)';
            magCtx.lineWidth = 1;
            magCtx.beginPath();
            magCtx.moveTo(65, 0); magCtx.lineTo(65, 130);
            magCtx.moveTo(0, 65); magCtx.lineTo(130, 65);
            magCtx.stroke();

        } catch (err) {
            console.error('Failed to get pixel data:', err);
        }
    }
});

screenImageEl.addEventListener('mouseleave', function() {
    if (magnifierGlass) magnifierGlass.style.display = 'none';
});

// ──────────────────────────────────────────────────────────────
// VNC SCREEN STREAMING
// ──────────────────────────────────────────────────────────────
let vncActive = false;
const vncToggleBtn = document.getElementById('btn-vnc-toggle');
const vncIframe = document.getElementById('vnc-iframe');

if (vncToggleBtn) {
    vncToggleBtn.addEventListener('click', function() {
        if (!selectedDeviceUdid) {
            showToast('⚠️ Chọn thiết bị', 'Vui lòng chọn thiết bị trong danh sách trước', 'warn');
            return;
        }
        
        const device = connectedDevices.find(function(d) { return d.udid === selectedDeviceUdid; });
        if (!device) return;

        vncActive = !vncActive;
        vncToggleBtn.classList.toggle('active', vncActive);
        const vncLabel = document.getElementById('vnc-toggle-label');
        if (vncLabel) vncLabel.textContent = vncActive ? 'Tắt VNC Stream' : 'Bật VNC Stream';

        if (vncActive) {
            // Stop screenshot streaming if active
            if (isStreaming) {
                const streamBtn = document.getElementById('btn-stream-toggle');
                if (streamBtn) streamBtn.click();
            }

            screenPlaceholderEl.style.display = 'none';
            screenImageEl.style.display = 'none';
            vncIframe.style.display = 'block';

            // Connect noVNC
            const wsPort = device.vnc_port || 5900;
            const vncUrl = '/vnc_helper.html?host=' + device.ip + '&port=' + wsPort;
            
            vncIframe.src = vncUrl;
            showToast('📺 Kết nối VNC', 'Đang kết nối màn hình: ' + device.name, 'info');
            logToConsole('system', 'Bắt đầu stream VNC tới ' + device.name + ' (' + device.ip + ':' + wsPort + ')');
        } else {
            vncIframe.src = '';
            vncIframe.style.display = 'none';
            screenPlaceholderEl.style.display = 'block';
            showToast('📺 Ngắt kết nối VNC', 'Đã tắt màn hình VNC', 'warn');
            logToConsole('system', 'Đã đóng stream VNC.');
        }
    });
}

// Auto-deactivate VNC when screenshot or screenshot stream is toggled
if (screenshotBtn) {
    screenshotBtn.addEventListener('click', function() {
        if (vncActive && vncToggleBtn) vncToggleBtn.click();
    });
}
if (streamToggleBtn) {
    streamToggleBtn.addEventListener('click', function() {
        if (vncActive && vncToggleBtn) vncToggleBtn.click();
    });
}

// ──────────────────────────────────────────────────────────────
// v4.0 ADVANCED IDE CONTROLS (ACTIVITY BAR & DOCK TABS)
// ──────────────────────────────────────────────────────────────

// Activity Bar tab selection
document.querySelectorAll('.activity-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.activity-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const targetPanel = btn.getAttribute('data-sidebar');
        
        document.querySelectorAll('.sidebar-panel').forEach(function(panel) { panel.classList.remove('active'); });
        const panel = document.getElementById('panel-' + targetPanel);
        if (panel) panel.classList.add('active');
    });
});

// Dock tabs selection
document.querySelectorAll('.dock-tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.dock-tab-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const targetDock = btn.getAttribute('data-dock');
        
        document.querySelectorAll('.dock-panel').forEach(function(panel) { panel.classList.remove('active'); });
        const dock = document.getElementById('dock-' + targetDock);
        if (dock) dock.classList.add('active');
    });
});

// Toggle Editor Views (Code vs Flow Designer)
const btnToggleCode = document.getElementById('btn-toggle-code-view');
const btnToggleFlow = document.getElementById('btn-toggle-flow-view');
if (btnToggleCode && btnToggleFlow) {
    btnToggleCode.addEventListener('click', function() {
        btnToggleCode.classList.add('active');
        btnToggleFlow.classList.remove('active');
        document.getElementById('editor-view-code').style.display = 'block';
        document.getElementById('editor-view-flow').style.display = 'none';
    });
    btnToggleFlow.addEventListener('click', function() {
        btnToggleFlow.classList.add('active');
        btnToggleCode.classList.remove('active');
        document.getElementById('editor-view-code').style.display = 'none';
        document.getElementById('editor-view-flow').style.display = 'block';
        renderFlowCanvas();
    });
}

// ──────────────────────────────────────────────────────────────
// FLOW DESIGNER ENGINE (DRAG & DROP BLOCK GRAPH)
// ──────────────────────────────────────────────────────────────
let flowNodes = [{ id: 'start', type: 'start' }];
const flowCanvas = document.getElementById('flow-canvas-container');

if (flowCanvas) {
    flowCanvas.addEventListener('dragover', function(e) {
        e.preventDefault();
    });
    
    flowCanvas.addEventListener('drop', function(e) {
        e.preventDefault();
        const actionType = e.dataTransfer.getData('text/plain');
        if (!actionType) return;
        
        const id = 'node_' + Date.now();
        let newNode = { id: id, type: actionType };
        if (actionType === 'tap') {
            newNode.x = 100; newNode.y = 200;
        } else if (actionType === 'swipe') {
            newNode.x1 = 100; newNode.y1 = 200;
            newNode.x2 = 100; newNode.y2 = 600;
            newNode.duration = 500;
        } else if (actionType === 'sleep') {
            newNode.ms = 1000;
        } else if (actionType === 'log') {
            newNode.msg = 'Đang chạy tự động...';
        }
        flowNodes.push(newNode);
        renderFlowCanvas();
    });
}

// Drag start from toolbox
document.querySelectorAll('.toolbox-item').forEach(function(item) {
    item.addEventListener('dragstart', function(e) {
        e.dataTransfer.setData('text/plain', item.getAttribute('data-action'));
    });
});

function renderFlowCanvas() {
    const canvas = document.getElementById('flow-canvas-container');
    if (!canvas) return;
    canvas.innerHTML = '';
    
    flowNodes.forEach(function(node, idx) {
        const block = document.createElement('div');
        block.className = 'flow-block-node node-' + node.type;
        
        let html = '<h4>' + node.type.toUpperCase();
        if (node.type !== 'start') {
            html += ' <span class="flow-node-delete" onclick="deleteFlowNode(\'' + node.id + '\')">🗑️</span>';
        }
        html += '</h4>';
        
        if (node.type === 'start') {
            html += '<p style="font-size:10px; opacity:0.6;">Điểm bắt đầu kịch bản</p>';
        } else if (node.type === 'tap') {
            html += '<div style="display:flex; gap:6px;">' +
                '<input type="number" placeholder="X" value="' + node.x + '" onchange="updateNodeProp(\'' + node.id + '\', \'x\', this.value)">' +
                '<input type="number" placeholder="Y" value="' + node.y + '" onchange="updateNodeProp(\'' + node.id + '\', \'y\', this.value)">' +
            '</div>';
        } else if (node.type === 'swipe') {
            html += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">' +
                '<input type="number" placeholder="X1" value="' + node.x1 + '" onchange="updateNodeProp(\'' + node.id + '\', \'x1\', this.value)">' +
                '<input type="number" placeholder="Y1" value="' + node.y1 + '" onchange="updateNodeProp(\'' + node.id + '\', \'y1\', this.value)">' +
                '<input type="number" placeholder="X2" value="' + node.x2 + '" onchange="updateNodeProp(\'' + node.id + '\', \'x2\', this.value)">' +
                '<input type="number" placeholder="Y2" value="' + node.y2 + '" onchange="updateNodeProp(\'' + node.id + '\', \'y2\', this.value)">' +
            '</div>' +
            '<input type="number" placeholder="Duration (ms)" value="' + node.duration + '" style="margin-top:4px;" onchange="updateNodeProp(\'' + node.id + '\', \'duration\', this.value)">';
        } else if (node.type === 'sleep') {
            html += '<input type="number" placeholder="Chờ (ms)" value="' + node.ms + '" onchange="updateNodeProp(\'' + node.id + '\', \'ms\', this.value)">';
        } else if (node.type === 'log') {
            html += '<input type="text" placeholder="Nội dung ghi log" value="' + node.msg + '" onchange="updateNodeProp(\'' + node.id + '\', \'msg\', this.value)">';
        } else if (node.type === 'screenshot') {
            html += '<p style="font-size:10px; opacity:0.6;">Chụp ảnh màn hình</p>';
        }
        
        block.innerHTML = html;
        canvas.appendChild(block);
        
        if (idx < flowNodes.length - 1) {
            const arrow = document.createElement('div');
            arrow.className = 'flow-connector-line';
            canvas.appendChild(arrow);
        }
    });
}

window.deleteFlowNode = function(id) {
    flowNodes = flowNodes.filter(function(n) { return n.id !== id; });
    renderFlowCanvas();
};

window.updateNodeProp = function(id, prop, value) {
    const node = flowNodes.find(function(n) { return n.id === id; });
    if (node) {
        node[prop] = isNaN(value) ? value : parseInt(value);
    }
};

const btnFlowGen = document.getElementById('btn-flow-generate');
if (btnFlowGen) {
    btnFlowGen.addEventListener('click', function() {
        let code = '-- Generated Script via Flow Designer\n\n';
        flowNodes.forEach(function(node) {
            if (node.type === 'tap') {
                code += 'tap(' + node.x + ', ' + node.y + ')\n';
            } else if (node.type === 'swipe') {
                code += 'swipe(' + node.x1 + ', ' + node.y1 + ', ' + node.x2 + ', ' + node.y2 + ', ' + node.duration + ')\n';
            } else if (node.type === 'sleep') {
                code += 'sleep(' + node.ms + ')\n';
            } else if (node.type === 'log') {
                code += 'log("' + node.msg + '")\n';
            } else if (node.type === 'screenshot') {
                code += 'screenshot()\n';
            }
        });
        
        if (window._editor) {
            window._editor.setValue(code);
        } else {
            codeTextarea.value = code;
        }
        showToast('⚡ Thành công', 'Đã sinh mã LUA', 'success');
        logToConsole('success', 'Đã chuyển sơ đồ Flow sang mã kịch bản.');
        if (btnToggleCode) btnToggleCode.click();
    });
}

const btnFlowClear = document.getElementById('btn-flow-clear');
if (btnFlowClear) {
    btnFlowClear.addEventListener('click', function() {
        flowNodes = [{ id: 'start', type: 'start' }];
        renderFlowCanvas();
        showToast('🗑️ Đã xóa', 'Đặt lại sơ đồ Flow', 'info');
    });
}

// ──────────────────────────────────────────────────────────────
// CLIENT-SIDE AUTO OCR (USING TESSERACT.JS)
// ──────────────────────────────────────────────────────────────
const btnOcrExtract = document.getElementById('btn-ocr-extract');
if (btnOcrExtract) {
    btnOcrExtract.addEventListener('click', async function() {
        if (!screenImageEl.src || screenImageEl.style.display === 'none') {
            showToast('⚠️ Không có ảnh', 'Vui lòng bật stream hoặc chụp ảnh trước', 'warn');
            return;
        }
        
        showToast('👁️ OCR', 'Đang nhận diện chữ...', 'info');
        logToConsole('system', 'Khởi chạy công cụ Tesseract OCR trên ảnh màn hình...');
        
        try {
            const result = await Tesseract.recognize(screenImageEl.src, 'vie+eng', {
                logger: function(m) {
                    if (m.status === 'recognizing text') {
                        logToConsole('info', 'OCR Tiến trình: ' + Math.round(m.progress * 100) + '%');
                    }
                }
            });
            const text = result.data.text.trim();
            logToConsole('success', '=== KẾT QUẢ OCR ===\n' + text);
            showToast('👁️ Thành công', 'Đã đọc được chữ viết', 'success');
        } catch (err) {
            logToConsole('error', 'Lỗi OCR: ' + err.message);
            showToast('⚠️ Thất bại', 'Không thể hoàn thành OCR', 'error');
        }
    });
}

// ── Target device select dropdown selector bridge ──
const selectTarget = document.getElementById('select-target-device');
if (selectTarget) {
    selectTarget.addEventListener('change', function(e) {
        const udid = e.target.value;
        if (udid) {
            selectDevice(udid);
        }
    });
}

const _origRenderDeviceList = renderDeviceList;
renderDeviceList = function() {
    if (typeof _origRenderDeviceList === 'function') _origRenderDeviceList();
    const selectTarget = document.getElementById('select-target-device');
    if (selectTarget) {
        selectTarget.innerHTML = '<option value="">— Chọn thiết bị —</option>';
        connectedDevices.forEach(function(d) {
            selectTarget.innerHTML += '<option value="' + d.udid + '"' + (d.udid === selectedDeviceUdid ? ' selected' : '') + '>' + d.name + ' (' + d.ip + ')</option>';
        });
    }
};

// Toggle Picker active states using index.html elements
const btnPickerToggle = document.getElementById('btn-picker-toggle');
if (btnPickerToggle) {
    btnPickerToggle.addEventListener('click', function() {
        pickerActive = !pickerActive;
        btnPickerToggle.classList.toggle('active', pickerActive);
        if (pickerActive) {
            showToast('🎯 Picker bật', 'Bấm vào màn hình để tự sinh tap(x,y)', 'info');
        } else {
            showToast('Picker tắt', 'Đã chuyển về tương tác trực tiếp', 'info');
        }
    });
}

// ──────────────────────────────────────────────────────────────
// v4.1 GIT PANEL & KEYBOARD EMULATOR CLIENT IMPLEMENTATION
// ──────────────────────────────────────────────────────────────

// 1. GIT PANEL FUNCTIONALITY
const gitStatusList = document.getElementById('git-status-list');
const gitCommitMsg = document.getElementById('git-commit-msg');
const btnGitCommit = document.getElementById('btn-git-commit');

async function loadGitStatus() {
    if (!gitStatusList) return;
    try {
        const res = await fetch('/api/git/status');
        const data = await res.json();
        if (data.success && data.files) {
            gitStatusList.innerHTML = '';
            if (data.files.length === 0) {
                gitStatusList.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">Không có thay đổi nào.</div>';
                return;
            }
            data.files.forEach(function(file) {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.padding = '4px 6px';
                item.style.borderRadius = '3px';
                item.style.background = 'rgba(255,255,255,0.02)';
                
                let badgeColor = 'var(--text-muted)';
                let badgeText = file.status;
                if (file.status === 'M') { badgeColor = 'var(--accent-amber)'; badgeText = 'Sửa đổi'; }
                else if (file.status === '??') { badgeColor = 'var(--accent-emerald)'; badgeText = 'Mới'; }
                else if (file.status === 'D') { badgeColor = 'var(--accent-red)'; badgeText = 'Xóa'; }

                item.innerHTML = '<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;" title="' + file.name + '">' + file.name + '</span>' +
                                 '<span style="color:' + badgeColor + '; font-size:9px; font-weight:700;">' + badgeText + '</span>';
                gitStatusList.appendChild(item);
            });
        } else {
            gitStatusList.innerHTML = '<div style="color: var(--accent-red);">Không thể tải trạng thái Git.</div>';
        }
    } catch (err) {
        gitStatusList.innerHTML = '<div style="color: var(--accent-red);">Lỗi kết nối.</div>';
    }
}

// Fetch Git status when Git sidebar is selected
const gitActBtn = document.querySelector('[data-sidebar="git"]');
if (gitActBtn) {
    gitActBtn.addEventListener('click', function() {
        loadGitStatus();
    });
}

// Commit and Push handler
if (btnGitCommit) {
    btnGitCommit.addEventListener('click', async function() {
        const msg = gitCommitMsg.value.trim();
        if (!msg) {
            showToast('⚠️ Thiếu thông tin', 'Vui lòng nhập tin nhắn commit', 'warn');
            return;
        }
        
        btnGitCommit.disabled = true;
        btnGitCommit.textContent = '🐙 Đang Push...';
        showToast('🐙 Git Push', 'Đang đẩy code lên GitHub...', 'info');
        logToConsole('system', 'Bắt đầu commit và push code lên GitHub...');
        
        try {
            const res = await fetch('/api/git/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg })
            });
            const data = await res.json();
            if (data.success) {
                showToast('🐙 Thành công', 'Đã push lên GitHub thành công!', 'success');
                logToConsole('success', 'Git Push Thành công:\n' + data.log);
                gitCommitMsg.value = '';
                loadGitStatus();
            } else {
                showToast('⚠️ Thất bại', 'Lỗi push code lên GitHub', 'error');
                logToConsole('error', 'Git Push Lỗi:\n' + (data.log || data.error));
            }
        } catch (err) {
            showToast('⚠️ Lỗi mạng', 'Không thể kết nối API Git', 'error');
        } finally {
            btnGitCommit.disabled = false;
            btnGitCommit.textContent = '🐙 Commit & Push';
        }
    });
}

// 2. KEYBOARD EMULATOR
// Make screen image focusable so it receives key events
if (screenImageEl) {
    screenImageEl.setAttribute('tabindex', '0');
    screenImageEl.style.outline = 'none'; // remove browser outline
    
    screenImageEl.addEventListener('keydown', function(e) {
        // Prevent default scrolling keys
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].indexOf(e.code) > -1) {
            e.preventDefault();
        }

        if (!selectedDeviceUdid) return;

        let script = '';
        if (e.key.length === 1) {
            // Standard alphanumeric / punctuation key
            const char = e.key.replace(/"/g, '\\"');
            script = 'typeText("' + char + '")';
        } else if (e.key === 'Enter') {
            script = 'typeText("\n")';
        } else if (e.key === 'Backspace') {
            script = 'typeText("\b")'; // standard backspace
        }

        if (script) {
            const isMultiSync = document.getElementById('chk-multi-sync')?.checked;
            if (isMultiSync) {
                connectedDevices.forEach(d => {
                    sendWs({ action: 'run_script', targetUdid: d.udid, script: script, scriptName: 'key_press.lua' });
                });
            } else {
                sendWs({ action: 'run_script', targetUdid: selectedDeviceUdid, script: script, scriptName: 'key_press.lua' });
            }
        }
    });
}


// ──────────────────────────────────────────────────────────────
// v4.2 WORKSPACE & SECURITY SETTINGS IMPLEMENTATION
// ──────────────────────────────────────────────────────────────
let currentWorkspace = '';

const selectWorkspace = document.getElementById('select-workspace');
const btnCreateWorkspace = document.getElementById('btn-create-workspace');
const btnDeleteWorkspace = document.getElementById('btn-delete-workspace');
const inputPasscode = document.getElementById('input-passcode');
const btnSavePasscode = document.getElementById('btn-save-passcode');

// Load settings on init
async function loadSecuritySettings() {
    if (!inputPasscode) return;
    try {
        const res = await fetch('/api/security/status');
        const data = await res.json();
        if (data.success) {
            const savedPass = localStorage.getItem('auth_passcode') || '';
            inputPasscode.value = savedPass;
        }
    } catch(e) {}
}

if (btnSavePasscode) {
    btnSavePasscode.addEventListener('click', async () => {
        const pass = inputPasscode.value.trim();
        try {
            const res = await fetch('/api/security/passcode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passcode: pass })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('auth_passcode', pass);
                showToast('🛡️ Bảo mật', 'Đã cập nhật mật khẩu truy cập', 'success');
                // Reconnect WebSocket to authenticate with new passcode
                if (ws) ws.close();
                setTimeout(connectWebSocket, 1000);
            }
        } catch(e) {
            showToast('⚠️ Lỗi', 'Không thể kết nối lưu mật khẩu', 'error');
        }
    });
}

// Workspaces list
async function loadWorkspaces() {
    if (!selectWorkspace) return;
    try {
        const res = await fetch('/api/workspaces');
        const data = await res.json();
        if (data.success && data.workspaces) {
            selectWorkspace.innerHTML = '<option value="">— Thư mục chính —</option>';
            data.workspaces.forEach(wsName => {
                selectWorkspace.innerHTML += `<option value="${wsName}" ${currentWorkspace === wsName ? 'selected' : ''}>📁 ${wsName}</option>`;
            });
        }
    } catch(e) {}
}

if (selectWorkspace) {
    selectWorkspace.addEventListener('change', (e) => {
        currentWorkspace = e.target.value;
        // Reload scripts for this workspace
        loadScripts(currentWorkspace);
        showToast('📁 Thư mục', 'Đã chuyển sang dự án: ' + (currentWorkspace || 'Thư mục chính'), 'info');
    });
}

if (btnCreateWorkspace) {
    btnCreateWorkspace.addEventListener('click', async () => {
        const name = prompt('Nhập tên thư mục dự án mới (viết liền không dấu):');
        if (!name) return;
        try {
            const res = await fetch('/api/workspaces/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (data.success) {
                currentWorkspace = data.name;
                loadWorkspaces();
                loadScripts(currentWorkspace);
                showToast('📁 Dự án mới', 'Đã tạo thư mục: ' + currentWorkspace, 'success');
            }
        } catch(e) {}
    });
}

if (btnDeleteWorkspace) {
    btnDeleteWorkspace.addEventListener('click', async () => {
        if (!currentWorkspace) {
            showToast('⚠️ Lỗi', 'Vui lòng chọn dự án con để xóa', 'warn');
            return;
        }
        if (!confirm('Bạn có chắc chắn muốn xóa dự án "' + currentWorkspace + '" cùng toàn bộ script bên trong?')) return;
        try {
            const res = await fetch('/api/workspaces/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: currentWorkspace })
            });
            const data = await res.json();
            if (data.success) {
                showToast('🗑️ Đã xóa', 'Đã xóa dự án thành công', 'success');
                currentWorkspace = '';
                loadWorkspaces();
                loadScripts();
            }
        } catch(e) {}
    });
}

// Trigger in bootstrap
loadSecuritySettings();
loadWorkspaces();

// Hook fetch options to send Passcode header automatically in all API requests
const _origFetch = window.fetch;
window.fetch = function(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    const pass = localStorage.getItem('auth_passcode');
    if (pass) {
        if (options.headers instanceof Headers) {
            options.headers.set('Authorization', pass);
        } else {
            options.headers['Authorization'] = pass;
        }
    }
    return _origFetch(url, options);
};


// ──────────────────────────────────────────────────────────────
// v5.2 REFERENCE APP FEATURES INTEGRATION (ZOOM, CONVERTER, I18N)
// ──────────────────────────────────────────────────────────────

// 1. MULTILINGUAL I18N DICTIONARY & LOGIC
const btnLangToggle = document.getElementById('btn-lang-toggle');
let currentLang = 'VI';

const translations = {
    EN: {
        'explorer-header': 'EXPLORER: SCRIPTS',
        'btn-new-folder': 'New Folder',
        'btn-new-script': 'New Script',
        'btn-create-workspace': '📁 Create Project',
        'btn-delete-workspace': '🗑️ Delete Project',
        'btn-refresh-devices': 'Refresh',
        'btn-git-commit': '🐙 Commit & Push origin',
        'btn-save-passcode': '🛡️ Save Passcode',
        'btn-save': 'Save',
        'btn-run': 'Run',
        'btn-stop': 'Stop',
        'btn-run-all': 'Run Multi',
        'btn-stop-all': 'Stop Multi',
        'quick-device-info': 'No device selected',
        'status-ws-indicator': 'Offline',
        'status-ws-indicator-bar': 'Offline',
        'status-device-indicator': 'Devices: 0',
        'btn-convert-python': '⚡ Compile to LUA & Load'
    },
    VI: {
        'explorer-header': 'EXPLORER: SCRIPTS',
        'btn-new-folder': 'Tạo Thư mục',
        'btn-new-script': 'Tạo Script',
        'btn-create-workspace': '📁 Tạo Dự án',
        'btn-delete-workspace': '🗑️ Xóa Dự án',
        'btn-refresh-devices': 'Làm mới',
        'btn-git-commit': '🐙 Commit & Push origin',
        'btn-save-passcode': '🛡️ Lưu Mật Khẩu',
        'btn-save': 'Lưu',
        'btn-run': 'Chạy',
        'btn-stop': 'Dừng',
        'btn-run-all': 'Chạy Hàng Loạt',
        'btn-stop-all': 'Dừng Hàng Loạt',
        'quick-device-info': 'Không có thiết bị chọn',
        'status-ws-indicator': 'Offline',
        'status-ws-indicator-bar': 'Offline',
        'status-device-indicator': 'Devices: 0',
        'btn-convert-python': '⚡ Biên dịch sang LUA & Nạp vào Editor'
    }
};

if (btnLangToggle) {
    btnLangToggle.addEventListener('click', () => {
        currentLang = currentLang === 'VI' ? 'EN' : 'VI';
        btnLangToggle.textContent = currentLang;
        showToast('🌐 Ngôn ngữ / Language', 'Đã chuyển sang: ' + (currentLang === 'VI' ? 'Tiếng Việt' : 'English'), 'info');
        
        // Apply translations
        const langData = translations[currentLang];
        const dict = {
            'EXPLORER: SCRIPTS': langData['explorer-header'],
            'Tạo dự án con': langData['btn-create-workspace'],
            'Xóa dự án con': langData['btn-delete-workspace'],
            'Làm mới': langData['btn-refresh-devices'],
            '🐙 Commit & Push origin': langData['btn-git-commit'],
            '🛡️ Lưu Mật Khẩu': langData['btn-save-passcode'],
            'Lưu': langData['btn-save'],
            'Chạy': langData['btn-run'],
            'Dừng': langData['btn-stop'],
            'Chạy Hàng Loạt': langData['btn-run-all'],
            'Dừng Hàng Loạt': langData['btn-stop-all'],
            'Biên dịch sang LUA & Nạp vào Editor': langData['btn-convert-python']
        };
        
        document.querySelectorAll('button, span, h2, h3, a').forEach(el => {
            const txt = el.textContent.trim();
            if (dict[txt]) {
                el.textContent = dict[txt];
            }
        });
    });
}

// 2. PYTHON TO LUA CONVERTER
const btnToggleConverter = document.getElementById('btn-toggle-converter-view');
const btnToggleCodeView = document.getElementById('btn-toggle-code-view');
const btnToggleFlowView = document.getElementById('btn-toggle-flow-view');
const converterView = document.getElementById('editor-view-converter');
const codeView = document.getElementById('editor-view-code');
const flowView = document.getElementById('editor-view-flow');

function deactivateAllEditorViews() {
    [codeView, flowView, converterView].forEach(v => { if (v) v.style.display = 'none'; });
    document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
}

if (btnToggleConverter) {
    btnToggleConverter.addEventListener('click', () => {
        deactivateAllEditorViews();
        btnToggleConverter.classList.add('active');
        if (converterView) {
            converterView.style.display = 'flex';
        }
    });
}

if (btnToggleCodeView) {
    btnToggleCodeView.addEventListener('click', () => {
        deactivateAllEditorViews();
        btnToggleCodeView.classList.add('active');
        if (codeView) codeView.style.display = 'block';
    });
}

if (btnToggleFlowView) {
    btnToggleFlowView.addEventListener('click', () => {
        deactivateAllEditorViews();
        btnToggleFlowView.classList.add('active');
        if (flowView) flowView.style.display = 'block';
    });
}

const btnConvertPython = document.getElementById('btn-convert-python');
const pythonInputArea = document.getElementById('python-input-area');

if (btnConvertPython && pythonInputArea) {
    btnConvertPython.addEventListener('click', () => {
        const pyCode = pythonInputArea.value;
        if (!pyCode.trim()) {
            showToast('⚠️ Trống', 'Vui lòng nhập mã Python', 'warn');
            return;
        }

        // Basic Regex Translation from Python to Lua
        let luaCode = "-- Biên dịch tự động từ Python sang LUA\n";
        const lines = pyCode.split('\n');
        
        lines.forEach(line => {
            let parsed = line.trim();
            if (!parsed) {
                luaCode += "\n";
                return;
            }
            if (parsed.startsWith('#')) {
                luaCode += "-- " + parsed.substring(1).trim() + "\n";
                return;
            }
            
            // Translate click/tap
            parsed = parsed.replace(/(?:click|tap)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g, 'tap($1, $2)');
            // Translate sleep
            parsed = parsed.replace(/(?:time\.sleep|sleep)\s*\(\s*(\d+(\.\d+)?)\s*\)/g, 'sleep($1)');
            // Translate swipe
            parsed = parsed.replace(/swipe\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, 'swipe($1, $2, $3, $4, 0.5)');
            // Translate print
            parsed = parsed.replace(/print\s*\(\s*['"](.*?)['"]\s*\)/g, 'log("$1")');
            
            luaCode += parsed + "\n";
        });

        // Load into editor
        if (monacoEditor) {
            monacoEditor.setValue(luaCode);
        } else if (codeTextarea) {
            codeTextarea.value = luaCode;
        }
        
        // Go back to code view
        deactivateAllEditorViews();
        if (btnToggleCodeView) btnToggleCodeView.classList.add('active');
        if (codeView) codeView.style.display = 'block';
        
        showToast('🐍 Biên dịch', 'Đã chuyển đổi mã Python sang LUA', 'success');
        logToConsole('success', 'Biên dịch Python -> LUA thành công.');
    });
}

// 3. SCREEN ZOOM & COLOR PICKER HELPER
const zoomModal = document.getElementById('zoomModal');
const zoomCloseBtn = document.getElementById('zoomCloseBtn');
const zoomScreenImage = document.getElementById('zoomScreenImage');
const zoomCoords = document.getElementById('zoomCoords');
const zoomPixelColor = document.getElementById('zoomPixelColor');
const zoomColorSwatch = document.getElementById('zoomColorSwatch');

if (screenImageEl) {
    screenImageEl.addEventListener('dblclick', () => {
        if (!selectedDeviceUdid) return;
        if (zoomModal && zoomScreenImage) {
            zoomScreenImage.src = screenImageEl.src;
            zoomModal.style.display = 'flex';
            showToast('🔍 Zoom & Color', 'Nhấp đúp chuột để đóng hoặc bấm ✕', 'info');
        }
    });
}

if (zoomCloseBtn) {
    zoomCloseBtn.addEventListener('click', () => {
        if (zoomModal) zoomModal.style.display = 'none';
    });
}

// Canvas color extractor logic
if (zoomScreenImage) {
    zoomScreenImage.addEventListener('mousemove', (e) => {
        const rect = zoomScreenImage.getBoundingClientRect();
        
        // Original standard coordinates scaled to standard phone dimensions (e.g. 750x1334)
        const scaleX = 750 / rect.width;
        const scaleY = 1334 / rect.height;
        
        const x = Math.round((e.clientX - rect.left) * scaleX);
        const y = Math.round((e.clientY - rect.top) * scaleY);
        
        if (x >= 0 && x <= 750 && y >= 0 && y <= 1334) {
            if (zoomCoords) zoomCoords.textContent = `x: ${x}  y: ${y}`;
            
            // Draw one pixel to get color
            const canvas = document.createElement('canvas');
            canvas.width = zoomScreenImage.naturalWidth || 1;
            canvas.height = zoomScreenImage.naturalHeight || 1;
            const ctx = canvas.getContext('2d');
            try {
                ctx.drawImage(zoomScreenImage, 0, 0);
                const imgX = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
                const imgY = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
                const pixel = ctx.getImageData(imgX, imgY, 1, 1).data;
                const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase();
                
                if (zoomPixelColor) zoomPixelColor.textContent = `HEX: ${hex}`;
                if (zoomColorSwatch) {
                    zoomColorSwatch.style.display = 'inline-block';
                    zoomColorSwatch.style.backgroundColor = hex;
                }
            } catch(err) {}
        }
    });
    
    // Clicking zoom screen inserts tap coordinate
    zoomScreenImage.addEventListener('click', (e) => {
        const rect = zoomScreenImage.getBoundingClientRect();
        const scaleX = 750 / rect.width;
        const scaleY = 1334 / rect.height;
        const x = Math.round((e.clientX - rect.left) * scaleX);
        const y = Math.round((e.clientY - rect.top) * scaleY);
        
        if (x >= 0 && x <= 750 && y >= 0 && y <= 1334) {
            const script = `tap(${x}, ${y})\n`;
            insertAtCursor(codeTextarea, script);
            showToast('👆 Thao tác', `Chèn lệnh tap(${x}, ${y})`, 'success');
            
            // Trigger command over WebSocket to device
            if (selectedDeviceUdid) {
                sendWs({ action: 'run_script', targetUdid: selectedDeviceUdid, script: `tap(${x}, ${y})`, scriptName: 'live_tap.lua' });
            }
        }
    });
}

// Global Quick Action handlers
window.quickSwipe = function(direction) {
    if (!selectedDeviceUdid) return;
    let script = '';
    if (direction === 'up') script = 'swipe(375, 900, 375, 200, 500)';
    else if (direction === 'down') script = 'swipe(375, 200, 375, 900, 500)';
    else if (direction === 'left') script = 'swipe(600, 667, 100, 667, 500)';
    else if (direction === 'right') script = 'swipe(100, 667, 600, 667, 500)';
    
    if (script) {
        sendWs({ action: 'run_script', targetUdid: selectedDeviceUdid, script: script, scriptName: 'quick_swipe.lua' });
        showToast('↔️ Vuốt nhanh', 'Gửi lệnh vuốt ' + direction, 'info');
    }
};

window.quickVolume = function(action) {
    if (!selectedDeviceUdid) return;
    const script = `pressVolume("${action}")`;
    sendWs({ action: 'run_script', targetUdid: selectedDeviceUdid, script: script, scriptName: 'volume.lua' });
    showToast('🔊 Phím cứng', 'Điều chỉnh âm lượng ' + action, 'info');
};

window.quickLock = function() {
    if (!selectedDeviceUdid) return;
    // Power button lock simulation via Volume Down press (tweak fallback) or volume button lock
    const script = `pressVolume("down")`;
    sendWs({ action: 'run_script', targetUdid: selectedDeviceUdid, script: script, scriptName: 'lock.lua' });
    showToast('🔒 Phím cứng', 'Gửi lệnh khóa màn hình / nguồn', 'info');
};
