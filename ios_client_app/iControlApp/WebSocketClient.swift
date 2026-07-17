import Foundation
import UIKit

/// WebSocket connection manager connecting iOS client back to the Web Dashboard Server
class WebSocketClient: NSObject {
    static let shared = WebSocketClient()
    
    private var webSocket: URLSessionWebSocketTask?
    private var serverIP: String = "localhost"
    private var serverPort: String = "3000"
    private var isConnected = false
    private var mockUdid = ""
    
    private var scriptRunnerTimer: Timer?
    
    private override init() {
        super.init()
        setupMockUdid()
        
        // Listen for terminate signal from HUD button
        NotificationCenter.default.addObserver(self, selector: #selector(stopCurrentScript), name: Notification.Name("TerminateScriptNotification"), object: nil)
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
    
    func connect(ip: String, port: String = "3000") {
        self.serverIP = ip
        self.serverPort = port
        
        guard let url = URL(string: "ws://\(ip):\(port)") else {
            print("[WebSocketClient] Invalid URL format.")
            return }
        
        print("[WebSocketClient] Connecting to \(url.absoluteString)...")
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: OperationQueue())
        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()
        
        listenForMessages()
    }
    
    func disconnect() {
        webSocket?.cancel(with: .goingAway, reason: nil)
        isConnected = false
        FloatingWindow.shared.setStatus(online: false)
    }
    
    private func listenForMessages() {
        webSocket?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let error):
                print("[WebSocketClient] Error receiving: \(error.localizedDescription)")
                self.isConnected = false
                FloatingWindow.shared.setStatus(online: false)
                FloatingWindow.shared.addLog("Disconnected from server.")
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
                if self.isConnected {
                    self.listenForMessages()
                }
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
                        self.runScript(content: script, name: name)
                    }
                } else if type == "stop_script" {
                    self.stopCurrentScript()
                }
            }
        } catch {
            print("[WebSocketClient] Failed to decode JSON: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Device Info & Registration
    
    func registerDevice() {
        let name = UIDevice.current.name
        let model = UIDevice.current.model
        let ipAddress = getWiFiAddress() ?? "Unknown IP"
        
        let registerPayload: [String: Any] = [
            "type": "register_device",
            "info": [
                "udid": mockUdid,
                "name": name,
                "model": model,
                "ip": ipAddress
            ]
        ]
        
        sendJSON(registerPayload)
        
        isConnected = true
        FloatingWindow.shared.setStatus(online: true)
        FloatingWindow.shared.addLog("Connected to server. Registered as: \(name)")
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
        
        let lines = content.components(separatedBy: .newlines)
        var lineIndex = 0
        
        // Mock execution step-by-step using a timer
        scriptRunnerTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }
            
            if lineIndex >= lines.count {
                self.sendLog(message: "Kịch bản thực thi hoàn tất.")
                self.sendDeviceStatus(status: "online")
                FloatingWindow.shared.setStatus(online: true, running: false)
                timer.invalidate()
                return
            }
            
            let line = lines[lineIndex].trimmingCharacters(in: .whitespacesAndNewlines)
            lineIndex += 1
            
            // Skip empty lines and comments
            if line.isEmpty || line.hasPrefix("--") {
                return
            }
            
            self.executeLuaLine(line)
        }
    }
    
    @objc private func stopCurrentScript() {
        if scriptRunnerTimer != nil {
            scriptRunnerTimer?.invalidate()
            scriptRunnerTimer = nil
            self.sendLog(message: "Kịch bản đã bị dừng lại.")
            self.sendDeviceStatus(status: "online")
            FloatingWindow.shared.setStatus(online: true, running: false)
        }
    }
    
    private func executeLuaLine(_ line: String) {
        // Simple regex-based execution for basic Lua commands
        if line.contains("tap(") {
            let coords = parseParameters(line, prefix: "tap(")
            if coords.count >= 2, let x = Double(coords[0]), let y = Double(coords[1]) {
                self.sendLog(message: "Click: \(x), \(y)")
                TouchSimulator.shared.tap(x: CGFloat(x), y: CGFloat(y))
            }
        } else if line.contains("swipe(") {
            let params = parseParameters(line, prefix: "swipe(")
            if params.count >= 4,
               let x1 = Double(params[0]), let y1 = Double(params[1]),
               let x2 = Double(params[2]), let y2 = Double(params[3]) {
                let duration = params.count >= 5 ? (Double(params[4]) ?? 0.3) : 0.3
                self.sendLog(message: "Vuốt từ (\(x1), \(y1)) tới (\(x2), \(y2))")
                TouchSimulator.shared.swipe(fromX: CGFloat(x1), fromY: CGFloat(y1), toX: CGFloat(x2), toY: CGFloat(y2), duration: duration)
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
                // Sideloaded app cannot run arbitrary apps without jailbreak API,
                // but we simulate opening Safari or URL
                if cleanId == "com.apple.mobilesafari" {
                    DispatchQueue.main.async {
                        UIApplication.shared.open(URL(string: "https://www.apple.com")!, options: [:], completionHandler: nil)
                    }
                }
            }
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
}

// MARK: - URLSessionWebSocketDelegate
extension WebSocketClient: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("[WebSocketClient] Connection opened.")
        self.registerDevice()
    }
    
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketCloseCode, reason: Data?) {
        print("[WebSocketClient] Connection closed.")
        self.isConnected = false
        FloatingWindow.shared.setStatus(online: false)
        FloatingWindow.shared.addLog("Disconnected from server.")
    }
}
