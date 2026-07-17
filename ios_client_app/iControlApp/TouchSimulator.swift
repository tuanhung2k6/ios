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
            "/var/jb/usr/lib/libPTFakeTouch.dylib" // Rootless jailbreak path
        ]
        
        for path in paths {
            if dlopen(path, RTLD_NOW) != nil {
                print("[TouchSimulator] Loaded PTFakeTouch successfully from: \(path)")
                ptFakeTouchLoaded = true
                break
            }
        }
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
    
    /// Safely invokes Objective-C PTFakeTouch class methods dynamically by casting 
    /// the runtime IMP pointer to native Swift @convention(c) signatures.
    /// This prevents crashes when passing structs (CGPoint) and primitives (Int) through perform Selector.
    private func invokePTFakeTouch(selectorName: String, point: CGPoint, fingerId: Int = 1) {
        guard let ptClass = NSClassFromString("PTFakeTouch") else { return }
        let selector = Selector((selectorName))
        
        guard ptClass.responds(to: selector) else {
            print("[TouchSimulator] PTFakeTouch class does not respond to selector: \(selectorName)")
            return
        }
        
        guard let method = class_getClassMethod(ptClass, selector) else { return }
        let imp = method_getImplementation(method)
        
        if selectorName.contains("pointId:") || selectorName.contains("id:") {
            // Multi-touch: takes receiver (AnyObject), selector (Selector), CGPoint, and Int
            typealias MultiTouchIMP = @convention(c) (AnyObject, Selector, CGPoint, Int) -> Int
            let function = unsafeBitCast(imp, to: MultiTouchIMP.self)
            _ = function(ptClass, selector, point, fingerId)
        } else {
            // Single-touch: takes receiver (AnyObject), selector (Selector), CGPoint
            typealias SingleTouchIMP = @convention(c) (AnyObject, Selector, CGPoint) -> Int
            let function = unsafeBitCast(imp, to: SingleTouchIMP.self)
            _ = function(ptClass, selector, point)
        }
    }
    
    // MARK: - API Methods
    
    /// Tap at logical coordinates (Point)
    func tap(x: CGFloat, y: CGFloat) {
        print("[TouchSimulator] Tapping at (\(x), \(y))")
        postTouchNotification(x: x, y: y)
        
        if ptFakeTouchLoaded {
            invokePTFakeTouch(selectorName: "touchDownAtPoint:", point: CGPoint(x: x, y: y))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.invokePTFakeTouch(selectorName: "touchUpAtPoint:", point: CGPoint(x: x, y: y))
            }
        } else {
            // ZXTouch TCP command sequence
            sendZXCommand("10;\(x);\(y);1") // Down
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.sendZXCommand("12;\(x);\(y);1") // Up
            }
        }
    }
    
    /// Swipe from start point to end point with duration
    func swipe(fromX: CGFloat, fromY: CGFloat, toX: CGFloat, toY: CGFloat, duration: Double = 0.3) {
        print("[TouchSimulator] Swiping from (\(fromX), \(fromY)) to (\(toX), \(toY)) in \(duration)s")
        postTouchNotification(x: fromX, y: fromY)
        
        if ptFakeTouchLoaded {
            let steps = 20
            let stepDelay = duration / Double(steps)
            let from = CGPoint(x: fromX, y: fromY)
            let to = CGPoint(x: toX, y: toY)
            
            invokePTFakeTouch(selectorName: "touchDownAtPoint:", point: from)
            
            for i in 1...steps {
                let progress = CGFloat(i) / CGFloat(steps)
                let currentPoint = CGPoint(
                    x: from.x + (to.x - from.x) * progress,
                    y: from.y + (to.y - from.y) * progress
                )
                
                DispatchQueue.main.asyncAfter(deadline: .now() + (Double(i) * stepDelay)) {
                    self.invokePTFakeTouch(selectorName: "touchMoveAtPoint:", point: currentPoint)
                    if i == steps {
                        self.invokePTFakeTouch(selectorName: "touchUpAtPoint:", point: to)
                    }
                }
            }
        } else {
            // ZXTouch TCP command sequence for swipe
            let steps = 15
            let stepDelay = duration / Double(steps)
            
            sendZXCommand("10;\(fromX);\(fromY);1")
            
            for i in 1...steps {
                let progress = CGFloat(i) / CGFloat(steps)
                let cx = fromX + (toX - fromX) * progress
                let cy = fromY + (toY - fromY) * progress
                
                DispatchQueue.main.asyncAfter(deadline: .now() + (Double(i) * stepDelay)) {
                    self.sendZXCommand("11;\(cx);\(cy);1")
                    if i == steps {
                        self.sendZXCommand("12;\(toX);\(toY);1")
                    }
                }
            }
        }
    }
    
    /// Touch Down raw event
    func touchDown(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        postTouchNotification(x: x, y: y)
        if ptFakeTouchLoaded {
            invokePTFakeTouch(selectorName: "touchDownAtPoint:pointId:", point: CGPoint(x: x, y: y), fingerId: fingerId)
        } else {
            sendZXCommand("10;\(x);\(y);\(fingerId)")
        }
    }
    
    /// Touch Move raw event
    func touchMove(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        if ptFakeTouchLoaded {
            invokePTFakeTouch(selectorName: "touchMoveAtPoint:pointId:", point: CGPoint(x: x, y: y), fingerId: fingerId)
        } else {
            sendZXCommand("11;\(x);\(y);\(fingerId)")
        }
    }
    
    /// Touch Up raw event
    func touchUp(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        if ptFakeTouchLoaded {
            invokePTFakeTouch(selectorName: "touchUpAtPoint:pointId:", point: CGPoint(x: x, y: y), fingerId: fingerId)
        } else {
            sendZXCommand("12;\(x);\(y);\(fingerId)")
        }
    }
    
    /// Send visual notification to draw glowing touch indicators on HUD
    private func postTouchNotification(x: CGFloat, y: CGFloat) {
        NotificationCenter.default.post(
            name: NSNotification.Name("ShowTouchIndicatorNotification"),
            object: nil,
            userInfo: ["x": x, "y": y]
        )
    }
}
