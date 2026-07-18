import UIKit
import Foundation

// MARK: - Premium ViewController
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

    // Colors
    private let bgColor = UIColor(red: 8/255, green: 11/255, blue: 20/255, alpha: 1)
    private let surfaceColor = UIColor(red: 13/255, green: 18/255, blue: 32/255, alpha: 1)
    private let cardColor = UIColor(red: 18/255, green: 24/255, blue: 42/255, alpha: 1)
    private let accent = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 1)
    private let emerald = UIColor(red: 16/255, green: 185/255, blue: 129/255, alpha: 1)
    private let red = UIColor(red: 239/255, green: 68/255, blue: 68/255, alpha: 1)
    private let textPrimary = UIColor(red: 241/255, green: 245/255, blue: 249/255, alpha: 1)
    private let textMuted = UIColor(red: 100/255, green: 116/255, blue: 139/255, alpha: 1)

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
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Navigation Bar
    private func setupNavBar() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = surfaceColor
        appearance.titleTextAttributes = [.foregroundColor: textPrimary, .font: UIFont.systemFont(ofSize: 16, weight: .semibold)]
        navigationController?.navigationBar.standardAppearance = appearance
        navigationController?.navigationBar.scrollEdgeAppearance = appearance
        navigationController?.navigationBar.tintColor = accent
        title = "iOSControl"

        // Right button = QR Scan (placeholder)
        let infoBtn = UIBarButtonItem(image: UIImage(systemName: "info.circle"), style: .plain, target: self, action: #selector(showAbout))
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
            container.topAnchor.constraint(equalTo: parent.topAnchor, constant: 24),
            container.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            container.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            container.heightAnchor.constraint(equalToConstant: 80)
        ])
        
        // Icon
        let iconBg = UIView()
        iconBg.backgroundColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.15)
        iconBg.layer.cornerRadius = 16
        iconBg.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(iconBg)
        
        let icon = UIImageView(image: UIImage(systemName: "network"))
        icon.tintColor = accent
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false
        iconBg.addSubview(icon)
        
        let titleL = UILabel()
        titleL.text = "iOSControl Pro"
        titleL.font = UIFont.systemFont(ofSize: 24, weight: .bold)
        titleL.textColor = textPrimary
        titleL.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(titleL)
        
        let subL = UILabel()
        subL.text = "Remote Script Automation Agent"
        subL.font = UIFont.systemFont(ofSize: 12, weight: .medium)
        subL.textColor = textMuted
        subL.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(subL)
        
        NSLayoutConstraint.activate([
            iconBg.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            iconBg.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            iconBg.widthAnchor.constraint(equalToConstant: 56),
            iconBg.heightAnchor.constraint(equalToConstant: 56),
            
            icon.centerXAnchor.constraint(equalTo: iconBg.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: iconBg.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 28),
            icon.heightAnchor.constraint(equalToConstant: 28),
            
            titleL.leadingAnchor.constraint(equalTo: iconBg.trailingAnchor, constant: 14),
            titleL.topAnchor.constraint(equalTo: iconBg.topAnchor, constant: 6),
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
            statusCard.topAnchor.constraint(equalTo: prev.bottomAnchor, constant: 16),
            statusCard.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            statusCard.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            statusCard.heightAnchor.constraint(equalToConstant: 70)
        ])
        
        let titleL = cardSectionTitle("📡 Trạng Thái Kết Nối")
        statusCard.addSubview(titleL)
        
        wsStatusDot.backgroundColor = red
        wsStatusDot.layer.cornerRadius = 5
        wsStatusDot.translatesAutoresizingMaskIntoConstraints = false
        statusCard.addSubview(wsStatusDot)
        
        wsStatusLabel.text = "Chưa kết nối"
        wsStatusLabel.font = UIFont.systemFont(ofSize: 13, weight: .medium)
        wsStatusLabel.textColor = textMuted
        wsStatusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusCard.addSubview(wsStatusLabel)
        
        batteryLabel.font = UIFont.systemFont(ofSize: 12, weight: .regular)
        batteryLabel.textColor = textMuted
        batteryLabel.translatesAutoresizingMaskIntoConstraints = false
        statusCard.addSubview(batteryLabel)
        
        timeLabel.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        timeLabel.textColor = accent
        timeLabel.textAlignment = .right
        timeLabel.translatesAutoresizingMaskIntoConstraints = false
        statusCard.addSubview(timeLabel)
        
        NSLayoutConstraint.activate([
            titleL.topAnchor.constraint(equalTo: statusCard.topAnchor, constant: 12),
            titleL.leadingAnchor.constraint(equalTo: statusCard.leadingAnchor, constant: 14),
            
            wsStatusDot.leadingAnchor.constraint(equalTo: statusCard.leadingAnchor, constant: 14),
            wsStatusDot.bottomAnchor.constraint(equalTo: statusCard.bottomAnchor, constant: -14),
            wsStatusDot.widthAnchor.constraint(equalToConstant: 10),
            wsStatusDot.heightAnchor.constraint(equalToConstant: 10),
            
            wsStatusLabel.leadingAnchor.constraint(equalTo: wsStatusDot.trailingAnchor, constant: 8),
            wsStatusLabel.centerYAnchor.constraint(equalTo: wsStatusDot.centerYAnchor),
            
            batteryLabel.leadingAnchor.constraint(equalTo: wsStatusLabel.trailingAnchor, constant: 12),
            batteryLabel.centerYAnchor.constraint(equalTo: wsStatusDot.centerYAnchor),
            
            timeLabel.trailingAnchor.constraint(equalTo: statusCard.trailingAnchor, constant: -14),
            timeLabel.centerYAnchor.constraint(equalTo: wsStatusDot.centerYAnchor),
        ])
    }
    
    // MARK: - Server Control Card (v5.4)
    private func buildServerControlCard(in parent: UIView) {
        let prev = parent.subviews.last!
        styleCard(serverCard)
        serverCard.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(serverCard)
        
        let titleL = cardSectionTitle("🖥️ MÁY CHỦ DASHBOARD (LOCAL)")
        serverCard.addSubview(titleL)
        
        let statusDot = UIView()
        statusDot.backgroundColor = emerald
        statusDot.layer.cornerRadius = 6
        statusDot.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(statusDot)
        
        let statusText = UILabel()
        statusText.text = "Máy chủ đang chạy ngầm liên tục"
        statusText.textColor = emerald
        statusText.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        statusText.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(statusText)
        
        let ip = WebSocketClient.shared.getWiFiAddress() ?? "127.0.0.1"
        let urlStr = "http://\(ip):9898"
        
        let urlContainer = UIView()
        urlContainer.backgroundColor = UIColor(red: 8/255, green: 11/255, blue: 20/255, alpha: 1)
        urlContainer.layer.cornerRadius = 10
        urlContainer.layer.borderWidth = 1
        urlContainer.layer.borderColor = UIColor(white: 1, alpha: 0.1).cgColor
        urlContainer.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(urlContainer)
        
        let urlLabel = UILabel()
        urlLabel.text = urlStr
        urlLabel.textColor = textPrimary
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
        copyBtn.setTitle("📋 Sao chép URL", for: .normal)
        copyBtn.setTitleColor(.white, for: .normal)
        copyBtn.backgroundColor = accent
        copyBtn.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .bold)
        copyBtn.layer.cornerRadius = 8
        copyBtn.addTarget(self, action: #selector(copyServerUrl), for: .touchUpInside)
        copyBtn.translatesAutoresizingMaskIntoConstraints = false
        serverCard.addSubview(copyBtn)
        
        NSLayoutConstraint.activate([
            serverCard.topAnchor.constraint(equalTo: prev.bottomAnchor, constant: 12),
            serverCard.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: 20),
            serverCard.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -20),
            serverCard.heightAnchor.constraint(equalToConstant: 180),
            
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
            
            copyBtn.topAnchor.constraint(equalTo: descLabel.bottomAnchor, constant: 12),
            copyBtn.leadingAnchor.constraint(equalTo: serverCard.leadingAnchor, constant: 14),
            copyBtn.trailingAnchor.constraint(equalTo: serverCard.trailingAnchor, constant: -14),
            copyBtn.heightAnchor.constraint(equalToConstant: 36)
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
        
        let titleL = cardSectionTitle("👁 Overlay HUD")
        card.addSubview(titleL)
        
        let sub = UILabel()
        sub.text = "Hiển thị log nổi trên màn hình"
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
        
        let titleL = cardSectionTitle("📋 Activity Log")
        card.addSubview(titleL)
        
        let clearBtn = UIButton(type: .system)
        clearBtn.setTitle("Xóa", for: .normal)
        clearBtn.setTitleColor(textMuted, for: .normal)
        clearBtn.titleLabel?.font = UIFont.systemFont(ofSize: 12)
        clearBtn.addTarget(self, action: #selector(clearLog), for: .touchUpInside)
        clearBtn.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(clearBtn)
        
        logTextView.backgroundColor = UIColor(red: 8/255, green: 11/255, blue: 20/255, alpha: 1)
        logTextView.textColor = UIColor(red: 100/255, green: 200/255, blue: 150/255, alpha: 1)
        logTextView.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        logTextView.isEditable = false
        logTextView.layer.cornerRadius = 8
        logTextView.text = "── Agent Ready ──"
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
        label.text = "iOSControl Pro v3.0 • Powered by iControl Engine"
        label.font = UIFont.systemFont(ofSize: 10)
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
        card.layer.borderColor = UIColor(white: 1, alpha: 0.05).cgColor
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOffset = CGSize(width: 0, height: 4)
        card.layer.shadowRadius = 12
        card.layer.shadowOpacity = 0.3
    }
    
    private func cardSectionTitle(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        l.textColor = textMuted
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }
    
    private func styleField(_ field: PaddedTextField, placeholder: String, icon: String) {
        field.placeholder = placeholder
        field.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: textMuted])
        field.backgroundColor = UIColor(red: 8/255, green: 11/255, blue: 20/255, alpha: 1)
        field.textColor = textPrimary
        field.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
        field.layer.cornerRadius = 10
        field.layer.borderWidth = 1
        field.layer.borderColor = UIColor(white: 1, alpha: 0.07).cgColor
        field.leftPadding = 12
        field.translatesAutoresizingMaskIntoConstraints = false
        
        // Edit focus
        field.addTarget(self, action: #selector(fieldFocused(_:)), for: .editingDidBegin)
        field.addTarget(self, action: #selector(fieldBlurred(_:)), for: .editingDidEnd)
    }
    
    private func applyGradientToCard(_ card: UIView) {
        if let sublayers = card.layer.sublayers, sublayers.contains(where: { $0 is CAGradientLayer }) { return }
        let grad = CAGradientLayer()
        grad.frame = card.bounds
        grad.cornerRadius = 16
        grad.colors = [
            UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.08).cgColor,
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
        
        // Send battery to server if connected
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
    
    @objc private func fieldFocused(_ field: UITextField) {
        UIView.animate(withDuration: 0.2) {
            field.layer.borderColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 0.6).cgColor
        }
    }
    
    @objc private func fieldBlurred(_ field: UITextField) {
        UIView.animate(withDuration: 0.2) {
            field.layer.borderColor = UIColor(white: 1, alpha: 0.07).cgColor
        }
    }
    
    @objc private func showAbout() {
        let alert = UIAlertController(title: "iOSControl Pro v3.0", message: "Remote Script Automation Agent\n\nKết nối máy tính qua WiFi để điều khiển tự động.\n\n© 2026 iControl Team", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
    
    // MARK: - Connected/Disconnected observers
    @objc private func onDeviceConnected() {
        DispatchQueue.main.async {
            self.setConnectedUI(true)
            self.appendLog("✅ Đã kết nối với server")
        }
    }
    
    @objc private func onDeviceDisconnected() {
        DispatchQueue.main.async {
            self.setConnectedUI(false)
            self.appendLog("❌ Mất kết nối server")
        }
    }
    
    @objc private func onLogReceived(_ notification: Notification) {
        guard let msg = notification.userInfo?["message"] as? String else { return }
        DispatchQueue.main.async { self.appendLog(msg) }
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
        let trimmed = lines.suffix(50).joined(separator: "\n") // Keep last 50 lines
        logTextView.text = trimmed + "\n" + line
        let range = NSRange(location: logTextView.text.count - 1, length: 1)
        logTextView.scrollRangeToVisible(range)
    }
    
    private func showToast(_ msg: String) {
        let toast = UILabel()
        toast.text = "  \(msg)  "
        toast.font = UIFont.systemFont(ofSize: 13, weight: .medium)
        toast.textColor = .white
        toast.backgroundColor = UIColor(red: 30/255, green: 38/255, blue: 60/255, alpha: 0.95)
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
    
    // MARK: - Script Manager Card Layout (v5.2)
    private func buildScriptCard(in parent: UIView) {
        let prev = parent.subviews.last!
        styleCard(scriptCard)
        scriptCard.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(scriptCard)
        
        let titleL = cardSectionTitle("📁 QUẢN LÝ & CHẠY SCRIPT LUA")
        scriptCard.addSubview(titleL)
        
        let addBtn = UIButton(type: .system)
        addBtn.setTitle("➕ Tạo Script", for: .normal)
        addBtn.setTitleColor(accent, for: .normal)
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
        // Clear old list
        for view in scriptStack.arrangedSubviews {
            scriptStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        
        let docs = getDocumentsDirectory()
        guard let files = try? FileManager.default.contentsOfDirectory(at: docs, includingPropertiesForKeys: nil) else { return }
        let luaFiles = files.filter { $0.pathExtension == "lua" }.sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
        
        for file in luaFiles {
            let row = UIView()
            row.backgroundColor = bgColor
            row.layer.cornerRadius = 8
            row.layer.borderWidth = 0.5
            row.layer.borderColor = UIColor(white: 1, alpha: 0.1).cgColor
            row.translatesAutoresizingMaskIntoConstraints = false
            
            let label = UILabel()
            label.text = file.lastPathComponent
            label.textColor = textPrimary
            label.font = UIFont.systemFont(ofSize: 13, weight: .medium)
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
                row.heightAnchor.constraint(equalToConstant: 44),
                
                label.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 10),
                label.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                label.trailingAnchor.constraint(equalTo: editBtn.leadingAnchor, constant: -8),
                
                delBtn.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -8),
                delBtn.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                delBtn.widthAnchor.constraint(equalToConstant: 30),
                delBtn.heightAnchor.constraint(equalToConstant: 28),
                
                runBtn.trailingAnchor.constraint(equalTo: delBtn.leadingAnchor, constant: -6),
                runBtn.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                runBtn.widthAnchor.constraint(equalToConstant: 54),
                runBtn.heightAnchor.constraint(equalToConstant: 28),
                
                editBtn.trailingAnchor.constraint(equalTo: runBtn.leadingAnchor, constant: -6),
                editBtn.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                editBtn.widthAnchor.constraint(equalToConstant: 46),
                editBtn.heightAnchor.constraint(equalToConstant: 28)
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

// MARK: - Custom UI Component helpers (v5.2)
class ScriptActionButton: UIButton {
    var fileURL: URL?
}

// MARK: - Local Lua Editor View Controller (v5.2)
class ScriptEditViewController: UIViewController {
    let fileURL: URL
    var onSave: (() -> Void)?
    
    private let textView = UITextView()
    private let bgColor = UIColor(red: 8/255, green: 11/255, blue: 20/255, alpha: 1)
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
        
        // Save & Cancel button
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

// MARK: - PaddedTextField
class PaddedTextField: UITextField {
    var leftPadding: CGFloat = 12
    override func textRect(forBounds bounds: CGRect) -> CGRect { bounds.inset(by: UIEdgeInsets(top: 0, left: leftPadding, bottom: 0, right: 12)) }
    override func editingRect(forBounds bounds: CGRect) -> CGRect { bounds.inset(by: UIEdgeInsets(top: 0, left: leftPadding, bottom: 0, right: 12)) }
}

// MARK: - Notification Names
extension Notification.Name {
    static let wsConnected = Notification.Name("iControl.wsConnected")
    static let wsDisconnected = Notification.Name("iControl.wsDisconnected")
    static let wsLog = Notification.Name("iControl.wsLog")
}