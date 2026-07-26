import UIKit
import AVFoundation

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var audioPlayer: AVAudioPlayer?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("[iControlApp] Application started.")
        
        // Start Local HTTP/WebSocket Server on port 9898
        LocalServer.shared.start(port: 9898)
        
        // Start background survival audio loop
        setupBackgroundAudio()
        
        // Initialize UIWindow directly (iOS 12 and below style, robust for direct compilation)
        window = UIWindow(frame: UIScreen.main.bounds)
        let mainVC = ViewController()
        let navVC = UINavigationController(rootViewController: mainVC)
        window?.rootViewController = navVC
        window?.makeKeyAndVisible()
        
        return true
    }
    
    private func setupBackgroundAudio() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            
            let wavData = createSilenceWavData()
            audioPlayer = try AVAudioPlayer(data: wavData)
            audioPlayer?.numberOfLoops = -1 // loop infinitely
            audioPlayer?.volume = 0.01 // silent volume
            audioPlayer?.prepareToPlay()
            audioPlayer?.play()
            print("[AppDelegate] Background silent audio loop playing.")
        } catch {
            print("[AppDelegate] Failed to setup background audio: \(error)")
        }
    }
    
    private func createSilenceWavData() -> Data {
        var header = Data()
        
        // RIFF header
        header.append(contentsOf: [UInt8]("RIFF".utf8))
        let fileSize: UInt32 = 44 + 8000 - 8
        var size = fileSize.littleEndian
        withUnsafeBytes(of: &size) { header.append(contentsOf: $0) }
        header.append(contentsOf: [UInt8]("WAVE".utf8))
        
        // fmt subchunk
        header.append(contentsOf: [UInt8]("fmt ".utf8))
        var subchunk1Size: UInt32 = 16
        withUnsafeBytes(of: &subchunk1Size) { header.append(contentsOf: $0) }
        
        var audioFormat: UInt16 = 1 // PCM
        withUnsafeBytes(of: &audioFormat) { header.append(contentsOf: $0) }
        
        var numChannels: UInt16 = 1 // Mono
        withUnsafeBytes(of: &numChannels) { header.append(contentsOf: $0) }
        
        var sampleRate: UInt32 = 8000
        withUnsafeBytes(of: &sampleRate) { header.append(contentsOf: $0) }
        
        var byteRate: UInt32 = 8000
        withUnsafeBytes(of: &byteRate) { header.append(contentsOf: $0) }
        
        var blockAlign: UInt16 = 1
        withUnsafeBytes(of: &blockAlign) { header.append(contentsOf: $0) }
        
        var bitsPerSample: UInt16 = 8
        withUnsafeBytes(of: &bitsPerSample) { header.append(contentsOf: $0) }
        
        // data subchunk
        header.append(contentsOf: [UInt8]("data".utf8))
        var subchunk2Size: UInt32 = 8000
        withUnsafeBytes(of: &subchunk2Size) { header.append(contentsOf: $0) }
        
        // 8-bit PCM silence is 0x80 (128)
        let silence = [UInt8](repeating: 128, count: 8000)
        header.append(contentsOf: silence)
        
        return header
    }
}
