import Foundation
import CoreGraphics
import UIKit

/// Simulated Touch library integrating PTFakeTouch and ZXTouch
class TouchSimulator {
    static let shared = TouchSimulator()
    
    private var ptFakeTouchLoaded = false
    private var zxTouchSocket: URLSessionWebSocketTask? // Optional connection to local zxtouchd
    
    private init() {
        loadPTFakeTouch()
    }
    
    /// Try to load PTFakeTouch library dynamically from jailbroken iOS system path
    private func loadPTFakeTouch() {
        let paths = [
            "/usr/lib/libPTFakeTouch.dylib",
            "/Library/MobileSubstrate/DynamicLibraries/PTFakeTouch.dylib",
            "/var/jb/usr/lib/libPTFakeTouch.dylib" // Rootless jailbreak path
        ]
        
        for path in paths {
            if let handle = dlopen(path, RTLD_NOW) {
                print("[TouchSimulator] Loaded PTFakeTouch successfully from: \(path)")
                ptFakeTouchLoaded = true
                break
            }
        }
        
        if !ptFakeTouchLoaded {
            print("[TouchSimulator] Warning: PTFakeTouch library not found. Touch injection may fallback or fail.")
        }
    }
    
    // MARK: - API Methods
    
    /// Tap at logical coordinates (Point)
    func tap(x: CGFloat, y: CGFloat) {
        print("[TouchSimulator] Tapping at (\(x), \(y))")
        if ptFakeTouchLoaded {
            performPTFakeTouchTap(point: CGPoint(x: x, y: y))
        } else {
            performZXTouchCommand(cmd: "tap;\(x);\(y)")
        }
    }
    
    /// Swipe from start point to end point with duration
    func swipe(fromX: CGFloat, fromY: CGFloat, toX: CGFloat, toY: CGFloat, duration: Double = 0.3) {
        print("[TouchSimulator] Swiping from (\(fromX), \(fromY)) to (\(toX), \(toY)) in \(duration)s")
        if ptFakeTouchLoaded {
            performPTFakeTouchSwipe(from: CGPoint(x: fromX, y: fromY), to: CGPoint(x: toX, y: toY), duration: duration)
        } else {
            performZXTouchCommand(cmd: "swipe;\(fromX);\(fromY);\(toX);\(toY);\(duration)")
        }
    }
    
    /// Touch Down raw event
    func touchDown(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        if ptFakeTouchLoaded, let ptClass = NSClassFromString("PTFakeTouch") as AnyObject? {
            let selector = Selector(("touchDownAtPoint:pointId:"))
            if ptClass.responds(to: selector) {
                _ = ptClass.perform(selector, with: CGPoint(x: x, y: y), with: fingerId)
            }
        } else {
            performZXTouchCommand(cmd: "touchDown;\(fingerId);\(x);\(y)")
        }
    }
    
    /// Touch Move raw event
    func touchMove(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        if ptFakeTouchLoaded, let ptClass = NSClassFromString("PTFakeTouch") as AnyObject? {
            let selector = Selector(("touchMoveAtPoint:pointId:"))
            if ptClass.responds(to: selector) {
                _ = ptClass.perform(selector, with: CGPoint(x: x, y: y), with: fingerId)
            }
        } else {
            performZXTouchCommand(cmd: "touchMove;\(fingerId);\(x);\(y)")
        }
    }
    
    /// Touch Up raw event
    func touchUp(x: CGFloat, y: CGFloat, fingerId: Int = 1) {
        if ptFakeTouchLoaded, let ptClass = NSClassFromString("PTFakeTouch") as AnyObject? {
            let selector = Selector(("touchUpAtPoint:pointId:"))
            if ptClass.responds(to: selector) {
                _ = ptClass.perform(selector, with: CGPoint(x: x, y: y), with: fingerId)
            }
        } else {
            performZXTouchCommand(cmd: "touchUp;\(fingerId);\(x);\(y)")
        }
    }
    
    // MARK: - Internal PTFakeTouch execution
    
    private func performPTFakeTouchTap(point: CGPoint) {
        guard let ptClass = NSClassFromString("PTFakeTouch") as AnyObject? else { return }
        
        let touchDownSel = Selector(("touchDownAtPoint:"))
        let touchUpSel = Selector(("touchUpAtPoint:"))
        
        if ptClass.responds(to: touchDownSel) && ptClass.responds(to: touchUpSel) {
            // Simulated touch ID default 1
            _ = ptClass.perform(touchDownSel, with: point)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                _ = ptClass.perform(touchUpSel, with: point)
            }
        }
    }
    
    private func performPTFakeTouchSwipe(from: CGPoint, to: CGPoint, duration: Double) {
        guard let ptClass = NSClassFromString("PTFakeTouch") as AnyObject? else { return }
        
        let touchDownSel = Selector(("touchDownAtPoint:"))
        let touchMoveSel = Selector(("touchMoveAtPoint:"))
        let touchUpSel = Selector(("touchUpAtPoint:"))
        
        if ptClass.responds(to: touchDownSel) && ptClass.responds(to: touchMoveSel) && ptClass.responds(to: touchUpSel) {
            _ = ptClass.perform(touchDownSel, with: from)
            
            let steps = 20
            let stepDelay = duration / Double(steps)
            
            for i in 1...steps {
                let progress = CGFloat(i) / CGFloat(steps)
                let currentPoint = CGPoint(
                    x: from.x + (to.x - from.x) * progress,
                    y: from.y + (to.y - from.y) * progress
                )
                
                DispatchQueue.main.asyncAfter(deadline: .now() + (Double(i) * stepDelay)) {
                    _ = ptClass.perform(touchMoveSel, with: currentPoint)
                    
                    if i == steps {
                        _ = ptClass.perform(touchUpSel, with: to)
                    }
                }
            }
        }
    }
    
    // MARK: - Internal ZXTouch Socket client
    
    /// Transmit touch event to zxtouchd daemon over TCP connection (typically localhost port 6000)
    private func performZXTouchCommand(cmd: String) {
        print("[TouchSimulator] [ZXTouch fallback] Sending command: \(cmd)")
        // In jailbroken systems running ZXTouch, commands are formatted as string packets
        // example: "10;100;200" for down, "11;100;200" for move, "12;100;200" for up
        // Here we demonstrate the network socket logic to send to port 6000.
        
        guard let serverURL = URL(string: "http://127.0.0.1:6000/execute") else { return }
        var request = URLRequest(url: serverURL)
        request.httpMethod = "POST"
        request.httpBody = cmd.data(using: .utf8)
        request.timeoutInterval = 1.0
        
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[TouchSimulator] ZXTouch daemon communication error: \(error.localizedDescription)")
            }
        }
        task.resume()
    }
}
