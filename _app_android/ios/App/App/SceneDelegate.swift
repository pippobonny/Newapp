import UIKit
import Capacitor
import AuthenticationServices

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = SeevaViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/* seeva (2026-10-29): sull'iPhone non c'e il tasto "indietro" di Android,
   quindi si attiva il gesto classico: scorrere dal bordo sinistro dello
   schermo verso destra torna alla pagina precedente (come in Safari). */
class SeevaViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
        // "Continua con Apple" (2026-10-29): pezzetto nativo qui sotto
        bridge?.registerPluginInstance(SeevaAppleSignInPlugin())
    }
}

/* seeva (2026-10-29): "Continua con Apple" nell'app iPhone.
   Dalla pagina (data.js, signInWithApple) si chiama
   Capacitor.registerPlugin('SeevaAppleSignIn').signIn({ nonce }):
   si apre il riquadro di Apple (Face ID) e si restituisce alla pagina il
   token firmato da Apple + nome e cognome (Apple li da solo la prima volta)
   + email. Il token lo verifica poi Supabase (provider Apple). */
@objc(SeevaAppleSignInPlugin)
public class SeevaAppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "SeevaAppleSignInPlugin"
    public let jsName = "SeevaAppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var controller: ASAuthorizationController?

    @objc func signIn(_ call: CAPPluginCall) {
        let nonce = call.getString("nonce") ?? ""
        DispatchQueue.main.async {
            if let old = self.pendingCall {
                old.reject("Accesso con Apple interrotto", "CANCELED")
            }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            if !nonce.isEmpty { request.nonce = nonce }
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.pendingCall = call
            self.controller = controller
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return self.bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        self.controller = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple non ha restituito il token di accesso")
            return
        }
        call.resolve([
            "identityToken": token,
            "user": credential.user,
            "email": credential.email ?? "",
            "givenName": credential.fullName?.givenName ?? "",
            "familyName": credential.fullName?.familyName ?? ""
        ])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        self.controller = nil
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("Accesso con Apple annullato", "CANCELED")
            return
        }
        call.reject(error.localizedDescription)
    }
}
