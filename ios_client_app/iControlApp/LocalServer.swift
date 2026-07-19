import Foundation
import Network
import CommonCrypto
import UIKit

/// Embedded lightweight HTTP + WebSocket Server (v5.3) running locally on port 9898 of the iOS device.
/// Allows the Web Dashboard to be hosted directly on the iPhone.
class LocalServer {
    static let shared = LocalServer()
    
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.icontrol.localservers queue")
    private var activeConnections: [LocalConnection] = []
    
    private init() {}
    
    func start(port: UInt16 = 9898) {
        do {
            let parameters = NWParameters.tcp
            self.listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
            
            self.listener?.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    print("[LocalServer] Ready and listening on port \(port)")
                case .failed(let error):
                    print("[LocalServer] Failed to start: \(error.localizedDescription)")
                default:
                    break
                }
            }
            
            self.listener?.newConnectionHandler = { [weak self] nwConnection in
                guard let self = self else { return }
                let connection = LocalConnection(connection: nwConnection)
                self.queue.async {
                    self.activeConnections.append(connection)
                    connection.start()
                }
            }
            
            self.listener?.start(queue: queue)
        } catch {
            print("[LocalServer] Initialization error: \(error.localizedDescription)")
        }
    }
    
    func broadcastToWebClients(text: String) {
        queue.async {
            for conn in self.activeConnections {
                if conn.isWebSocket {
                    conn.sendWebSocketText(text)
                }
            }
        }
    }
    
    func removeConnection(_ connection: LocalConnection) {
        queue.async {
            self.activeConnections.removeAll { $0 === connection }
        }
    }
}

/// Represents an active connection to the Local Server
class LocalConnection {
    let connection: NWConnection
    private let queue = DispatchQueue(label: "com.icontrol.localconn queue")
    var isWebSocket = false
    
