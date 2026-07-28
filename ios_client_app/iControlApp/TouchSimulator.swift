import Foundation
import CoreGraphics
import UIKit
import Network

/// Simulated Touch library integrating PTFakeTouch and ZXTouch
class TouchSimulator {
    static let shared = TouchSimulator()
    
    private var ptFakeTouchLoaded = false
    private var zxConnection: NWConnection?
    
    private init() {
        loadPTFakeTouch()
        setupZXTouchConnection()
    }
    
    /// Try to load PTFakeTouch library dynamically from jailbroken iOS system path
    private func loadPTFakeTouch() {
        let paths = [
            "/usr/lib/libPTFakeTouch.dylib",
            "/Library/MobileSubstrate/DynamicLibraries/PTFakeTouch.dylib",
            "/Library/Frameworks/PTFakeTouch.framework/PTFakeTouch",
            "/var/jb/usr/lib/libPTFakeTouch.dylib", // Dopamine / Rootless jailbreak path
            "/var/jb/Library/Frameworks/PTFakeTouch.framework/PTFakeTouch",
            "/var/jb/Library/MobileSubstrate/DynamicLibraries/PTFakeTouch.dylib",
            "/var/jb/usr/lib/libAutoTouch.dylib",
            "/usr/lib/libAutoTouch.dylib"
        ]
        
        for path in paths {
            if dlopen(path, RTLD_NOW) != nil {
                print("[TouchSimulator] Loaded PTFakeTouch successfully from: \(path)")
                ptFakeTouchLoaded = true
                break
            }
        }
    }
    
    // MARK: - App Launching Helper
    
    /// Launch external iOS app (e.g. com.toyopagroup.picaboo for Snapchat) via LSApplicationWorkspace or URL scheme
    @discardableResult
    func openApp(_ bundleIdOrScheme: String) -> Bool {
        let cleanId = bundleIdOrScheme.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "'", with: "")
        
        // 1. Private iOS LSApplicationWorkspace API (Jailbroken & Sandboxed)
        if let workspaceClass = NSClassFromString("LSApplicationWorkspace") as? NSObject.Type {
            let selector = Selector(("defaultWorkspace"))
            if workspaceClass.responds(to: selector) {
                if let workspace = workspaceClass.perform(selector)?.takeUnretainedValue() {
                    let openSel = Selector(("openApplicationWithBundleID:"))
                    if workspace.responds(to: openSel) {
                        _ = workspace.perform(openSel, with: cleanId)
                        print("[TouchSimulator] Launched app via LSApplicationWorkspace: \(cleanId)")
                        return true
                    }
                }
            }
        }
        
