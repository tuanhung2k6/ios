import UIKit

class ViewController: UIViewController {

    // UI Elements
    private let titleLabel = UILabel()
    private let ipLabel = UILabel()
    private let ipTextField = UITextField()
    private let portLabel = UILabel()
    private let portTextField = UITextField()
    private let connectButton = UIButton(type: .system)
    private let hudLabel = UILabel()
    private let hudSwitch = UISwitch()
    
    private var isConnected = false

    override func viewDidLoad() {
        super.viewDidLoad()
        setupBackground()
        setupUI()
        loadSavedSettings()
    }
    
    private func setupBackground() {
        self.title = "iControl iOS Agent"
        self.view.backgroundColor = UIColor(red: 11/255, green: 15/255, blue: 25/255, alpha: 1.0)
        self.navigationController?.navigationBar.barTintColor = UIColor(red: 14/255, green: 20/255, blue: 36/255, alpha: 1.0)
        self.navigationController?.navigationBar.titleTextAttributes = [.foregroundColor: UIColor.white]
    }
    
    private func setupUI() {
        // App Title
        titleLabel.text = "IOS CONTROL SYSTEM"
        titleLabel.font = UIFont.systemFont(ofSize: 22, weight: .bold)
        titleLabel.textColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 1.0) // Indigo
        titleLabel.textAlignment = .center
        titleLabel.frame = CGRect(x: 20, y: 120, width: self.view.frame.width - 40, height: 30)
        self.view.addSubview(titleLabel)
        
        // IP Input Field
        ipLabel.text = "Địa chỉ IP Máy Chủ (Server IP)"
        ipLabel.textColor = .lightGray
        ipLabel.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        ipLabel.frame = CGRect(x: 30, y: 180, width: self.view.frame.width - 60, height: 20)
        self.view.addSubview(ipLabel)
        
        ipTextField.placeholder = "192.168.1.100"
        ipTextField.backgroundColor = UIColor(red: 20/255, green: 26/255, blue: 42/255, alpha: 1.0)
        ipTextField.textColor = .white
        ipTextField.borderStyle = .roundedRect
        ipTextField.keyboardType = .decimalPad
        ipTextField.frame = CGRect(x: 30, y: 205, width: self.view.frame.width - 60, height: 40)
        self.view.addSubview(ipTextField)
        
        // Port Input Field
        portLabel.text = "Cổng kết nối (Port)"
        portLabel.textColor = .lightGray
        portLabel.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        portLabel.frame = CGRect(x: 30, y: 260, width: self.view.frame.width - 60, height: 20)
        self.view.addSubview(portLabel)
        
        portTextField.placeholder = "3000"
        portTextField.backgroundColor = UIColor(red: 20/255, green: 26/255, blue: 42/255, alpha: 1.0)
        portTextField.textColor = .white
        portTextField.borderStyle = .roundedRect
        portTextField.keyboardType = .numberPad
        portTextField.frame = CGRect(x: 30, y: 285, width: self.view.frame.width - 60, height: 40)
        self.view.addSubview(portTextField)
        
        // HUD Overlay Toggle Switch
        hudLabel.text = "Hiển thị thông báo nổi (Floating Overlay HUD)"
        hudLabel.textColor = .lightGray
        hudLabel.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        hudLabel.frame = CGRect(x: 30, y: 350, width: self.view.frame.width - 120, height: 20)
        self.view.addSubview(hudLabel)
        
        hudSwitch.onTintColor = UIColor(red: 99/255, green: 102/255, blue: 241/255, alpha: 1.0)
        hudSwitch.isOn = false
        hudSwitch.addTarget(self, action: #selector(hudSwitchChanged), for: .valueChanged)
        hudSwitch.frame = CGRect(x: self.view.frame.width - 80, y: 345, width: 50, height: 30)
        self.view.addSubview(hudSwitch)
        
        // Connect Button
        connectButton.setTitle("KẾT NỐI MÁY CHỦ", for: .normal)
        connectButton.backgroundColor = UIColor(red: 16/255, green: 185/255, blue: 129/255, alpha: 1.0) // Emerald
        connectButton.setTitleColor(.white, for: .normal)
        connectButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        connectButton.layer.cornerRadius = 8
        connectButton.addTarget(self, action: #selector(connectButtonPressed), for: .touchUpInside)
        connectButton.frame = CGRect(x: 30, y: 410, width: self.view.frame.width - 60, height: 48)
        self.view.addSubview(connectButton)
    }
    
    private func loadSavedSettings() {
        let savedIP = UserDefaults.standard.string(forKey: "iControl_server_ip") ?? "192.168.1.100"
        let savedPort = UserDefaults.standard.string(forKey: "iControl_server_port") ?? "3000"
        
        ipTextField.text = savedIP
        portTextField.text = savedPort
    }
    
    @objc private func connectButtonPressed() {
        self.view.endEditing(true)
        
        guard let ip = ipTextField.text, !ip.isEmpty else { return }
        let port = portTextField.text ?? "3000"
        
        // Save settings
        UserDefaults.standard.set(ip, forKey: "iControl_server_ip")
        UserDefaults.standard.set(port, forKey: "iControl_server_port")
        
        if isConnected {
            WebSocketClient.shared.disconnect()
            connectButton.setTitle("KẾT NỐI MÁY CHỦ", for: .normal)
            connectButton.backgroundColor = UIColor(red: 16/255, green: 185/255, blue: 129/255, alpha: 1.0)
            isConnected = false
        } else {
            WebSocketClient.shared.connect(ip: ip, port: port)
            connectButton.setTitle("NGẮT KẾT NỐI", for: .normal)
            connectButton.backgroundColor = UIColor(red: 239/255, green: 68/255, blue: 68/255, alpha: 1.0) // Red
            isConnected = true
        }
    }
    
    @objc private func hudSwitchChanged() {
        if hudSwitch.isOn {
            FloatingWindow.shared.showHUD()
        } else {
            FloatingWindow.shared.hideHUD()
        }
    }
}
