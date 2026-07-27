import UIKit

/// Floating Overlay Glass HUD Window that sits on top of all views (UIWindowLevelStatusBar + 1)
class FloatingWindow: UIWindow {
    static let shared = FloatingWindow()
    
    // UI Elements
    private let containerView = UIView()
    private let headerLabel = UILabel()
    private let statusIndicator = UIView()
    private let logTextView = UITextView()
    private let stopButton = UIButton(type: .system)
    private let dragGesture = UIPanGestureRecognizer()
    
    // Layout State
    private var isMinimized = false
    private let expandedSize = CGSize(width: 290, height: 210)
    private let minimizedSize = CGSize(width: 64, height: 64)
    
    private init() {
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        if let windowScene = scene {
            super.init(windowScene: windowScene)
        } else {
            super.init(frame: CGRect(x: 20, y: 80, width: 290, height: 210))
        }
        
        setupWindow()
        setupUI()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupWindow() {
        self.windowLevel = .statusBar + 1
        self.backgroundColor = .clear
        self.clipsToBounds = true
        self.frame = CGRect(origin: CGPoint(x: 20, y: 80), size: expandedSize)
        self.isUserInteractionEnabled = true
    }
    
    private func setupUI() {
        // Container styling (Glassmorphism design v5.0)
        containerView.frame = self.bounds
        containerView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        containerView.backgroundColor = UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 0.90) // Dark Glass Slate
        containerView.layer.cornerRadius = 16
        containerView.layer.borderWidth = 1.5
        containerView.layer.borderColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.6).cgColor // Electric Indigo
        
