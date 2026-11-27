import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        let controller = CAPBridgeViewController()
        window?.rootViewController = controller
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
#if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--allnote-smoke") {
            Task { await runStudioSmoke(controller) }
        }
#endif
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
#if DEBUG && targetEnvironment(simulator)
    @MainActor
    private func runStudioSmoke(_ controller: CAPBridgeViewController) async {
        let report = URL.cachesDirectory.appendingPathComponent("allnote-smoke.txt")
        func wait(_ condition: String) async -> Bool {
            for _ in 0..<160 {
                if let webView = controller.webView,
                   (try? await webView.evaluateJavaScript("Boolean(" + condition + ")")) as? Bool == true {
                    return true
                }
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
            return false
        }
        guard await wait("window.AllNoteNativeFiles && document.querySelector('#pdf-app[aria-busy=false]')"),
              let webView = controller.webView else {
            try? "FAIL: App or native bridge did not load".write(to: report, atomically: true, encoding: .utf8)
            return
        }
        let openFixture = """
        void (async () => {
          const pdf = await PDFLib.PDFDocument.create();
          pdf.addPage([612, 792]).drawText('AllNote iOS offline fixture');
          const input = new DataTransfer();
          input.items.add(new File([await pdf.save()], 'ios-fixture.pdf', {type:'application/pdf'}));
          document.querySelector('#paper').dispatchEvent(new DragEvent('drop', {dataTransfer:input}));
        })();
        """
        _ = try? await webView.evaluateJavaScript(openFixture)
        let opened = await wait("document.querySelector('#position')?.textContent === '1 / 1'")
        let message = opened ? "PASS: Bundled PDF rendered in WKWebView" : "FAIL: Bundled PDF did not render"
        try? message.write(to: report, atomically: true, encoding: .utf8)
    }
#endif

}