        // 2. Open via URL scheme
        var urlStr = cleanId
        if !urlStr.contains("://") && !urlStr.contains(".") {
            urlStr = "\(cleanId)://"
        }
        if let url = URL(string: urlStr) {
            DispatchQueue.main.async {
                if UIApplication.shared.canOpenURL(url) {
                    UIApplication.shared.open(url, options: [:], completionHandler: nil)
                } else {
                    UIApplication.shared.open(url, options: [:], completionHandler: nil)
                }
            }
            return true
        }
        return false
    }
    
    // MARK: - ZXTouch TCP connection setup
    
    /// Establish stable TCP socket connection to zxtouchd daemon running on localhost:6000
    private func setupZXTouchConnection() {
        let host = NWEndpoint.Host("127.0.0.1")
        let port = NWEndpoint.Port(integerLiteral: 6000)
        
        let parameters = NWParameters.tcp
        zxConnection = NWConnection(host: host, port: port, using: parameters)
        
        zxConnection?.stateUpdateHandler = { state in
            switch state {
            case .ready:
                print("[TouchSimulator] ZXTouch daemon connected successfully.")
            case .failed(let error):
                print("[TouchSimulator] ZXTouch daemon connection failed: \(error)")
            default:
                break
            }
        }
        
        // Start connection
        zxConnection?.start(queue: .global())
    }
    
    /// Send raw TCP command to zxtouchd
    private func sendZXCommand(_ cmd: String) {
        let packet = cmd + "\n"
        guard let data = packet.data(using: .utf8) else { return }
        
        zxConnection?.send(content: data, completion: .contentProcessed({ error in
            if let error = error {
                print("[TouchSimulator] ZXTouch socket write error: \(error)")
            }
        }))
    }
    
    // MARK: - Dynamic PTFakeTouch Invoker
    
    /// Safely invokes Objective-C PTFakeTouch class methods dynamically
    private func invokePTFakeTouch(selectorName: String, point: CGPoint, fingerId: Int = 1) {
        guard let ptClass = NSClassFromString("PTFakeTouch") else { return }
        let selector = Selector((selectorName))
        
        if ptClass.responds(to: selector), let method = class_getClassMethod(ptClass, selector) {
            let imp = method_getImplementation(method)
            if selectorName.contains("pointId:") || selectorName.contains("id:") {
                typealias MultiTouchIMP = @convention(c) (AnyObject, Selector, CGPoint, Int) -> Int
                let function = unsafeBitCast(imp, to: MultiTouchIMP.self)
                _ = function(ptClass, selector, point, fingerId)
            } else {
                typealias SingleTouchIMP = @convention(c) (AnyObject, Selector, CGPoint) -> Int
                let function = unsafeBitCast(imp, to: SingleTouchIMP.self)
                _ = function(ptClass, selector, point)
            }
        }
        
        // Fallback: fakeTouchId:touchPoint:state: (0=Down, 1=Move, 2=Up)
        let altSel = Selector(("fakeTouchId:touchPoint:state:"))
        if ptClass.responds(to: altSel), let method = class_getClassMethod(ptClass, altSel) {
            let imp = method_getImplementation(method)
            typealias StateIMP = @convention(c) (AnyObject, Selector, Int, CGPoint, Int) -> Int
            let function = unsafeBitCast(imp, to: StateIMP.self)
            let state = selectorName.contains("Down") ? 0 : (selectorName.contains("Move") ? 1 : 2)
            _ = function(ptClass, altSel, fingerId, point, state)
        }
    }
    
    // MARK: - API Methods
    
    /// Tap at logical coordinates (Point)
    func tap(x: CGFloat, y: CGFloat) {
        let ix = Int(round(x))
        let iy = Int(round(y))
        print("[TouchSimulator] Tapping at (\(ix), \(iy))")
        postTouchNotification(x: CGFloat(ix), y: CGFloat(iy))
        
        // 1. Native System IOHIDEvent Digitizer Injection
        injectIOHIDTouch(point: CGPoint(x: ix, y: iy), touchDown: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            self.injectIOHIDTouch(point: CGPoint(x: ix, y: iy), touchDown: false)
        }

        // 2. PTFakeTouch Tweak Injection
        if ptFakeTouchLoaded {
            invokePTFakeTouch(selectorName: "touchDownAtPoint:", point: CGPoint(x: ix, y: iy))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                self.invokePTFakeTouch(selectorName: "touchUpAtPoint:", point: CGPoint(x: ix, y: iy))
            }
        }
        
        // 3. ZXTouch TCP command sequence (requires rounded integers)
        sendZXCommand("10;\(ix);\(iy);1") // Touch Down
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            self.sendZXCommand("12;\(ix);\(iy);1") // Touch Up
        }
        
        // 4. In-app UIKit action fallback
        DispatchQueue.main.async {
            self.performUIKitTap(at: CGPoint(x: ix, y: iy))
        }
    }
    
    /// Swipe from start point to end point with duration
    func swipe(fromX: CGFloat, fromY: CGFloat, toX: CGFloat, toY: CGFloat, duration: Double = 0.3) {
        let ix1 = Int(round(fromX))
        let iy1 = Int(round(fromY))
        let ix2 = Int(round(toX))
        let iy2 = Int(round(toY))
        print("[TouchSimulator] Swiping from (\(ix1), \(iy1)) to (\(ix2), \(iy2)) in \(duration)s")
        postTouchNotification(x: CGFloat(ix1), y: CGFloat(iy1))
        
        let steps = 15
        let stepDelay = duration / Double(steps)
        
        if ptFakeTouchLoaded {
            let from = CGPoint(x: ix1, y: iy1)
            let to = CGPoint(x: ix2, y: iy2)
            invokePTFakeTouch(selectorName: "touchDownAtPoint:", point: from)
            for i in 1...steps {
                let progress = CGFloat(i) / CGFloat(steps)
                let cx = Int(round(CGFloat(ix1) + CGFloat(ix2 - ix1) * progress))
                let cy = Int(round(CGFloat(iy1) + CGFloat(iy2 - iy1) * progress))
                DispatchQueue.main.asyncAfter(deadline: .now() + (Double(i) * stepDelay)) {
                    self.invokePTFakeTouch(selectorName: "touchMoveAtPoint:", point: CGPoint(x: cx, y: cy))
                    if i == steps {
                        self.invokePTFakeTouch(selectorName: "touchUpAtPoint:", point: to)
                    }
                }
            }
        }
        
        // ZXTouch TCP command sequence for swipe with integer parameters
        sendZXCommand("10;\(ix1);\(iy1);1")
        for i in 1...steps {
            let progress = CGFloat(i) / CGFloat(steps)
            let cx = Int(round(CGFloat(ix1) + CGFloat(ix2 - ix1) * progress))
            let cy = Int(round(CGFloat(iy1) + CGFloat(iy2 - iy1) * progress))
            DispatchQueue.main.asyncAfter(deadline: .now() + (Double(i) * stepDelay)) {
                self.sendZXCommand("11;\(cx);\(cy);1")
                if i == steps {
                    self.sendZXCommand("12;\(ix2);\(iy2);1")
                }
            }
        }
    }
    
    /// Touch Down raw event
    func touchDown(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        let ix = Int(round(x))
        let iy = Int(round(y))
        postTouchNotification(x: CGFloat(ix), y: CGFloat(iy))
        if ptFakeTouchLoaded {
            invokePTFakeTouch(selectorName: "touchDownAtPoint:pointId:", point: CGPoint(x: ix, y: iy), fingerId: fingerId)
        }
        sendZXCommand("10;\(ix);\(iy);\(fingerId)")
    }
    
    /// Touch Move raw event
    func touchMove(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        let ix = Int(round(x))
        let iy = Int(round(y))
        if ptFakeTouchLoaded {
            invokePTFakeTouch(selectorName: "touchMoveAtPoint:pointId:", point: CGPoint(x: ix, y: iy), fingerId: fingerId)
        }
        sendZXCommand("11;\(ix);\(iy);\(fingerId)")
    }
    
    /// Touch Up raw event
    func touchUp(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        let ix = Int(round(x))
        let iy = Int(round(y))
        if ptFakeTouchLoaded {
            invokePTFakeTouch(selectorName: "touchUpAtPoint:pointId:", point: CGPoint(x: ix, y: iy), fingerId: fingerId)
        }
        sendZXCommand("12;\(ix);\(iy);\(fingerId)")
    }
    
    /// Send visual notification to draw glowing touch indicators on HUD
    private func postTouchNotification(x: CGFloat, y: CGFloat) {
        NotificationCenter.default.post(
            name: NSNotification.Name("ShowTouchIndicatorNotification"),
            object: nil,
            userInfo: ["x": x, "y": y]
        )
    }

    private func performUIKitTap(at point: CGPoint) {
        guard let window = UIApplication.shared.keyWindowCompat else { return }
        guard let hitView = window.hitTest(point, with: nil) else { return }
        
        var curr: UIView? = hitView
        while let view = curr {
            if let control = view as? UIControl {
                control.sendActions(for: .touchDown)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) {
                    control.sendActions(for: .touchUpInside)
                }
                return
            }
            if let recognizers = view.gestureRecognizers {
                for recognizer in recognizers {
                    if recognizer.isEnabled {
                        let sel = Selector(("handleTap:"))
                        if recognizer.responds(to: sel) {
                            recognizer.perform(sel, with: recognizer)
                        }
                    }
                }
            }
            curr = view.superview
        }
    }
}
