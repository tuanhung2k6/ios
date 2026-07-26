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
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            self?.registerDevice()
        }
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
                    NotificationCenter.default.post(name: Notification.Name.wsDisconnected, object: nil)
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
                        let loopCount = json["loopCount"] as? Int ?? 1
                        let loopDelay = json["loopDelay"] as? Double ?? 0.0
                        DispatchQueue.main.async { self.runScript(content: script, name: name, loopCount: loopCount, loopDelay: loopDelay) }
                    }
                } else if type == "stop_script" {
                    DispatchQueue.main.async { self.stopCurrentScript() }
                } else if type == "request_screenshot" {
                    DispatchQueue.main.async { self.captureAndSendScreenshot() }
                } else if type == "direct_tap" {
                    if let x = json["x"] as? Double, let y = json["y"] as? Double {
                        DispatchQueue.main.async {
                            TouchSimulator.shared.tap(x: CGFloat(x), y: CGFloat(y))
                            self.sendLog(message: "Direct Tap: (\(Int(x)), \(Int(y)))")
                        }
                    }
                } else if type == "direct_swipe" {
                    if let x1 = json["x1"] as? Double, let y1 = json["y1"] as? Double,
                       let x2 = json["x2"] as? Double, let y2 = json["y2"] as? Double {
                        let duration = json["duration"] as? Double ?? 0.3
                        DispatchQueue.main.async {
                            TouchSimulator.shared.swipe(fromX: CGFloat(x1), fromY: CGFloat(y1), toX: CGFloat(x2), toY: CGFloat(y2), duration: duration)
                            self.sendLog(message: "Direct Swipe: (\(Int(x1)), \(Int(y1))) ➔ (\(Int(x2)), \(Int(y2)))")
                        }
                    }
                } else if type == "direct_touch_down" {
                    if let x = json["x"] as? Double, let y = json["y"] as? Double {
                        DispatchQueue.main.async { TouchSimulator.shared.touchDown(x: CGFloat(x), y: CGFloat(y)) }
                    }
                } else if type == "direct_touch_up" {
                    if let x = json["x"] as? Double, let y = json["y"] as? Double {
                        DispatchQueue.main.async { TouchSimulator.shared.touchUp(x: CGFloat(x), y: CGFloat(y)) }
                    }
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
        // Notify ViewController
        NotificationCenter.default.post(name: Notification.Name.wsConnected, object: nil)
        FloatingWindow.shared.addLog("✅ Connected as \(name) [iOS \(iosVersion)] · \(ipAddress)")
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
        FloatingWindow.shared.addLog(message)
        // Notify ViewController log card
        NotificationCenter.default.post(name: Notification.Name.wsLog, object: nil, userInfo: ["message": message])
    }
    
    func sendBatteryLevel(_ level: Int) {
        let payload: [String: Any] = [
            "type": "status_report",
            "status": "online",
            "battery": level
        ]
        sendJSON(payload)
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
                LocalServer.shared.broadcastToWebClients(text: jsonString)
            }
        } catch {
            print("[WebSocketClient] Encoding JSON failed: \(error)")
        }
    }
    
    // MARK: - Lua Script Runner Engine
    
    // Loop control state
    private var loopCount: Int = 1       // total loops (0 = infinite)
    private var loopDelay: Double = 0.0  // seconds between loops
    private var currentLoop: Int = 0
    private var scriptContent: String = ""
    private var scriptNameCache: String = ""
    
    func runScript(content: String, name: String, loopCount: Int = 1, loopDelay: Double = 0.0) {
        print("[WebSocketClient] Running script: \(name) (loops=\(loopCount), delay=\(loopDelay)s)")
        self.scriptContent = content
        self.scriptNameCache = name
        self.loopCount = loopCount
        self.loopDelay = loopDelay
        self.currentLoop = 0
        
        self.sendLog(message: "Bắt đầu chạy script: \(name)\(loopCount > 1 ? " (\(loopCount) lần lặp)" : "")")
        self.sendDeviceStatus(status: "running")
        FloatingWindow.shared.setStatus(online: true, running: true)
        
        scriptRunnerTimer?.invalidate()
        runNextLoop()
    }
    
    private func runNextLoop() {
        guard isScriptRunning == false || currentLoop == 0 else { return }
        let infinite = loopCount == 0
        if !infinite && currentLoop >= loopCount {
            self.sendLog(message: "Hoàn tất \(currentLoop) vòng lặp.")
            self.sendDeviceStatus(status: "online")
            FloatingWindow.shared.setStatus(online: true, running: false)
            self.isScriptRunning = false
            return
        }
        currentLoop += 1
        if loopCount > 1 { self.sendLog(message: "Vòng \(currentLoop)\(infinite ? "" : "/\(loopCount)")...") }
        self.scriptLines = scriptContent.components(separatedBy: .newlines)
        self.isScriptRunning = true
        executeLine(at: 0)
    }
    
    private func executeLine(at index: Int) {
        guard isScriptRunning else { return }
        
        if index >= scriptLines.count {
            // Script finished one loop
            let infinite = loopCount == 0
            let moreLoops = infinite || currentLoop < loopCount
            if moreLoops && isScriptRunning {
                isScriptRunning = false
                if loopDelay > 0 {
                    self.sendLog(message: "Chờ \(loopDelay)s trước vòng tiếp...")
                    DispatchQueue.main.asyncAfter(deadline: .now() + loopDelay) { [weak self] in
                        self?.runNextLoop()
                    }
                } else {
                    runNextLoop()
                }
            } else {
                self.sendLog(message: "Kịch bản thực thi hoàn tất.")
                self.sendDeviceStatus(status: "online")
                FloatingWindow.shared.setStatus(online: true, running: false)
                self.isScriptRunning = false
            }
            return
        }
        
        var line = scriptLines[index].trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Strip trailing inline comments if present
        if let commentRange = line.range(of: "--") {
            line = String(line[..<commentRange.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        
        // Skip empty lines or pure comment lines
        if line.isEmpty || line.hasPrefix("local ") && !line.contains("(") {
            self.executeLine(at: index + 1)
            return
        }
        
        var delay: Double = 0.05 // Swift micro delay default
        
        if line.contains("mSleep(") {
            let params = parseParamsFromLine(line, funcName: "mSleep")
            if let val = params.first, let sleepMs = Double(val) {
                delay = sleepMs / 1000.0
                self.sendLog(message: "Chờ \(Int(sleepMs))ms")
            }
        } else if line.contains("sleep(") || line.contains("delay(") {
            let funcName = line.contains("sleep") ? "sleep" : "delay"
            let params = parseParamsFromLine(line, funcName: funcName)
            if let val = params.first, let sleepTime = Double(val) {
                // If delay() is given in ms (> 50), treat as ms, otherwise sec
                delay = (funcName == "delay" && sleepTime > 50) ? (sleepTime / 1000.0) : sleepTime
                self.sendLog(message: "Chờ \(delay) giây")
            }
        } else if line.contains("tap(") || line.contains("click(") || line.contains("touch(") {
            let funcName = line.contains("tap(") ? "tap" : (line.contains("click(") ? "click" : "touch")
            let coords = parseParamsFromLine(line, funcName: funcName)
            if coords.count >= 2, let x = Double(coords[0]), let y = Double(coords[1]) {
                self.sendLog(message: "Tap: (\(Int(x)), \(Int(y)))")
                TouchSimulator.shared.tap(x: CGFloat(x), y: CGFloat(y))
                delay = 0.2
            }
        } else if line.contains("swipe(") || line.contains("drag(") {
            let funcName = line.contains("swipe") ? "swipe" : "drag"
            let params = parseParamsFromLine(line, funcName: funcName)
            if params.count >= 4,
               let x1 = Double(params[0]), let y1 = Double(params[1]),
               let x2 = Double(params[2]), let y2 = Double(params[3]) {
                let duration = params.count >= 5 ? (Double(params[4]) ?? 0.3) : 0.3
                self.sendLog(message: "Vuốt: (\(Int(x1)), \(Int(y1))) ➔ (\(Int(x2)), \(Int(y2)))")
                TouchSimulator.shared.swipe(fromX: CGFloat(x1), fromY: CGFloat(y1), toX: CGFloat(x2), toY: CGFloat(y2), duration: duration)
                delay = duration + 0.2
            }
        } else if line.contains("longPress(") || line.contains("press(") {
            let funcName = line.contains("longPress") ? "longPress" : "press"
            let params = parseParamsFromLine(line, funcName: funcName)
            if params.count >= 2, let x = Double(params[0]), let y = Double(params[1]) {
                let duration = params.count >= 3 ? (Double(params[2]) ?? 1.0) : 1.0
                self.sendLog(message: "Nhấn giữ tại (\(Int(x)), \(Int(y))) trong \(duration)s")
                TouchSimulator.shared.touchDown(x: CGFloat(x), y: CGFloat(y))
                DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
                    TouchSimulator.shared.touchUp(x: CGFloat(x), y: CGFloat(y))
                }
                delay = duration + 0.2
            }
        } else if line.contains("touchDown(") {
            let params = parseParamsFromLine(line, funcName: "touchDown")
            if params.count >= 2, let x = Double(params[0]), let y = Double(params[1]) {
                let fingerId = params.count >= 3 ? (Int(params[2]) ?? 1) : 1
                TouchSimulator.shared.touchDown(x: CGFloat(x), y: CGFloat(y), fingerId: fingerId)
                delay = 0.05
            }
        } else if line.contains("touchMove(") {
            let params = parseParamsFromLine(line, funcName: "touchMove")
            if params.count >= 2, let x = Double(params[0]), let y = Double(params[1]) {
                let fingerId = params.count >= 3 ? (Int(params[2]) ?? 1) : 1
                TouchSimulator.shared.touchMove(x: CGFloat(x), y: CGFloat(y), fingerId: fingerId)
                delay = 0.05
            }
        } else if line.contains("touchUp(") {
            let params = parseParamsFromLine(line, funcName: "touchUp")
            if params.count >= 2, let x = Double(params[0]), let y = Double(params[1]) {
                let fingerId = params.count >= 3 ? (Int(params[2]) ?? 1) : 1
                TouchSimulator.shared.touchUp(x: CGFloat(x), y: CGFloat(y), fingerId: fingerId)
                delay = 0.05
            }
        } else if line.contains("log(") || line.contains("print(") || line.contains("sys.log(") {
            let funcName = line.contains("sys.log") ? "sys.log" : (line.contains("log") ? "log" : "print")
            let params = parseParamsFromLine(line, funcName: funcName)
            if let msg = params.first {
                let cleanMsg = msg.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "'", with: "")
                self.sendLog(message: cleanMsg)
            }
        } else if line.contains("appRun(") || line.contains("openApp(") {
            let funcName = line.contains("appRun") ? "appRun" : "openApp"
            let params = parseParamsFromLine(line, funcName: funcName)
            if let bundleId = params.first {
                let cleanId = bundleId.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "'", with: "")
                self.sendLog(message: "Mở ứng dụng: \(cleanId)")
                if cleanId == "com.apple.mobilesafari" {
                    DispatchQueue.main.async {
                        UIApplication.shared.open(URL(string: "https://www.apple.com")!, options: [:], completionHandler: nil)
                    }
                }
                delay = 1.5
            }
        }
        
        // Execute next line after the calculated delay
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0.02, delay)) {
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
    
    private func parseParamsFromLine(_ line: String, funcName: String) -> [String] {
        guard let openParen = line.range(of: "\(funcName)(")?.upperBound else { return [] }
        let rest = String(line[openParen...])
        guard let closeParen = rest.range(of: ")")?.lowerBound else { return [] }
        let inner = String(rest[..<closeParen])
        return inner.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    }
    
    // MARK: - Helper Local IP
    func getWiFiAddress() -> String? {
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
