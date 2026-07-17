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
            // Full state on (re)connect
            connectedDevices = msg.devices || [];
            if (msg.serverInfo) {
                serverAddressEl.textContent = `${msg.serverInfo.ip}:${msg.serverInfo.port}`;
            }
            renderDeviceList();
            break;

        case 'device_connected':
            if (!connectedDevices.find(d => d.udid === msg.device.udid)) {
                connectedDevices.push(msg.device);
            }
            logToConsole('success', `Thiết bị kết nối: ${msg.device.name} (${msg.device.ip})`);
            renderDeviceList();
            break;

        case 'device_disconnected':
            connectedDevices = connectedDevices.filter(d => d.udid !== msg.device.udid);
            logToConsole('warn', `Thiết bị ngắt kết nối: ${msg.device.name}`);
            if (selectedDeviceUdid === msg.device.udid) {
                selectedDeviceUdid = null;
            }
            renderDeviceList();
            break;

        case 'device_status_change':
            updateDeviceInList(msg.device);
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
            handleScreenshotReceived(msg);
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

// ── Bootstrap ──────────────────────────────────────────
connectWebSocket();
loadScripts();
loadServerInfo();
updateLineNumbers();