    init(connection: NWConnection) {
        self.connection = connection
    }
    
    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                self.receiveLoop()
            case .failed(let error):
                print("[LocalConnection] Connection failed: \(error)")
                self.close()
            case .cancelled:
                self.close()
            default:
                break
            }
        }
        connection.start(queue: queue)
    }
    
    private func receiveLoop() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, context, isComplete, error in
            guard let self = self else { return }
            if let error = error {
                print("[LocalConnection] Error receiving: \(error)")
                self.close()
                return
            }
            
            if let data = data, !data.isEmpty {
                if self.isWebSocket {
                    self.handleWebSocketData(data)
                } else {
                    self.handleHttpData(data)
                }
            }
            
            if isComplete {
                self.close()
            } else if error == nil {
                self.receiveLoop()
            }
        }
    }
    
    // MARK: - HTTP Request Handling
    
    private func handleHttpData(_ data: Data) {
        guard let requestStr = String(data: data, encoding: .utf8) else { return }
        let lines = requestStr.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return }
        
        let parts = requestLine.components(separatedBy: " ")
        guard parts.count >= 2 else { return }
        let method = parts[0]
        let fullPath = parts[1]
        
        // Parse simple query parameters
        let pathParts = fullPath.components(separatedBy: "?")
        let path = pathParts[0]
        
        // WebSocket Handshake Detection
        if requestStr.contains("Upgrade: websocket") {
            handleWebSocketHandshake(requestStr: requestStr)
            return
        }
        
        // Handle static assets & APIs
        if method == "GET" {
            switch path {
            case "/", "/index.html":
                sendStaticResponse(data: WebAssets.indexHtmlData, contentType: "text/html; charset=utf-8")
            case "/style.css":
                sendStaticResponse(data: WebAssets.styleCssData, contentType: "text/css")
            case "/app.js":
                sendStaticResponse(data: WebAssets.appJsData, contentType: "application/javascript")
            case "/vnc_helper.html":
                sendStaticResponse(data: WebAssets.vncHelperData, contentType: "text/html; charset=utf-8")
                
            case "/api/server-info":
                let ip = WebSocketClient.shared.getWiFiAddress() ?? "127.0.0.1"
                let json = "{\"success\":true,\"ip\":\"\(ip)\",\"port\":9898,\"deviceCount\":1}"
                sendJsonResponse(json)
                
            case "/api/devices":
                let ip = WebSocketClient.shared.getWiFiAddress() ?? "127.0.0.1"
                let name = UIDevice.current.name
                let model = UIDevice.current.model
                let version = UIDevice.current.systemVersion
                let battery = Int(UIDevice.current.batteryLevel * 100)
                let udid = UserDefaults.standard.string(forKey: "iControl_device_udid") ?? "local_device"
                
                let json = """
                {"success":true,"devices":[
                    {"udid":"\(udid)","name":"\(name) (Local)","model":"\(model)","ip":"\(ip)","ios_version":"\(version)","battery":\(battery >= 0 ? battery : 100),"vnc_port":5900}
                ]}
                """
                sendJsonResponse(json)
                
            case "/api/scripts":
                // List files from Documents
                let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                if let files = try? FileManager.default.contentsOfDirectory(at: docs, includingPropertiesForKeys: nil) {
                    let luaFiles = files.filter { $0.pathExtension == "lua" }
                    let scriptsJson = luaFiles.map { file -> String in
                        let content = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
                        let safeContent = content.replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n")
                        return "{\"name\":\"\(file.lastPathComponent)\",\"folder\":\"\",\"size\":\( (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0),\"content\":\"\(safeContent)\"}"
                    }.joined(separator: ",")
                    
                    let json = "{\"success\":true,\"scripts\":[\(scriptsJson)],\"folders\":[]}"
                    sendJsonResponse(json)
                } else {
                    sendJsonResponse("{\"success\":true,\"scripts\":[],\"folders\":[]}")
                }
                
            case "/api/security/status":
                sendJsonResponse("{\"success\":true,\"passcodeEnabled\":false}")
                
            default:
                sendNotFound()
            }
        } else if method == "POST" {
            // Handle script saving
            if path == "/api/scripts/save" {
                // Parse POST Body (simple json extract)
                if let bodyRange = requestStr.range(of: "\r\n\r\n") {
                    let body = String(requestStr[bodyRange.upperBound...])
                    saveScriptFromJson(body: body)
                }
            } else {
                sendNotFound()
            }
        } else {
            sendNotFound()
        }
    }
    
    private func saveScriptFromJson(body: String) {
        // Simple regex-less JSON parse for name and content
        // E.g. {"name":"test.lua","content":"..."}
        guard let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
              let name = json["name"] as? String,
              let content = json["content"] as? String else {
            sendJsonResponse("{\"success\":false,\"error\":\"Invalid save body\"}")
            return
        }
        
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let fileURL = docs.appendingPathComponent(name)
        do {
            try content.write(to: fileURL, atomically: true, encoding: .utf8)
            sendJsonResponse("{\"success\":true,\"name\":\"\(name)\"}")
            
            // Notify UI
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: NSNotification.Name("RefreshScriptsNotification"), object: nil)
            }
        } catch {
            sendJsonResponse("{\"success\":false,\"error\":\"\(error.localizedDescription)\"}")
        }
    }
    
    private func sendStaticResponse(data: Data, contentType: String) {
        let header = "HTTP/1.1 200 OK\r\nContent-Type: \(contentType)\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n"
        var res = header.data(using: .utf8) ?? Data()
        res.append(data)
        connection.send(content: res, contentContext: .defaultMessage, isComplete: true, completion: .contentProcessed({ _ in }))
    }
    
    private func sendJsonResponse(_ json: String) {
        let data = json.data(using: .utf8) ?? Data()
        let header = "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: \(data.count)\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
        var res = header.data(using: .utf8) ?? Data()
        res.append(data)
        connection.send(content: res, contentContext: .defaultMessage, isComplete: true, completion: .contentProcessed({ _ in }))
    }
    
    private func sendNotFound() {
        let body = "404 Not Found"
        let header = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        let res = (header + body).data(using: .utf8) ?? Data()
        connection.send(content: res, contentContext: .defaultMessage, isComplete: true, completion: .contentProcessed({ _ in }))
    }
    
    // MARK: - WebSocket Handshake
    
    private func handleWebSocketHandshake(requestStr: String) {
        // Extract Sec-WebSocket-Key
        var secKey = ""
        let lines = requestStr.components(separatedBy: "\r\n")
        for line in lines {
            if line.hasPrefix("Sec-WebSocket-Key:") {
                secKey = line.replacingOccurrences(of: "Sec-WebSocket-Key:", with: "").trimmingCharacters(in: .whitespaces)
            }
        }
        
        guard !secKey.isEmpty else {
            sendNotFound()
            return
        }
        
        // Calculate Sec-WebSocket-Accept
        let guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        let combined = secKey + guid
        
        // SHA-1
        guard let data = combined.data(using: .utf8) else { return }
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA1($0.baseAddress, CC_LONG(data.count), &digest)
        }
        let acceptHash = Data(digest).base64EncodedString()
        
        let response = "HTTP/1.1 101 Switching Protocols\r\n" +
                       "Upgrade: websocket\r\n" +
                       "Connection: Upgrade\r\n" +
                       "Sec-WebSocket-Accept: \(acceptHash)\r\n\r\n"
                       
        let resData = response.data(using: .utf8) ?? Data()
        connection.send(content: resData, completion: .contentProcessed({ [weak self] error in
            if error == nil {
                self?.isWebSocket = true
                print("[LocalConnection] WebSocket Upgrade Successful!")
                
                // Immediately send init message to mimic standard server
                self?.sendInitData()
            }
        }))
    }
    
    private func sendInitData() {
        let ip = WebSocketClient.shared.getWiFiAddress() ?? "127.0.0.1"
        let name = UIDevice.current.name
        let model = UIDevice.current.model
        let version = UIDevice.current.systemVersion
        let battery = Int(UIDevice.current.batteryLevel * 100)
        let udid = UserDefaults.standard.string(forKey: "iControl_device_udid") ?? "local_device"
        
        let initMsg = """
        {"type":"init","devices":[
            {"udid":"\(udid)","name":"\(name) (Local)","model":"\(model)","ip":"\(ip)","ios_version":"\(version)","battery":\(battery >= 0 ? battery : 100),"vnc_port":5900}
        ],"serverInfo":{"ip":"\(ip)","port":9898}}
        """
        sendWebSocketText(initMsg)
    }
    
    // MARK: - WebSocket Frames Parsing
    
    private func handleWebSocketData(_ data: Data) {
        guard data.count >= 2 else { return }
        
        let firstByte = data[0]
        let secondByte = data[1]
        
        let opcode = firstByte & 0x0F
        let isMasked = (secondByte & 0x80) != 0
        var payloadLen = Int(secondByte & 0x7F)
        
        var offset = 2
        if payloadLen == 126 {
            guard data.count >= 4 else { return }
            payloadLen = Int(data[2]) << 8 | Int(data[3])
            offset = 4
        } else if payloadLen == 127 {
            // Very large frame, skip for simple controls
            return
        }
        
        var maskingKey = [UInt8](repeating: 0, count: 4)
        if isMasked {
            guard data.count >= offset + 4 else { return }
            maskingKey[0] = data[offset]
            maskingKey[1] = data[offset+1]
            maskingKey[2] = data[offset+2]
            maskingKey[3] = data[offset+3]
            offset += 4
        }
        
        guard data.count >= offset + payloadLen else { return }
        var payload = data.subdata(in: offset..<(offset + payloadLen))
        
        if isMasked {
            // Unmask payload bytes
            for i in 0..<payload.count {
                payload[i] ^= maskingKey[i % 4]
            }
        }
        
        if opcode == 0x01 { // Text frame
            if let text = String(data: payload, encoding: .utf8) {
                handleIncomingWebSocketText(text)
            }
        } else if opcode == 0x08 { // Connection close
            close()
        }
    }
    
    private func handleIncomingWebSocketText(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else { return }
        
        let action = json["action"] as? String
        
        if action == "run_script" {
            if let script = json["script"] as? String, let scriptName = json["scriptName"] as? String {
                DispatchQueue.main.async {
                    WebSocketClient.shared.runScript(content: script, name: scriptName)
                }
            }
        } else if action == "stop_script" {
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Notification.Name("TerminateScriptNotification"), object: nil)
            }
        } else if action == "request_screenshot" {
            DispatchQueue.main.async {
                WebSocketClient.shared.captureAndSendScreenshot()
            }
        }
    }
    
    func sendWebSocketText(_ text: String) {
        guard isWebSocket else { return }
        let textData = text.data(using: .utf8) ?? Data()
        var frame = Data()
        frame.append(0x81) // FIN + Text
        
        let len = textData.count
        if len <= 125 {
            frame.append(UInt8(len))
        } else if len <= 65535 {
            frame.append(126)
            frame.append(UInt8((len >> 8) & 0xFF))
            frame.append(UInt8(len & 0xFF))
        } else {
            // Too large to handle simply, skip
            return
        }
        
        frame.append(textData)
        connection.send(content: frame, completion: .contentProcessed({ _ in }))
    }
    
    func close() {
        connection.cancel()
        LocalServer.shared.removeConnection(self)
    }
}
