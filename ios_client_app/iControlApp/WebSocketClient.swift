import Foundation
import UIKit

/// WebSocket connection manager connecting iOS client back to the Web Dashboard Server
class WebSocketClient: NSObject {
    static let shared = WebSocketClient()
    
    private var webSocket: URLSessionWebSocketTask?
    private var serverIP: String = "localhost"
    private var serverPort: String = "9898"
    private var isConnected = false
    private var mockUdid = ""
    
    private var scriptRunnerTimer: Timer?
    private var scriptLines: [String] = []
    private var isScriptRunning = false
    private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid
    
    // Auto-reconnect state
    private var reconnectTimer: Timer?
    private var reconnectAttempt = 0
    private let maxReconnectAttempts = 30
    
    private override init() {
        super.init()
        setupMockUdid()
        
        // Listen for terminate signal from HUD button
        NotificationCenter.default.addObserver(self, selector: #selector(stopCurrentScript), name: Notification.Name("TerminateScriptNotification"), object: nil)
        
        // Listen for background state transitions
        NotificationCenter.default.addObserver(self, selector: #selector(handleDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(handleWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        
        // Enable battery monitoring
        UIDevice.current.isBatteryMonitoringEnabled = true
    }
    
    private func setupMockUdid() {
        if let stored = UserDefaults.standard.string(forKey: "iControl_device_udid") {
            mockUdid = stored
        } else {
            let newUdid = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            UserDefaults.standard.set(newUdid, forKey: "iControl_device_udid")
            mockUdid = newUdid
        }
    }
    
    func connect(ip: String, port: String = "9898") {
        self.serverIP = ip
        self.serverPort = port
        reconnectAttempt = 0
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        _performConnect()
    }
    
    private func _performConnect() {
        webSocket?.cancel(with: .goingAway, reason: nil)
        guard let url = URL(string: "ws://\(serverIP):\(serverPort)") else { return }
        print("[WebSocketClient] Connecting to \(url.absoluteString)... (attempt \(reconnectAttempt + 1))")
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        let session = URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue())
        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()
        listenForMessages()
    }
    
    private func scheduleReconnect() {
        guard reconnectAttempt < maxReconnectAttempts else {
            FloatingWindow.shared.addLog("Max reconnect attempts reached. Tap Connect to retry.")
            return
        }
        reconnectAttempt += 1
        let delay = min(Double(reconnectAttempt) * 2.0, 15.0) // exponential back-off, max 15s
        FloatingWindow.shared.addLog("Reconnecting in \(Int(delay))s... (attempt \(reconnectAttempt))")
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?._performConnect()
        }
    }
    
