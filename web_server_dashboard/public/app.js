/* ═══════════════════════════════════════════════════════
   iOSControl Pro — Frontend Application Logic v2.0
═══════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────
let ws = null;
let wsReady = false;
let reconnectAttempt = 0;
let reconnectTimer = null;

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
    ws = new WebSocket(`${protocol}//${host}`);

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
    wsDotEl.className = 'connection-dot ' + (online ? 'connected' : 'disconnected');
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
    if (d) logToConsole('system', `Đã chọn: ${d.name}`);
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
    updateLineNumbers();
    renderScriptList();
    logToConsole('system', `Mở script: ${name}`);
    activateTab('editor');
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
function updateLineNumbers() {
    const count = (codeTextarea.value.match(/\n/g) || []).length + 1;
    lineNumbersEl.innerHTML = Array.from({ length: count }, (_, i) => `<span>${i + 1}</span>`).join('');
}

codeTextarea.addEventListener('input', updateLineNumbers);
codeTextarea.addEventListener('scroll', () => { lineNumbersEl.scrollTop = codeTextarea.scrollTop; });

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
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
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
    updateLineNumbers();
    renderScriptList();
    logToConsole('system', `Mở: ${folder ? folder + '/' : ''}${name}`);
    activateTab('editor');
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
function handleServerMessage(msg) {
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
function handleServerMessage(msg) {
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
function logToConsole(level, msg, ts) {
    _baseLogFn(level, msg, ts);
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
