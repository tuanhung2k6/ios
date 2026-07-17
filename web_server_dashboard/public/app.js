// Web UI Logic
let ws;
let connectedDevices = [];
let savedScripts = [];
let selectedDeviceUdid = null;
let currentScriptName = "main.lua";

const deviceListEl = document.getElementById('device-list');
const scriptListEl = document.getElementById('script-list');
const deviceCountEl = document.getElementById('device-count');
const selectTargetEl = document.getElementById('select-target-device');
const runBtn = document.getElementById('btn-run');
const stopBtn = document.getElementById('btn-stop');
const saveBtn = document.getElementById('btn-save');
const newScriptBtn = document.getElementById('btn-new-script');
const scriptNameInput = document.getElementById('script-name');
const codeTextarea = document.getElementById('code-textarea');
const lineNumbersEl = document.getElementById('line-numbers');
const consoleLogsEl = document.getElementById('console-logs');
const clearConsoleBtn = document.getElementById('btn-clear-console');

// Connect to Server WebSocket
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:9898';
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
        logToConsole('System', 'Đã kết nối thành công tới Server điều khiển.', 'success');
        // Register as Web client
        ws.send(JSON.stringify({ clientType: 'web_ui' }));
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'device_list':
                    connectedDevices = data.devices;
                    updateDevicesUI();
                    break;
                case 'device_status_change':
                    handleDeviceStatusChange(data.device);
                    break;
                case 'device_log':
                    if (selectedDeviceUdid === data.udid) {
                        logToConsole(`Log [${data.timestamp}]`, data.message, 'device-log');
                    }
                    break;
                case 'error':
                    logToConsole('Error', data.message, 'error');
                    break;
            }
        } catch (e) {
            console.error('Error parsing WebSocket message:', e);
        }
    };

    ws.onclose = () => {
        logToConsole('System', 'Mất kết nối tới Server. Đang thử kết nối lại sau 5 giây...', 'error');
        setTimeout(connectWebSocket, 5000);
    };
}

// Log into Console Panel
function logToConsole(source, message, type = 'info') {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    
    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    
    line.appendChild(timestamp);
    line.appendChild(document.createTextNode(`[${source}] ${message}`));
    
    consoleLogsEl.appendChild(line);
    consoleLogsEl.scrollTop = consoleLogsEl.scrollHeight;
}

// Line Numbers Sync for Editor
function updateLineNumbers() {
    const text = codeTextarea.value;
    const lines = text.split('\n');
    const count = lines.length;
    
    let html = '';
    for (let i = 1; i <= count; i++) {
        html += `<span>${i}</span>`;
    }
    lineNumbersEl.innerHTML = html;
}

codeTextarea.addEventListener('input', updateLineNumbers);
codeTextarea.addEventListener('scroll', () => {
    lineNumbersEl.scrollTop = codeTextarea.scrollTop;
});

// Update Device List UI
function updateDevicesUI() {
    deviceCountEl.textContent = connectedDevices.length;
    
    // Clear list
    deviceListEl.innerHTML = '';
    
    // Re-populate dropdown
    const prevSelected = selectTargetEl.value;
    selectTargetEl.innerHTML = '<option value="">-- Chọn thiết bị --</option>';

    if (connectedDevices.length === 0) {
        deviceListEl.innerHTML = '<div class="empty-state">Không có thiết bị kết nối.</div>';
        selectedDeviceUdid = null;
        updateActionButtons();
        return;
    }

    connectedDevices.forEach(device => {
        // Dropdown options
        const option = document.createElement('option');
        option.value = device.udid;
        option.textContent = `${device.name} (${device.ip})`;
        if (device.udid === prevSelected) option.selected = true;
        selectTargetEl.appendChild(option);

        // Sidebar Item
        const item = document.createElement('div');
        item.className = `device-item ${selectedDeviceUdid === device.udid ? 'active' : ''}`;
        item.addEventListener('click', () => selectDevice(device.udid));

        const info = document.createElement('div');
        info.className = 'device-info';
        
        const name = document.createElement('div');
        name.className = 'device-name';
        name.textContent = device.name;

        const detail = document.createElement('div');
        detail.className = 'device-detail';
        detail.textContent = `${device.model} • ${device.ip}`;

        info.appendChild(name);
        info.appendChild(detail);

        const badge = document.createElement('span');
        badge.className = `device-badge-status ${device.status}`;
        badge.textContent = device.status;

        item.appendChild(info);
        item.appendChild(badge);

        deviceListEl.appendChild(item);
    });

    if (prevSelected && connectedDevices.some(d => d.udid === prevSelected)) {
        selectedDeviceUdid = prevSelected;
    } else if (connectedDevices.length > 0 && !selectedDeviceUdid) {
        // Auto select first device
        selectDevice(connectedDevices[0].udid);
    }
    updateActionButtons();
}

function handleDeviceStatusChange(updatedDevice) {
    const idx = connectedDevices.findIndex(d => d.udid === updatedDevice.udid);
    if (updatedDevice.status === 'offline') {
        if (idx !== -1) connectedDevices.splice(idx, 1);
    } else {
        if (idx !== -1) {
            connectedDevices[idx] = updatedDevice;
        } else {
            connectedDevices.push(updatedDevice);
        }
    }
    updateDevicesUI();
}