    func disconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        reconnectAttempt = maxReconnectAttempts // prevent auto reconnect
        webSocket?.cancel(with: .goingAway, reason: nil)
        isConnected = false
        FloatingWindow.shared.setStatus(online: false)
    }
    
    private func listenForMessages() {
        webSocket?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error):
                print("[WebSocketClient] Receive error: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.isConnected = false
                    FloatingWindow.shared.setStatus(online: false)
                    FloatingWindow.shared.addLog("Server disconnected. Auto reconnecting...")
                    self.scheduleReconnect()
                }
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleIncomingText(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleIncomingText(text)
                    }
                @unknown default:
                    break
                }
                
                // Keep listening
                self.listenForMessages()
            }
        }
    }
    
    // MARK: - Incoming Message Handler
    
    private func handleIncomingText(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        
        do {
            if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] {
                let type = json["type"] as? String
                
                if type == "run_script" {
                    if let script = json["script"] as? String, let name = json["name"] as? String {
                        DispatchQueue.main.async { self.runScript(content: script, name: name) }
                    }
                } else if type == "stop_script" {
                    DispatchQueue.main.async { self.stopCurrentScript() }
                } else if type == "request_screenshot" {
                    DispatchQueue.main.async { self.captureAndSendScreenshot() }
                }
            }
        } catch {
            print("[WebSocketClient] Failed to decode JSON: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Device Info & Registration
    
    func registerDevice() {
        reconnectAttempt = 0 // reset on successful registration
        let device = UIDevice.current
        let name = device.name
        let model = device.model
        let ipAddress = getWiFiAddress() ?? "Unknown IP"
        let iosVersion = device.systemVersion
        let battery = Int(device.batteryLevel * 100)
        
        let registerPayload: [String: Any] = [
            "type": "register_device",
            "info": [
                "udid": mockUdid,
                "name": name,
                "model": model,
                "ip": ipAddress,
                "ios_version": iosVersion,
                "battery": battery >= 0 ? battery : 100,
                "vnc_port": NSNull() // set real VNC port if using Veency
            ]
        ]
        
        sendJSON(registerPayload)
        
        isConnected = true
        FloatingWindow.shared.setStatus(online: true)
        FloatingWindow.shared.addLog("\u2705 Connected as \(name) [iOS \(iosVersion)] · \(ipAddress)")
    }
    
    // MARK: - Screenshot Capture & Send
    
    func captureAndSendScreenshot() {
        guard let window = UIApplication.shared.windows.first else { return }
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        let image = renderer.image { ctx in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard let jpegData = image.jpegData(compressionQuality: 0.55) else { return }
        let base64 = jpegData.base64EncodedString()
        
        let payload: [String: Any] = [
            "type": "screenshot",
            "imageBase64": base64,
            "width": Int(window.bounds.width),
            "height": Int(window.bounds.height)
        ]
        sendJSON(payload)
    }
    
    func sendDeviceStatus(status: String) {
        let statusPayload: [String: Any] = [
            "type": "status_report",
            "status": status
        ]
        sendJSON(statusPayload)
    }
    
    func sendLog(message: String) {
        let logPayload: [String: Any] = [
            "type": "log",
            "message": message
        ]
        sendJSON(logPayload)
        
        // Also show on floating overlay
        FloatingWindow.shared.addLog(message)
    }
    
    private func sendJSON(_ dict: [String: Any]) {
        do {
            let data = try JSONSerialization.data(withJSONObject: dict, options: [])
            if let jsonString = String(data: data, encoding: .utf8) {
                webSocket?.send(.string(jsonString)) { error in
                    if let error = error {
                        print("[WebSocketClient] Send failed: \(error)")
                    }
                }
            }
        } catch {
            print("[WebSocketClient] Encoding JSON failed: \(error)")
        }
    }
    
    // MARK: - Lua Script Runner Engine (Skeletal Execution simulation)
    
    private func runScript(content: String, name: String) {
        print("[WebSocketClient] Running script: \(name)")
        self.sendLog(message: "Bắt đầu chạy script: \(name)")
        self.sendDeviceStatus(status: "running")
        FloatingWindow.shared.setStatus(online: true, running: true)
        
        // Stop any running script
        scriptRunnerTimer?.invalidate()
        
        // In a real Tweak environment, we write script to disk and run with Lua interpreter.
        // Let's parser lines looking for basic commands (tap, swipe, sleep, appRun, log)
        // to execute them dynamically for demonstration and verification.
        
        self.scriptLines = content.components(separatedBy: .newlines)
        self.isScriptRunning = true
        
        executeLine(at: 0)
    }
    
    private func executeLine(at index: Int) {
        guard isScriptRunning else { return }
        
        if index >= scriptLines.count {
            self.sendLog(message: "Kịch bản thực thi hoàn tất.")
            self.sendDeviceStatus(status: "online")
            FloatingWindow.shared.setStatus(online: true, running: false)
            self.isScriptRunning = false
            return
        }
        
        let line = scriptLines[index].trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Skip comments and empty lines
        if line.isEmpty || line.hasPrefix("--") || line.hasPrefix("local ") && !line.contains("require") {
            // Immediately execute next line
            self.executeLine(at: index + 1)
            return
        }
        
        var delay: Double = 0.1 // Default delay between lines
        
        if line.contains("sleep(") {
            let params = parseParameters(line, prefix: "sleep(")
            if let val = params.first, let sleepTime = Double(val) {
                delay = sleepTime
                self.sendLog(message: "Chờ \(sleepTime) giây")
            }
        } else if line.contains("tap(") {
            let coords = parseParameters(line, prefix: "tap(")
            if coords.count >= 2, let x = Double(coords[0]), let y = Double(coords[1]) {
                self.sendLog(message: "Click: \(x), \(y)")
                TouchSimulator.shared.tap(x: CGFloat(x), y: CGFloat(y))
                delay = 0.3
            }
        } else if line.contains("swipe(") {
            let params = parseParameters(line, prefix: "swipe(")
            if params.count >= 4,
               let x1 = Double(params[0]), let y1 = Double(params[1]),
               let x2 = Double(params[2]), let y2 = Double(params[3]) {
                let duration = params.count >= 5 ? (Double(params[4]) ?? 0.3) : 0.3
                self.sendLog(message: "Vuốt từ (\(x1), \(y1)) tới (\(x2), \(y2))")
                TouchSimulator.shared.swipe(fromX: CGFloat(x1), fromY: CGFloat(y1), toX: CGFloat(x2), toY: CGFloat(y2), duration: duration)
                delay = duration + 0.3
            }
        } else if line.contains("longPress(") {
            let params = parseParameters(line, prefix: "longPress(")
            if params.count >= 2, let x = Double(params[0]), let y = Double(params[1]) {
                let duration = params.count >= 3 ? (Double(params[2]) ?? 1.0) : 1.0
                self.sendLog(message: "Nhấn giữ tại (\(x), \(y)) trong \(duration)s")
                TouchSimulator.shared.touchDown(x: CGFloat(x), y: CGFloat(y))
                DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
                    TouchSimulator.shared.touchUp(x: CGFloat(x), y: CGFloat(y))
                }
                delay = duration + 0.3
            }
        } else if line.contains("log(") || line.contains("print(") {
            let prefix = line.contains("log(") ? "log(" : "print("
            let params = parseParameters(line, prefix: prefix)
            if let msg = params.first {
                let cleanMsg = msg.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "'", with: "")
                self.sendLog(message: cleanMsg)
            }
        } else if line.contains("appRun(") {
            let params = parseParameters(line, prefix: "appRun(")
            if let bundleId = params.first {
                let cleanId = bundleId.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "'", with: "")
                self.sendLog(message: "Mở ứng dụng: \(cleanId)")
                if cleanId == "com.apple.mobilesafari" {
                    DispatchQueue.main.async {
                        UIApplication.shared.open(URL(string: "https://www.apple.com")!, options: [:], completionHandler: nil)
                    }
                }
                delay = 1.8
            }
        }
        
        // Execute next line after the calculated delay
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            self.executeLine(at: index + 1)
        }
    }
    
    @objc private func stopCurrentScript() {
        if isScriptRunning {
            isScriptRunning = false
            self.sendLog(message: "Kịch bản đã bị dừng lại.")
            self.sendDeviceStatus(status: "online")
            FloatingWindow.shared.setStatus(online: true, running: false)
        }
    }
    
    private func parseParameters(_ line: String, prefix: String) -> [String] {
        guard let startIdx = line.range(of: prefix)?.upperBound else { return [] }
        guard let endIdx = line.range(of: ")", options: .backwards)?.lowerBound else { return [] }
        
        let subStr = String(line[startIdx..<endIdx])
        return subStr.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    }
    
    // MARK: - Helper Local IP
    private func getWiFiAddress() -> String? {
        var address: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0 else { return nil }
        guard let firstAddr = ifaddr else { return nil }
        
        for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            var addr = ptr.pointee.ifa_addr.pointee
            
            if (flags & IFF_UP) == IFF_UP && (flags & IFF_LOOPBACK) == 0 {
                if addr.sa_family == UInt8(AF_INET) {
                    let name = String(cString: ptr.pointee.ifa_name)
                    if name == "en0" { // Wifi interface on iOS
                        var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                        if getnameinfo(&addr, socklen_t(addr.sa_len), &hostname, socklen_t(hostname.count), nil, socklen_t(0), NI_NUMERICHOST) == 0 {
                            address = String(cString: hostname)
                        }
                    }
                }
            }
        }
        freeifaddrs(ifaddr)
        return address
    }
    
    // MARK: - Background Processing Handlers
    
    @objc private func handleDidEnterBackground() {
        guard isConnected else { return }
        print("[WebSocketClient] App entered background. Requesting background time...")
        self.backgroundTaskId = UIApplication.shared.beginBackgroundTask(withName: "iControlKeepAlive") { [weak self] in
            guard let self = self else { return }
            print("[WebSocketClient] Background task expired.")
            UIApplication.shared.endBackgroundTask(self.backgroundTaskId)
            self.backgroundTaskId = .invalid
        }
    }
    
    @objc private func handleWillEnterForeground() {
        print("[WebSocketClient] App entered foreground.")
        if self.backgroundTaskId != .invalid {
            UIApplication.shared.endBackgroundTask(self.backgroundTaskId)
            self.backgroundTaskId = .invalid
        }
    }
}

// MARK: - URLSessionWebSocketDelegate
extension WebSocketClient: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("[WebSocketClient] Connection opened.")
        self.registerDevice()
    }
    
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        print("[WebSocketClient] Connection closed.")
        self.isConnected = false
        FloatingWindow.shared.setStatus(online: false)
        FloatingWindow.shared.addLog("Disconnected from server.")
    }
}