        // Glow Shadow
        containerView.layer.shadowColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.4).cgColor
        containerView.layer.shadowOffset = CGSize(width: 0, height: 6)
        containerView.layer.shadowRadius = 12
        containerView.layer.shadowOpacity = 0.8
        
        self.addSubview(containerView)
        
        // Header
        headerLabel.text = "iOSControl HUD"
        headerLabel.textColor = .white
        headerLabel.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        headerLabel.frame = CGRect(x: 30, y: 10, width: 140, height: 20)
        containerView.addSubview(headerLabel)
        
        // Status indicator
        statusIndicator.frame = CGRect(x: 12, y: 15, width: 10, height: 10)
        statusIndicator.layer.cornerRadius = 5
        statusIndicator.backgroundColor = UIColor(red: 244/255, green: 63/255, blue: 94/255, alpha: 1.0) // Start as disconnected red
        containerView.addSubview(statusIndicator)
        
        // Double tap gesture to minimize/maximize
        let doubleTapGesture = UITapGestureRecognizer(target: self, action: #selector(toggleMinimize))
        doubleTapGesture.numberOfTapsRequired = 2
        containerView.addGestureRecognizer(doubleTapGesture)
        
        // Drag gesture
        dragGesture.addTarget(self, action: #selector(handleDrag(_:)))
        containerView.addGestureRecognizer(dragGesture)
        
        // Listen for simulated touch indicator notifications
        NotificationCenter.default.addObserver(self, selector: #selector(handleTouchIndicatorNotification(_:)), name: Notification.Name("ShowTouchIndicatorNotification"), object: nil)
        
        // Log text view
        logTextView.frame = CGRect(x: 12, y: 38, width: 266, height: 126)
        logTextView.backgroundColor = UIColor(red: 9/255, green: 13/255, blue: 22/255, alpha: 0.8)
        logTextView.textColor = UIColor(red: 6/255, green: 182/255, blue: 212/255, alpha: 1.0) // Neon Cyan
        logTextView.font = UIFont.monospacedSystemFont(ofSize: 9.5, weight: .regular)
        logTextView.isEditable = false
        logTextView.layer.cornerRadius = 8
        logTextView.layer.borderWidth = 1
        logTextView.layer.borderColor = UIColor(white: 1, alpha: 0.08).cgColor
        logTextView.text = "HUD Agent Initialized. Double-tap to toggle minimize."
        containerView.addSubview(logTextView)
        
        // Stop Button
        stopButton.frame = CGRect(x: 186, y: 8, width: 92, height: 24)
        stopButton.setTitle("⏹ STOP", for: .normal)
        stopButton.backgroundColor = UIColor(red: 244/255, green: 63/255, blue: 94/255, alpha: 0.9)
        stopButton.setTitleColor(.white, for: .normal)
        stopButton.titleLabel?.font = UIFont.systemFont(ofSize: 11, weight: .bold)
        stopButton.layer.cornerRadius = 6
        stopButton.addTarget(self, action: #selector(stopBtnPressed), for: .touchUpInside)
        containerView.addSubview(stopButton)
    }
    
    // MARK: - Handlers
    
    @objc private func handleDrag(_ gesture: UIPanGestureRecognizer) {
        let translation = gesture.translation(in: self.superview)
        guard let windowScene = self.windowScene else { return }
        let screenBounds = windowScene.coordinateSpace.bounds
        
        var newCenter = CGPoint(x: self.center.x + translation.x, y: self.center.y + translation.y)
        
        let padding: CGFloat = 10
        newCenter.x = max(padding + self.frame.width/2, min(screenBounds.width - padding - self.frame.width/2, newCenter.x))
        newCenter.y = max(padding + self.frame.height/2, min(screenBounds.height - padding - self.frame.height/2, newCenter.y))
        
        self.center = newCenter
        gesture.setTranslation(.zero, in: self.superview)
    }
    
    @objc private func toggleMinimize() {
        isMinimized.toggle()
        
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.impactOccurred()
        
        UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0.5, options: .curveEaseInOut, animations: {
            if self.isMinimized {
                self.frame.size = self.minimizedSize
                self.logTextView.isHidden = true
                self.stopButton.isHidden = true
                self.headerLabel.isHidden = true
                self.statusIndicator.frame = CGRect(x: 27, y: 27, width: 10, height: 10)
                self.containerView.layer.cornerRadius = 32
            } else {
                self.frame.size = self.expandedSize
                self.logTextView.isHidden = false
                self.stopButton.isHidden = false
                self.headerLabel.isHidden = false
                self.statusIndicator.frame = CGRect(x: 12, y: 15, width: 10, height: 10)
                self.containerView.layer.cornerRadius = 16
            }
        }, completion: nil)
    }
    
    @objc private func stopBtnPressed() {
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()
        print("[FloatingHUD] Stop requested.")
        self.addLog("Script execution manually terminated.")
        WebSocketClient.shared.sendDeviceStatus(status: "online")
        NotificationCenter.default.post(name: Notification.Name("TerminateScriptNotification"), object: nil)
    }
    
    // MARK: - Public APIs
    
    func setStatus(online: Bool, running: Bool = false) {
        DispatchQueue.main.async {
            if !online {
                self.statusIndicator.backgroundColor = UIColor(red: 244/255, green: 63/255, blue: 94/255, alpha: 1.0)
                self.containerView.layer.borderColor = UIColor(red: 244/255, green: 63/255, blue: 94/255, alpha: 0.8).cgColor
            } else if running {
                self.statusIndicator.backgroundColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 1.0)
                self.containerView.layer.borderColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 1.0).cgColor
            } else {
                self.statusIndicator.backgroundColor = UIColor(red: 16/255, green: 185/255, blue: 129/255, alpha: 1.0)
                self.containerView.layer.borderColor = UIColor(red: 16/255, green: 185/255, blue: 129/255, alpha: 0.8).cgColor
            }
        }
    }
    
    func addLog(_ text: String) {
        DispatchQueue.main.async {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm:ss"
            let timeStr = formatter.string(from: Date())
            
            let newText = "\(self.logTextView.text ?? "")\n[\(timeStr)] \(text)"
            self.logTextView.text = newText
            
            let range = NSRange(location: newText.count - 1, length: 1)
            self.logTextView.scrollRangeToVisible(range)
        }
    }
    
    func showHUD() {
        self.isHidden = false
        self.makeKeyAndVisible()
    }
    
    func hideHUD() {
        self.isHidden = true
    }
    
    // MARK: - Touch Indicator Overlay Animation (Red Glowing Dot)
    
    @objc private func handleTouchIndicatorNotification(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let x = userInfo["x"] as? CGFloat,
              let y = userInfo["y"] as? CGFloat else { return }
              
        showTouchIndicator(at: CGPoint(x: x, y: y))
    }
    
    func showTouchIndicator(at point: CGPoint) {
        DispatchQueue.main.async {
            let parentView: UIView = UIApplication.shared.keyWindowCompat ?? self.superview ?? self
            
            // Red Glowing Touch Target Dot (Chấm đỏ rực rỡ)
            let redDot = UIView(frame: CGRect(x: point.x - 14, y: point.y - 14, width: 28, height: 28))
            redDot.backgroundColor = UIColor(red: 244/255, green: 63/255, blue: 94/255, alpha: 0.9) // Bright Crimson Red
            redDot.layer.cornerRadius = 14
            redDot.layer.borderWidth = 2.5
            redDot.layer.borderColor = UIColor.white.cgColor
            redDot.layer.shadowColor = UIColor(red: 244/255, green: 63/255, blue: 94/255, alpha: 1.0).cgColor
            redDot.layer.shadowOffset = .zero
            redDot.layer.shadowRadius = 10
            redDot.layer.shadowOpacity = 1.0
            redDot.isUserInteractionEnabled = false
            
            // White Inner Core Dot
            let innerCore = UIView(frame: CGRect(x: 8, y: 8, width: 12, height: 12))
            innerCore.backgroundColor = .white
            innerCore.layer.cornerRadius = 6
            innerCore.isUserInteractionEnabled = false
            redDot.addSubview(innerCore)
            
            parentView.addSubview(redDot)
            
            redDot.transform = CGAffineTransform(scaleX: 0.3, y: 0.3)
            redDot.alpha = 0
            
            UIView.animate(withDuration: 0.15, delay: 0, options: .curveEaseOut, animations: {
                redDot.alpha = 1
                redDot.transform = .identity
            }) { _ in
                UIView.animate(withDuration: 0.4, delay: 0.1, options: .curveEaseOut, animations: {
                    redDot.transform = CGAffineTransform(scaleX: 2.2, y: 2.2)
                    redDot.alpha = 0
                }) { _ in
                    redDot.removeFromSuperview()
                }
            }
        }
    }
}