function selectDevice(udid) {
    selectedDeviceUdid = udid;
    selectTargetEl.value = udid;
    
    // Highlight sidebar items
    const items = deviceListEl.querySelectorAll('.device-item');
    connectedDevices.forEach((device, index) => {
        if (items[index]) {
            if (device.udid === udid) {
                items[index].classList.add('active');
            } else {
                items[index].classList.remove('active');
            }
        }
    });

    logToConsole('System', `Đã chọn thiết bị: ${connectedDevices.find(d => d.udid === udid)?.name || udid}`);
    updateActionButtons();
}

selectTargetEl.addEventListener('change', (e) => {
    if (e.target.value) {
        selectDevice(e.target.value);
    } else {
        selectedDeviceUdid = null;
        updateActionButtons();
    }
});

function updateActionButtons() {
    const hasDevice = !!selectedDeviceUdid;
    const device = connectedDevices.find(d => d.udid === selectedDeviceUdid);
    const isRunning = device && device.status === 'running';

    runBtn.disabled = !hasDevice || isRunning;
    stopBtn.disabled = !hasDevice || !isRunning;
}

// REST APIs for Script files
async function loadScripts() {
    try {
        const response = await fetch('/api/scripts');
        const data = await response.json();
        if (data.success) {
            savedScripts = data.scripts;
            updateScriptsUI();
        }
    } catch (e) {
        console.error('Error loading scripts:', e);
    }
}

function updateScriptsUI() {
    scriptListEl.innerHTML = '';
    if (savedScripts.length === 0) {
        scriptListEl.innerHTML = '<div class="empty-state">Chưa có script lưu trữ.</div>';
        return;
    }

    savedScripts.forEach(script => {
        const item = document.createElement('div');
        item.className = `script-item ${currentScriptName === script.name ? 'active' : ''}`;
        
        const title = document.createElement('span');
        title.className = 'script-title';
        title.textContent = script.name;
        
        item.addEventListener('click', (e) => {
            // Prevent trigger if clicking on actions
            if (e.target.tagName !== 'BUTTON' && e.target.closest('button') === null) {
                openScript(script.name);
            }
        });

        const actions = document.createElement('div');
        actions.className = 'script-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-icon btn-small';
        deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
        deleteBtn.title = "Xóa script";
        deleteBtn.addEventListener('click', () => deleteScript(script.name));

        actions.appendChild(deleteBtn);
        item.appendChild(title);
        item.appendChild(actions);

        scriptListEl.appendChild(item);
    });
}

function openScript(name) {
    const script = savedScripts.find(s => s.name === name);
    if (script) {
        currentScriptName = script.name;
        scriptNameInput.value = script.name;
        codeTextarea.value = script.content;
        updateLineNumbers();
        updateScriptsUI();
        logToConsole('System', `Đã mở script: ${name}`);
    }
}

async function saveScript() {
    const name = scriptNameInput.value.trim();
    const content = codeTextarea.value;
    if (!name) {
        alert('Vui lòng nhập tên Script');
        return;
    }
    
    try {
        const response = await fetch('/api/scripts/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content })
        });
        const data = await response.json();
        if (data.success) {
            logToConsole('System', `Đã lưu script ${name} thành công.`, 'success');
            currentScriptName = name.endsWith('.lua') ? name : `${name}.lua`;
            await loadScripts();
        } else {
            alert('Lỗi khi lưu script: ' + data.error);
        }
    } catch (e) {
        console.error(e);
        alert('Lỗi lưu script');
    }
}

async function deleteScript(name) {
    if (!confirm(`Bạn có chắc chắn muốn xóa script ${name}?`)) return;
    try {
        const response = await fetch(`/api/scripts/${name}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            logToConsole('System', `Đã xóa script ${name}.`);
            if (currentScriptName === name) {
                currentScriptName = "";
                scriptNameInput.value = "";
                codeTextarea.value = "";
                updateLineNumbers();
            }
            await loadScripts();
        }
    } catch (e) {
        console.error(e);
    }
}

// New Script Button Setup
newScriptBtn.addEventListener('click', () => {
    currentScriptName = "new_script.lua";
    scriptNameInput.value = currentScriptName;
    codeTextarea.value = "-- Viết code Lua kịch bản mới ở đây\n";
    updateLineNumbers();
    updateScriptsUI();
});

// Run Script Command
runBtn.addEventListener('click', () => {
    if (!selectedDeviceUdid) return;
    const content = codeTextarea.value;
    
    logToConsole('System', `Gửi yêu cầu thực thi script "${currentScriptName}" tới thiết bị...`, 'info');
    
    ws.send(JSON.stringify({
        action: 'run_script',
        targetUdid: selectedDeviceUdid,
        script: content,
        scriptName: currentScriptName
    }));
});

// Stop Script Command
stopBtn.addEventListener('click', () => {
    if (!selectedDeviceUdid) return;
    
    logToConsole('System', `Gửi yêu cầu DỪNG script tới thiết bị...`, 'warning');
    
    ws.send(JSON.stringify({
        action: 'stop_script',
        targetUdid: selectedDeviceUdid
    }));
});

// Save Script Button Click
saveBtn.addEventListener('click', saveScript);

// Clear Console Button Click
clearConsoleBtn.addEventListener('click', () => {
    consoleLogsEl.innerHTML = '';
});

// Initialize UI
connectWebSocket();
loadScripts();
updateLineNumbers();
