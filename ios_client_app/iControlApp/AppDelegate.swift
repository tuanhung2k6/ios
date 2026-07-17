import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("[iControlApp] Application started.")
        
        // Initialize UIWindow directly (iOS 12 and below style, robust for direct compilation)
        window = UIWindow(frame: UIScreen.main.bounds)
        let mainVC = ViewController()
        let navVC = UINavigationController(rootViewController: mainVC)
        window?.rootViewController = navVC
        window?.makeKeyAndVisible()
        
        return true
    }
}
