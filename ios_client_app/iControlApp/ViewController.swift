import UIKit
import Foundation

// MARK: - Premium Ultra-Modern ViewController
class ViewController: UIViewController {
    
    // ─── UI Layer Cards ───────────────────────────────────
    
    // Status Card
    private let statusCard = UIView()
    private let wsStatusDot = UIView()
    private let wsStatusLabel = UILabel()
    private let batteryLabel = UILabel()
    private let timeLabel = UILabel()
    
    // Server Control Card
    private let serverCard = UIView()
    
    // HUD Card
    private let hudSwitch = UISwitch()
    
    // Script Management Card
    private let scriptCard = UIView()
    private let scriptStack = UIStackView()
    
    // Quick-Log area
    private let logCard = UIView()
    private let logTextView = UITextView()
    
    // Version badge
    private let versionLabel = UILabel()
    
    // State
    private var isConnected = false
    private var clockTimer: Timer?
    private var batteryTimer: Timer?
    private var pulseTimer: Timer?

    // Titanium Slate & Neon Indigo Theme Colors
    private let bgColor = UIColor(red: 9/255, green: 13/255, blue: 22/255, alpha: 1) // Deep Dark Slate #090D16
    private let surfaceColor = UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 1) // #0F172A
    private let cardColor = UIColor(red: 26/255, green: 34/255, blue: 53/255, alpha: 0.95) // Elevated Slate
    private let cardBorder = UIColor(white: 1, alpha: 0.1)
    
    private let accent = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 1) // Electric Indigo #6366F1
    private let cyan = UIColor(red: 6/255, green: 182/255, blue: 212/255, alpha: 1) // Cyber Cyan #06B6D4
    private let emerald = UIColor(red: 16/255, green: 185/255, blue: 129/255, alpha: 1) // Glowing Emerald #10B981
    private let red = UIColor(red: 244/255, green: 63/255, blue: 94/255, alpha: 1) // Rose #F43F5E
    
    private let textPrimary = UIColor(red: 248/255, green: 250/255, blue: 252/255, alpha: 1)
    private let textMuted = UIColor(red: 148/255, green: 163/255, blue: 184/255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        setupNavBar()
        setupScrollView()
        startClock()
        startBatteryMonitor()
        
        // Observe WS events from WebSocketClient
        NotificationCenter.default.addObserver(self, selector: #selector(onDeviceConnected), name: Notification.Name.wsConnected, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(onDeviceDisconnected), name: Notification.Name.wsDisconnected, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(onLogReceived(_:)), name: Notification.Name.wsLog, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(onRefreshScripts), name: NSNotification.Name("RefreshScriptsNotification"), object: nil)
    }
    
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyGradientToCard(statusCard)
    }
    
    deinit {
        clockTimer?.invalidate()
        batteryTimer?.invalidate()
        pulseTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Navigation Bar
    private func setupNavBar() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = surfaceColor
        appearance.titleTextAttributes = [
            .foregroundColor: textPrimary,
            .font: UIFont.systemFont(ofSize: 16, weight: .bold)
        ]
        navigationController?.navigationBar.standardAppearance = appearance
        navigationController?.navigationBar.scrollEdgeAppearance = appearance
        navigationController?.navigationBar.tintColor = cyan
        title = "iOSControl Studio"

        let infoBtn = UIBarButtonItem(image: UIImage(systemName: "info.circle.fill"), style: .plain, target: self, action: #selector(showAbout))
        navigationItem.rightBarButtonItem = infoBtn
    }

    // MARK: - Layout via ScrollView
    private func setupScrollView() {
        view.backgroundColor = bgColor
        
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.showsVerticalScrollIndicator = false
        view.addSubview(scroll)
        
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        
        let content = UIView()
        content.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: scroll.topAnchor),
            content.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            content.widthAnchor.constraint(equalTo: scroll.widthAnchor)
        ])
        
        ensureDefaultScript()
        
        // Build cards inside content
        buildHeroSection(in: content)
        buildStatusCard(in: content)
        buildServerControlCard(in: content)
        buildHUDCard(in: content)
        buildScriptCard(in: content)
        buildLogCard(in: content)
        buildVersionLabel(in: content)
        
        // Dismiss keyboard on tap
        let tap = UITapGestureRecognizer(target: view, action: #selector(UIView.endEditing(_:)))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
    }
    
    // MARK: - Hero Section
    private func buildHeroSection(in parent: UIView) {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(container)
        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: parent.topAnchor, constant: 20),
            container.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            container.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            container.heightAnchor.constraint(equalToConstant: 76)
        ])
        
        // Icon with Gradient Glow
        let iconBg = UIView()
        iconBg.backgroundColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.2)
        iconBg.layer.cornerRadius = 16
        iconBg.layer.borderWidth = 1
        iconBg.layer.borderColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.4).cgColor
        iconBg.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(iconBg)
        
        let icon = UIImageView(image: UIImage(systemName: "cpu.fill"))
        icon.tintColor = cyan
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false
        iconBg.addSubview(icon)
        
        let titleL = UILabel()
        titleL.text = "iOSControl Agent"
        titleL.font = UIFont.systemFont(ofSize: 22, weight: .bold)
        titleL.textColor = textPrimary
        titleL.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(titleL)
        
        let subL = UILabel()
        subL.text = "Futuristic Remote Automation Engine"
        subL.font = UIFont.systemFont(ofSize: 12, weight: .medium)
        subL.textColor = cyan
        subL.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(subL)
        
        NSLayoutConstraint.activate([
            iconBg.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            iconBg.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            iconBg.widthAnchor.constraint(equalToConstant: 54),
            iconBg.heightAnchor.constraint(equalToConstant: 54),
            
            icon.centerXAnchor.constraint(equalTo: iconBg.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: iconBg.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 26),
            icon.heightAnchor.constraint(equalToConstant: 26),
            
            titleL.leadingAnchor.constraint(equalTo: iconBg.trailingAnchor, constant: 14),
            titleL.topAnchor.constraint(equalTo: iconBg.topAnchor, constant: 4),
            titleL.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            
            subL.leadingAnchor.constraint(equalTo: titleL.leadingAnchor),
            subL.topAnchor.constraint(equalTo: titleL.bottomAnchor, constant: 4),
        ])
    }
    
    // MARK: - Status Card
    private func buildStatusCard(in parent: UIView) {
        let prev = parent.subviews.last!
        styleCard(statusCard)
        statusCard.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(statusCard)
        NSLayoutConstraint.activate([
            statusCard.topAnchor.constraint(equalTo: prev.bottomAnchor, constant: 14),
            statusCard.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            statusCard.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            statusCard.heightAnchor.constraint(equalToConstant: 74)
        ])
        
        let titleL = cardSectionTitle("📡 TRẠNG THÁI KẾT NỐI WebSocket")
        statusCard.addSubview(titleL)
        
        wsStatusDot.backgroundColor = emerald
        wsStatusDot.layer.cornerRadius = 6
        wsStatusDot.translatesAutoresizingMaskIntoConstraints = false
        statusCard.addSubview(wsStatusDot)
        
        wsStatusLabel.text = "Máy chủ sẵn sàng"
        wsStatusLabel.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        wsStatusLabel.textColor = emerald
        wsStatusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusCard.addSubview(wsStatusLabel)
        
        batteryLabel.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        batteryLabel.textColor = textMuted
        batteryLabel.translatesAutoresizingMaskIntoConstraints = false
        statusCard.addSubview(batteryLabel)
        
        timeLabel.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .bold)
        timeLabel.textColor = cyan
        timeLabel.textAlignment = .right
        timeLabel.translatesAutoresizingMaskIntoConstraints = false
        statusCard.addSubview(timeLabel)
        
        NSLayoutConstraint.activate([
            titleL.topAnchor.constraint(equalTo: statusCard.topAnchor, constant: 12),
            titleL.leadingAnchor.constraint(equalTo: statusCard.leadingAnchor, constant: 14),
            
            wsStatusDot.leadingAnchor.constraint(equalTo: statusCard.leadingAnchor, constant: 14),
            wsStatusDot.bottomAnchor.constraint(equalTo: statusCard.bottomAnchor, constant: -14),
            wsStatusDot.widthAnchor.constraint(equalToConstant: 12),
            wsStatusDot.heightAnchor.constraint(equalToConstant: 12),
            
            wsStatusLabel.leadingAnchor.constraint(equalTo: wsStatusDot.trailingAnchor, constant: 8),
            wsStatusLabel.centerYAnchor.constraint(equalTo: wsStatusDot.centerYAnchor),
            
            batteryLabel.leadingAnchor.constraint(equalTo: wsStatusLabel.trailingAnchor, constant: 12),
            batteryLabel.centerYAnchor.constraint(equalTo: wsStatusDot.centerYAnchor),
            
            timeLabel.trailingAnchor.constraint(equalTo: statusCard.trailingAnchor, constant: -14),
            timeLabel.centerYAnchor.constraint(equalTo: wsStatusDot.centerYAnchor),
        ])
    }
    
    // MARK: - Server Control Card
    private func buildServerControlCard(in parent: UIView) {
        let prev = parent.subviews.last!
        styleCard(serverCard)
        serverCard.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(serverCard)
        
        let titleL = cardSectionTitle("🖥️ MÁY CHỦ DASHBOARD LOCAL")
        serverCard.addSubview(titleL)
        
        let statusDot = UIView()
        statusDot.backgroundColor = emerald
        statusDot.layer.cornerRadius = 6
        statusDot.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(statusDot)
        
        let statusText = UILabel()
        statusText.text = "HTTP Local Server Active :9898"
        statusText.textColor = emerald
        statusText.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        statusText.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(statusText)
        
        let ip = WebSocketClient.shared.getWiFiAddress() ?? "127.0.0.1"
        let urlStr = "http://\(ip):9898"
        
        let urlContainer = UIView()
        urlContainer.backgroundColor = UIColor(red: 10/255, green: 14/255, blue: 24/255, alpha: 1)
        urlContainer.layer.cornerRadius = 10
        urlContainer.layer.borderWidth = 1
        urlContainer.layer.borderColor = UIColor(red: 6/255, green: 182/255, blue: 212/255, alpha: 0.3).cgColor
        urlContainer.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(urlContainer)
        
        let urlLabel = UILabel()
        urlLabel.text = urlStr
        urlLabel.textColor = cyan
        urlLabel.font = UIFont.monospacedSystemFont(ofSize: 15, weight: .bold)
        urlLabel.textAlignment = .center
        urlLabel.translatesAutoresizingMaskIntoConstraints = false
        urlContainer.addSubview(urlLabel)
        
        let descLabel = UILabel()
        descLabel.text = "👉 Nhập địa chỉ trên vào trình duyệt web máy tính"
        descLabel.textColor = textMuted
        descLabel.font = UIFont.systemFont(ofSize: 11, weight: .medium)
        descLabel.textAlignment = .center
        descLabel.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(descLabel)
        
        // Copy Button
        let copyBtn = UIButton(type: .system)
        copyBtn.setTitle("📋 Sao chép URL Web", for: .normal)
        copyBtn.setTitleColor(.white, for: .normal)
        copyBtn.backgroundColor = accent
        copyBtn.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        copyBtn.layer.cornerRadius = 10
        copyBtn.addTarget(self, action: #selector(copyServerUrl), for: .touchUpInside)
        copyBtn.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(copyBtn)
        
        NSLayoutConstraint.activate([
            serverCard.topAnchor.constraint(equalTo: prev.bottomAnchor, constant: 12),
            serverCard.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            serverCard.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            serverCard.heightAnchor.constraint(equalToConstant: 184),
            
            titleL.topAnchor.constraint(equalTo: serverCard.topAnchor, constant: 12),
            titleL.leadingAnchor.constraint(equalTo: serverCard.leadingAnchor, constant: 14),
            
            statusDot.leadingAnchor.constraint(equalTo: serverCard.leadingAnchor, constant: 14),
            statusDot.topAnchor.constraint(equalTo: titleL.bottomAnchor, constant: 14),
            statusDot.widthAnchor.constraint(equalToConstant: 12),
            statusDot.heightAnchor.constraint(equalToConstant: 12),
            
            statusText.leadingAnchor.constraint(equalTo: statusDot.trailingAnchor, constant: 8),
            statusText.centerYAnchor.constraint(equalTo: statusDot.centerYAnchor),
            
            urlContainer.topAnchor.constraint(equalTo: statusText.bottomAnchor, constant: 12),
            urlContainer.leadingAnchor.constraint(equalTo: serverCard.leadingAnchor, constant: 14),
            urlContainer.trailingAnchor.constraint(equalTo: serverCard.trailingAnchor, constant: -14),
            urlContainer.heightAnchor.constraint(equalToConstant: 40),
            
            urlLabel.centerXAnchor.constraint(equalTo: urlContainer.centerXAnchor),
            urlLabel.centerYAnchor.constraint(equalTo: urlContainer.centerYAnchor),
            
            descLabel.topAnchor.constraint(equalTo: urlContainer.bottomAnchor, constant: 8),
            descLabel.leadingAnchor.constraint(equalTo: serverCard.leadingAnchor, constant: 14),
            descLabel.trailingAnchor.constraint(equalTo: serverCard.trailingAnchor, constant: -14),
            
            copyBtn.topAnchor.constraint(equalTo: descLabel.bottomAnchor, constant: 10),
            copyBtn.leadingAnchor.constraint(equalTo: serverCard.leadingAnchor, constant: 14),
            copyBtn.trailingAnchor.constraint(equalTo: serverCard.trailingAnchor, constant: -14),
            copyBtn.heightAnchor.constraint(equalToConstant: 38)
        ])
    }
    
    @objc private func copyServerUrl() {
        let ip = WebSocketClient.shared.getWiFiAddress() ?? "127.0.0.1"
        UIPasteboard.general.string = "http://\(ip):9898"
        showToast("Đã sao chép đường dẫn kết nối!")
    }
    
    // MARK: - HUD Card
    private func buildHUDCard(in parent: UIView) {
        let prev = parent.subviews.last!
        let card = UIView()
        styleCard(card)
        card.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(card)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: prev.bottomAnchor, constant: 12),
            card.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            card.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            card.heightAnchor.constraint(equalToConstant: 68)
        ])
        
        let titleL = cardSectionTitle("👁 OVERLAY GLASS HUD")
        card.addSubview(titleL)
        
        let sub = UILabel()
        sub.text = "Cửa sổ log nổi trên màn hình ứng dụng"
        sub.font = UIFont.systemFont(ofSize: 12)
        sub.textColor = textMuted
        sub.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(sub)
        
        hudSwitch.onTintColor = accent
        hudSwitch.isOn = false
        hudSwitch.addTarget(self, action: #selector(hudChanged), for: .valueChanged)
        hudSwitch.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(hudSwitch)
        
        NSLayoutConstraint.activate([
            titleL.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            titleL.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            
            sub.topAnchor.constraint(equalTo: titleL.bottomAnchor, constant: 2),
            sub.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            
            hudSwitch.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            hudSwitch.centerYAnchor.constraint(equalTo: card.centerYAnchor),
        ])
    }
    
    // MARK: - Script Manager Card
    private func buildScriptCard(in parent: UIView) {
        let prev = parent.subviews.last!
        styleCard(scriptCard)
        scriptCard.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(scriptCard)
        
        let titleL = cardSectionTitle("📁 QUẢN LÝ & CHẠY SCRIPT LUA")
        scriptCard.addSubview(titleL)
        
        let addBtn = UIButton(type: .system)
        addBtn.setTitle("➕ Tạo Script", for: .normal)
        addBtn.setTitleColor(cyan, for: .normal)
        addBtn.titleLabel?.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        addBtn.addTarget(self, action: #selector(createScriptPressed), for: .touchUpInside)
        addBtn.translatesAutoresizingMaskIntoConstraints = false
        scriptCard.addSubview(addBtn)
        
        scriptStack.axis = .vertical
        scriptStack.spacing = 8
        scriptStack.translatesAutoresizingMaskIntoConstraints = false
        scriptCard.addSubview(scriptStack)
        
        NSLayoutConstraint.activate([
            scriptCard.topAnchor.constraint(equalTo: prev.bottomAnchor, constant: 12),
            scriptCard.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            scriptCard.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            
            titleL.topAnchor.constraint(equalTo: scriptCard.topAnchor, constant: 12),
            titleL.leadingAnchor.constraint(equalTo: scriptCard.leadingAnchor, constant: 14),
            
            addBtn.trailingAnchor.constraint(equalTo: scriptCard.trailingAnchor, constant: -14),
            addBtn.centerYAnchor.constraint(equalTo: titleL.centerYAnchor),
            
            scriptStack.topAnchor.constraint(equalTo: titleL.bottomAnchor, constant: 12),
            scriptStack.leadingAnchor.constraint(equalTo: scriptCard.leadingAnchor, constant: 14),
            scriptStack.trailingAnchor.constraint(equalTo: scriptCard.trailingAnchor, constant: -14),
            scriptStack.bottomAnchor.constraint(equalTo: scriptCard.bottomAnchor, constant: -14)
        ])
        
        loadAndRenderScripts()
    }
    
    // MARK: - Log Card
    private func buildLogCard(in parent: UIView) {
        let prev = parent.subviews.last!
        let card = UIView()
        styleCard(card)
        card.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(card)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: prev.bottomAnchor, constant: 12),
            card.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            card.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            card.heightAnchor.constraint(equalToConstant: 160)
        ])
        
        let titleL = cardSectionTitle("⚡ TERMINAL CONSOLE LOGS")
        card.addSubview(titleL)
        
        let clearBtn = UIButton(type: .system)
        clearBtn.setTitle("Xóa Log", for: .normal)
        clearBtn.setTitleColor(red, for: .normal)
        clearBtn.titleLabel?.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        clearBtn.addTarget(self, action: #selector(clearLog), for: .touchUpInside)
        clearBtn.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(clearBtn)
        
        logTextView.backgroundColor = UIColor(red: 6/255, green: 9/255, blue: 16/255, alpha: 1)
        logTextView.textColor = cyan
        logTextView.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        logTextView.isEditable = false
        logTextView.layer.cornerRadius = 8
        logTextView.layer.borderWidth = 1
        logTextView.layer.borderColor = UIColor(white: 1, alpha: 0.05).cgColor
        logTextView.text = "── iOSControl Agent System Ready ──"
        logTextView.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(logTextView)
        
        NSLayoutConstraint.activate([
            titleL.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            titleL.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            
            clearBtn.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            clearBtn.centerYAnchor.constraint(equalTo: titleL.centerYAnchor),
            
            logTextView.topAnchor.constraint(equalTo: titleL.bottomAnchor, constant: 8),
            logTextView.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 10),
            logTextView.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -10),
            logTextView.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -10),
        ])
    }
    
    private func buildVersionLabel(in parent: UIView) {
        let prev = parent.subviews.last!
        let label = UILabel()
        label.text = "iOSControl Studio Agent v5.0 • iControl Engine"
        label.font = UIFont.systemFont(ofSize: 10, weight: .medium)
        label.textColor = textMuted
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: prev.bottomAnchor, constant: 16),
            label.centerXAnchor.constraint(equalTo: parent.centerXAnchor),
            label.bottomAnchor.constraint(equalTo: parent.bottomAnchor, constant: -24)
        ])
    }
    
    // MARK: - Helpers
    private func styleCard(_ card: UIView) {
        card.backgroundColor = cardColor
        card.layer.cornerRadius = 16
        card.layer.borderWidth = 1
        card.layer.borderColor = cardBorder.cgColor
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOffset = CGSize(width: 0, height: 6)
        card.layer.shadowRadius = 16
        card.layer.shadowOpacity = 0.4
    }
    
    private func cardSectionTitle(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = UIFont.systemFont(ofSize: 11, weight: .bold)
        l.textColor = textMuted
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }
    
    private func applyGradientToCard(_ card: UIView) {
        if let sublayers = card.layer.sublayers, sublayers.contains(where: { $0 is CAGradientLayer }) { return }
        let grad = CAGradientLayer()
        grad.frame = card.bounds
        grad.cornerRadius = 16
        grad.colors = [
            UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.1).cgColor,
            UIColor.clear.cgColor
        ]
        grad.startPoint = CGPoint(x: 0, y: 0)
        grad.endPoint = CGPoint(x: 1, y: 1)
        card.layer.insertSublayer(grad, at: 0)
    }
    
    // MARK: - Timers
    private func startClock() {
        clockTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            let f = DateFormatter()
            f.dateFormat = "HH:mm:ss"
            self?.timeLabel.text = f.string(from: Date())
        }
        clockTimer?.fire()
    }
    
    private func startBatteryMonitor() {
        UIDevice.current.isBatteryMonitoringEnabled = true
        batteryTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.updateBattery()
        }
        updateBattery()
    }
    
    private func updateBattery() {
        let level = Int(UIDevice.current.batteryLevel * 100)
        let state = UIDevice.current.batteryState
        let icon = state == .charging ? "⚡" : (level < 20 ? "🔴" : (level < 50 ? "🟡" : "🟢"))
        batteryLabel.text = "\(icon) \(level)%"
        
        if isConnected {
            WebSocketClient.shared.sendBatteryLevel(level)
        }
    }
    
    // MARK: - Actions
    @objc private func hudChanged() {
        if hudSwitch.isOn { FloatingWindow.shared.showHUD() }
        else { FloatingWindow.shared.hideHUD() }
    }
    
    @objc private func clearLog() {
        logTextView.text = "── Log Cleared ──"
    }
    
    @objc private func showAbout() {
        let alert = UIAlertController(
            title: "iOSControl Studio Agent",
            message: "Remote Script Automation Engine v5.0\n\nKết nối máy tính qua WiFi để điều khiển tự động.\n\n© 2026 iControl Team",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
    
    // MARK: - Connected/Disconnected observers
    @objc private func onDeviceConnected() {
        DispatchQueue.main.async {
            self.setConnectedUI(true)
            self.appendLog("✅ Đã kết nối với server WebSocket")
        }
    }
    
    @objc private func onDeviceDisconnected() {
        DispatchQueue.main.async {
            self.setConnectedUI(false)
            self.appendLog("❌ Mất kết nối server WebSocket")
        }
    }
    
    @objc private func onLogReceived(_ notification: Notification) {
        guard let msg = notification.userInfo?["message"] as? String else { return }
        DispatchQueue.main.async {
            self.appendLog(msg)
            self.showLogToast(msg)
        }
    }
    
    private func showLogToast(_ message: String) {
        guard let window = view.window ?? UIApplication.shared.keyWindowCompat else { return }
        
        let toast = UIView()
        toast.backgroundColor = UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 0.95)
        toast.layer.cornerRadius = 12
        toast.layer.borderWidth = 1
        toast.layer.borderColor = UIColor(red: 6/255, green: 182/255, blue: 212/255, alpha: 0.6).cgColor
        toast.translatesAutoresizingMaskIntoConstraints = false
        toast.layer.shadowColor = UIColor.black.cgColor
        toast.layer.shadowOffset = CGSize(width: 0, height: 4)
        toast.layer.shadowRadius = 10
        toast.layer.shadowOpacity = 0.5

        let icon = UILabel()
        icon.text = "⚡"
        icon.font = UIFont.systemFont(ofSize: 13)
        icon.translatesAutoresizingMaskIntoConstraints = false

        let label = UILabel()
        label.textColor = textPrimary
        label.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        label.numberOfLines = 2
        label.text = message
        label.translatesAutoresizingMaskIntoConstraints = false

        toast.addSubview(icon)
        toast.addSubview(label)
        window.addSubview(toast)

        NSLayoutConstraint.activate([
            toast.topAnchor.constraint(equalTo: window.safeAreaLayoutGuide.topAnchor, constant: 12),
            toast.centerXAnchor.constraint(equalTo: window.centerXAnchor),
            toast.widthAnchor.constraint(lessThanOrEqualTo: window.widthAnchor, constant: -32),
            
            icon.leadingAnchor.constraint(equalTo: toast.leadingAnchor, constant: 12),
            icon.centerYAnchor.constraint(equalTo: toast.centerYAnchor),

            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: toast.trailingAnchor, constant: -12),
            label.topAnchor.constraint(equalTo: toast.topAnchor, constant: 10),
            label.bottomAnchor.constraint(equalTo: toast.bottomAnchor, constant: -10)
        ])

        toast.alpha = 0
        toast.transform = CGAffineTransform(translationX: 0, y: -20)

        UIView.animate(withDuration: 0.3, delay: 0, options: .curveEaseOut, animations: {
            toast.alpha = 1
            toast.transform = .identity
        }) { _ in
            UIView.animate(withDuration: 0.3, delay: 2.2, options: .curveEaseIn, animations: {
                toast.alpha = 0
                toast.transform = CGAffineTransform(translationX: 0, y: -20)
            }) { _ in
                toast.removeFromSuperview()
            }
        }
    }
    
    @objc private func onRefreshScripts() {
        DispatchQueue.main.async {
            self.loadAndRenderScripts()
        }
    }
    
    private func setConnectedUI(_ connected: Bool) {
        isConnected = connected
        UIView.animate(withDuration: 0.3) {
            if connected {
                self.wsStatusDot.backgroundColor = self.emerald
                self.wsStatusLabel.text = "Đã kết nối"
                self.wsStatusLabel.textColor = self.emerald
            } else {
                self.wsStatusDot.backgroundColor = self.red
                self.wsStatusLabel.text = "Chưa kết nối"
                self.wsStatusLabel.textColor = self.textMuted
            }
        }
        startPulse(connected)
    }
    
    private func startPulse(_ on: Bool) {
        pulseTimer?.invalidate()
        if on {
            pulseTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
                guard let dot = self?.wsStatusDot else { return }
                UIView.animate(withDuration: 0.5, animations: {
                    dot.transform = CGAffineTransform(scaleX: 1.4, y: 1.4)
                    dot.alpha = 0.6
                }) { _ in
                    UIView.animate(withDuration: 0.4) {
                        dot.transform = .identity
                        dot.alpha = 1
                    }
                }
            }
        }
    }
    
    private func appendLog(_ text: String) {
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"
        let line = "[\(f.string(from: Date()))] \(text)"
        let current = logTextView.text ?? ""
        let lines = current.components(separatedBy: "\n")
        let trimmed = lines.suffix(50).joined(separator: "\n")
        logTextView.text = trimmed + "\n" + line
        let range = NSRange(location: logTextView.text.count - 1, length: 1)
        logTextView.scrollRangeToVisible(range)
    }
    
    private func showToast(_ msg: String) {
        let toast = UILabel()
        toast.text = "  \(msg)  "
        toast.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        toast.textColor = .white
        toast.backgroundColor = UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 0.95)
        toast.layer.cornerRadius = 10; toast.clipsToBounds = true
        toast.textAlignment = .center
        toast.alpha = 0
        toast.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toast)
        NSLayoutConstraint.activate([
            toast.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            toast.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
            toast.heightAnchor.constraint(equalToConstant: 40)
        ])
        UIView.animate(withDuration: 0.3) { toast.alpha = 1 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            UIView.animate(withDuration: 0.3) { toast.alpha = 0 } completion: { _ in toast.removeFromSuperview() }
        }
    }
    
    // MARK: - Script Manager Card Layout
    private func getDocumentsDirectory() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    
    private func ensureDefaultScript() {
        let file = getDocumentsDirectory().appendingPathComponent("main.lua")
        if !FileManager.default.fileExists(atPath: file.path) {
            let defaultContent = """
            -- Kịch bản tự động hóa iOSControl LUA
            log("Bắt đầu kịch bản mẫu")
            sleep(1.0)
            tap(187, 400)
            sleep(1.5)
            log("Hoàn thành!")
            """
            try? defaultContent.write(to: file, atomically: true, encoding: .utf8)
        }
    }
    
    private func loadAndRenderScripts() {
        for view in scriptStack.arrangedSubviews {
            scriptStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        
        let docs = getDocumentsDirectory()
        guard let files = try? FileManager.default.contentsOfDirectory(at: docs, includingPropertiesForKeys: nil) else { return }
        let luaFiles = files.filter { $0.pathExtension == "lua" }.sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
        
        for file in luaFiles {
            let row = UIView()
            row.backgroundColor = surfaceColor
            row.layer.cornerRadius = 10
            row.layer.borderWidth = 1
            row.layer.borderColor = cardBorder.cgColor
            row.translatesAutoresizingMaskIntoConstraints = false
            
            let label = UILabel()
            label.text = file.lastPathComponent
            label.textColor = textPrimary
            label.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
            label.translatesAutoresizingMaskIntoConstraints = false
            row.addSubview(label)
            
            // Edit Button
            let editBtn = ScriptActionButton(type: .system)
            editBtn.setTitle("✏️ Sửa", for: .normal)
            editBtn.setTitleColor(.white, for: .normal)
            editBtn.backgroundColor = accent
            editBtn.titleLabel?.font = UIFont.systemFont(ofSize: 11, weight: .bold)
            editBtn.layer.cornerRadius = 6
            editBtn.fileURL = file
            editBtn.addTarget(self, action: #selector(editScriptPressed(_:)), for: .touchUpInside)
            editBtn.translatesAutoresizingMaskIntoConstraints = false
            row.addSubview(editBtn)
            
            // Run Button
            let runBtn = ScriptActionButton(type: .system)
            runBtn.setTitle("▶ Chạy", for: .normal)
            runBtn.setTitleColor(.white, for: .normal)
            runBtn.backgroundColor = emerald
            runBtn.titleLabel?.font = UIFont.systemFont(ofSize: 11, weight: .bold)
            runBtn.layer.cornerRadius = 6
            runBtn.fileURL = file
            runBtn.addTarget(self, action: #selector(runScriptPressed(_:)), for: .touchUpInside)
            runBtn.translatesAutoresizingMaskIntoConstraints = false
            row.addSubview(runBtn)
            
            // Delete Button
            let delBtn = ScriptActionButton(type: .system)
            delBtn.setTitle("🗑️", for: .normal)
            delBtn.setTitleColor(.white, for: .normal)
            delBtn.backgroundColor = red
            delBtn.titleLabel?.font = UIFont.systemFont(ofSize: 11, weight: .bold)
            delBtn.layer.cornerRadius = 6
            delBtn.fileURL = file
            delBtn.addTarget(self, action: #selector(deleteScriptPressed(_:)), for: .touchUpInside)
            delBtn.translatesAutoresizingMaskIntoConstraints = false
            row.addSubview(delBtn)
            
            NSLayoutConstraint.activate([
                row.heightAnchor.constraint(equalToConstant: 46),
                
                label.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 12),
                label.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                label.trailingAnchor.constraint(equalTo: editBtn.leadingAnchor, constant: -8),
                
                delBtn.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -8),
                delBtn.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                delBtn.widthAnchor.constraint(equalToConstant: 32),
                delBtn.heightAnchor.constraint(equalToConstant: 30),
                
                runBtn.trailingAnchor.constraint(equalTo: delBtn.leadingAnchor, constant: -6),
                runBtn.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                runBtn.widthAnchor.constraint(equalToConstant: 58),
                runBtn.heightAnchor.constraint(equalToConstant: 30),
                
                editBtn.trailingAnchor.constraint(equalTo: runBtn.leadingAnchor, constant: -6),
                editBtn.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                editBtn.widthAnchor.constraint(equalToConstant: 50),
                editBtn.heightAnchor.constraint(equalToConstant: 30)
            ])
            
            scriptStack.addArrangedSubview(row)
        }
    }
    
    @objc private func createScriptPressed() {
        let alert = UIAlertController(title: "Script mới", message: "Nhập tên file script kịch bản:", preferredStyle: .alert)
        alert.addTextField { tf in
            tf.placeholder = "tên_kịch_bản.lua"
        }
        alert.addAction(UIAlertAction(title: "Hủy", style: .cancel))
        alert.addAction(UIAlertAction(title: "Tạo", style: .default) { [weak self] _ in
            guard let self = self,
                  let name = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty else { return }
            let safeName = name.hasSuffix(".lua") ? name : name + ".lua"
            let file = self.getDocumentsDirectory().appendingPathComponent(safeName)
            let initial = "-- " + safeName + "\nlog(\"Bắt đầu kịch bản\")\n"
            try? initial.write(to: file, atomically: true, encoding: .utf8)
            self.loadAndRenderScripts()
            self.showToast("Đã tạo script: " + safeName)
        })
        present(alert, animated: true)
    }
    
    @objc private func runScriptPressed(_ sender: ScriptActionButton) {
        guard let file = sender.fileURL else { return }
        do {
            let content = try String(contentsOf: file, encoding: .utf8)
            WebSocketClient.shared.runScript(content: content, name: file.lastPathComponent)
            showToast("▶ Đang chạy: " + file.lastPathComponent)
        } catch {
            showToast("Lỗi đọc file kịch bản!")
        }
    }
    
    @objc private func editScriptPressed(_ sender: ScriptActionButton) {
        guard let file = sender.fileURL else { return }
        do {
            let content = try String(contentsOf: file, encoding: .utf8)
            let editVC = ScriptEditViewController(fileURL: file, initialContent: content) { [weak self] in
                self?.loadAndRenderScripts()
            }
            let nav = UINavigationController(rootViewController: editVC)
            present(nav, animated: true)
        } catch {
            showToast("Lỗi đọc file kịch bản!")
        }
    }
    
    @objc private func deleteScriptPressed(_ sender: ScriptActionButton) {
        guard let file = sender.fileURL else { return }
        let alert = UIAlertController(title: "Xóa script?", message: "Bạn có chắc chắn muốn xóa file \(file.lastPathComponent) không?", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Hủy", style: .cancel))
        alert.addAction(UIAlertAction(title: "Xóa", style: .destructive) { [weak self] _ in
            try? FileManager.default.removeItem(at: file)
            self?.loadAndRenderScripts()
            self?.showToast("Đã xóa file kịch bản.")
        })
        present(alert, animated: true)
    }
}

// MARK: - Custom UI Component helpers
class ScriptActionButton: UIButton {
    var fileURL: URL?
}

// MARK: - Local Lua Editor View Controller
class ScriptEditViewController: UIViewController {
    let fileURL: URL
    var onSave: (() -> Void)?
    
    private let textView = UITextView()
    private let bgColor = UIColor(red: 9/255, green: 13/255, blue: 22/255, alpha: 1)
    private let textColor = UIColor(red: 241/255, green: 245/255, blue: 249/255, alpha: 1)
    
    init(fileURL: URL, initialContent: String, onSave: (() -> Void)?) {
        self.fileURL = fileURL
        self.onSave = onSave
        super.init(nibName: nil, bundle: nil)
        self.textView.text = initialContent
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        title = fileURL.lastPathComponent
        view.backgroundColor = bgColor
        
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Đóng", style: .plain, target: self, action: #selector(closePressed))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Lưu", style: .done, target: self, action: #selector(savePressed))
        
        textView.backgroundColor = bgColor
        textView.textColor = textColor
        textView.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.keyboardDismissMode = .interactive
        textView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(textView)
        
        NSLayoutConstraint.activate([
            textView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            textView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            textView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        
        textView.becomeFirstResponder()
    }
    
    @objc private func closePressed() {
        dismiss(animated: true)
    }
    
    @objc private func savePressed() {
        do {
            try textView.text.write(to: fileURL, atomically: true, encoding: .utf8)
            onSave?()
            dismiss(animated: true)
        } catch {
            let alert = UIAlertController(title: "Lỗi", message: "Không thể lưu kịch bản!", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            present(alert, animated: true)
        }
    }
}

// MARK: - Notification Names
extension Notification.Name {
    static let wsConnected = Notification.Name("iControl.wsConnected")
    static let wsDisconnected = Notification.Name("iControl.wsDisconnected")
    static let wsLog = Notification.Name("iControl.wsLog")
}