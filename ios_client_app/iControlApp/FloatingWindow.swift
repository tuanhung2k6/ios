import UIKit

/// Floating Overlay HUD Window that sits on top of all views (UIWindowLevelStatusBar + 1)
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
    private let expandedSize = CGSize(width: 280, height: 200)
    private let minimizedSize = CGSize(width: 60, height: 60)
    
    private init() {
        // Initialize at the status bar level to overlay other views
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        if let windowScene = scene {
            super.init(windowScene: windowScene)
        } else {
            super.init(frame: CGRect(x: 20, y: 80, width: 280, height: 200))
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
        
        // Make sure window is interactive
        self.isUserInteractionEnabled = true
    }
    
    private func setupUI() {
        // Container styling (Glassmorphism design)
        containerView.frame = self.bounds
        containerView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        containerView.backgroundColor = UIColor(red: 10/255, green: 15/255, blue: 25/255, alpha: 0.85)
        containerView.layer.cornerRadius = 14
        containerView.layer.borderWidth = 1.5
        containerView.layer.borderColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.6).cgColor // Indigo Glow
        
        // Shadow
        containerView.layer.shadowColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.3).cgColor
        containerView.layer.shadowOffset = CGSize(width: 0, height: 4)
        containerView.layer.shadowRadius = 8
        containerView.layer.shadowOpacity = 0.8
        
        self.addSubview(containerView)
        
        // Header
        headerLabel.text = "iOSControl HUD"
        headerLabel.textColor = .white
        headerLabel.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        headerLabel.frame = CGRect(x: 30, y: 8, width: 140, height: 20)
        containerView.addSubview(headerLabel)
        
        // Status indicator
        statusIndicator.frame = CGRect(x: 12, y: 13, width: 10, height: 10)
        statusIndicator.layer.cornerRadius = 5
        statusIndicator.backgroundColor = .red // Start as disconnected
        containerView.addSubview(statusIndicator)
        
        // Double tap gesture to minimize/maximize
        let doubleTapGesture = UITapGestureRecognizer(target: self, action: #selector(toggleMinimize))
        doubleTapGesture.numberOfTapsRequired = 2
        containerView.addGestureRecognizer(doubleTapGesture)
        
        // Drag gesture
        dragGesture.addTarget(self, action: #selector(handleDrag(_:)))
        containerView.addGestureRecognizer(dragGesture)
        
        // Log text view
        logTextView.frame = CGRect(x: 10, y: 35, width: 260, height: 120)
        logTextView.backgroundColor = UIColor(white: 0.0, alpha: 0.3)
        logTextView.textColor = UIColor(red: 229/255, green: 231/255, blue: 235/255, alpha: 1.0)
        logTextView.font = UIFont.monospacedSystemFont(ofSize: 9, weight: .regular)
        logTextView.isEditable = false
        logTextView.layer.cornerRadius = 6
        logTextView.text = "HUD initialized. Double-tap to minimize."
        containerView.addSubview(logTextView)
        
        // Stop Button
        stopButton.frame = CGRect(x: 180, y: 6, width: 90, height: 24)
        stopButton.setTitle("STOP", for: .normal)
        stopButton.backgroundColor = UIColor(red: 239/255, green: 68/255, blue: 68/255, alpha: 0.8)
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
        
        // Prevent going completely off-screen
        let padding: CGFloat = 10
        newCenter.x = max(padding + self.frame.width/2, min(screenBounds.width - padding - self.frame.width/2, newCenter.x))
        newCenter.y = max(padding + self.frame.height/2, min(screenBounds.height - padding - self.frame.height/2, newCenter.y))
        
        self.center = newCenter
        gesture.setTranslation(.zero, in: self.superview)
    }
    
    @objc private func toggleMinimize() {
        isMinimized.toggle()
        
        UIView.animate(withDuration: 0.3, delay: 0, options: .curveEaseInOut, animations: {
            if self.isMinimized {
                self.frame.size = self.minimizedSize
                self.logTextView.isHidden = true
                self.stopButton.isHidden = true
                self.headerLabel.isHidden = true
                self.statusIndicator.frame = CGRect(x: 25, y: 25, width: 10, height: 10)
                self.containerView.layer.cornerRadius = 30
            } else {
                self.frame.size = self.expandedSize
                self.logTextView.isHidden = false
                self.stopButton.isHidden = false
                self.headerLabel.isHidden = false
                self.statusIndicator.frame = CGRect(x: 12, y: 13, width: 10, height: 10)
                self.containerView.layer.cornerRadius = 14
            }
        }, completion: nil)
    }
    
    @objc private func stopBtnPressed() {
        print("[FloatingHUD] Stop requested.")
        self.addLog("Script execution manually terminated.")
        WebSocketClient.shared.sendDeviceStatus(status: "online")
        // Trigger script termination
        NotificationCenter.default.post(name: Notification.Name("TerminateScriptNotification"), object: nil)
    }
    
    // MARK: - Public APIs
    
    func setStatus(online: Bool, running: Bool = false) {
        DispatchQueue.main.async {
            if !online {
                self.statusIndicator.backgroundColor = .red
                self.containerView.layer.borderColor = UIColor.red.cgColor
            } else if running {
                self.statusIndicator.backgroundColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 1.0)
                self.containerView.layer.borderColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 1.0).cgColor
            } else {
                self.statusIndicator.backgroundColor = .green
                self.containerView.layer.borderColor = UIColor(red: 16/255, green: 185/255, blue: 129/255, alpha: 1.0).cgColor
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
            
            // Auto scroll to bottom
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
}
