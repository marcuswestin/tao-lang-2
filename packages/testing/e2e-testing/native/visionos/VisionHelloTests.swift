import XCTest
import WebKit
import UIKit
@testable import TaoApp

// Copied into the exported visionOS app-hosted test target by `tao build --visionos`.
final class VisionHelloTests: XCTestCase {
    @MainActor
    func testCounterInBundledWebKit() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundledSite(), forURLScheme: "tao-app")
        configuration.userContentController.addUserScript(WKUserScript(source: """
            window.taoTestErrors = [];
            window.addEventListener('error', event => {
                window.taoTestErrors.push(event.message || ('Resource failed: ' + (event.target.src || event.target.href || event.target.tagName)));
            }, true);
            window.addEventListener('unhandledrejection', event => {
                window.taoTestErrors.push('Unhandled rejection: ' + String(event.reason));
            });
            """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 640, height: 480), configuration: configuration)
        let window = try XCTUnwrap(UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow })
        window.addSubview(webView)
        defer {
            webView.stopLoading()
            webView.removeFromSuperview()
        }
        webView.load(URLRequest(url: try XCTUnwrap(URL(string: "tao-app://bundle/index.html"))))
        try await waitForCount(0, in: webView)
        try await click("Increment", in: webView)
        try await waitForCount(1, in: webView)
        try await click("Increment", in: webView)
        try await waitForCount(2, in: webView)
        try await click("Reset", in: webView)
        try await waitForCount(0, in: webView)
        let errors = try await webView.evaluateJavaScript("JSON.stringify(window.taoTestErrors || [])") as? String
        XCTAssertEqual(errors, "[]", "WebKit reported a script or resource error")
    }

    @MainActor
    private func click(_ label: String, in webView: WKWebView) async throws {
        let encoded = String(data: try JSONEncoder().encode(label), encoding: .utf8)!
        let clicked = try await webView.evaluateJavaScript("""
            (() => {
                const button = [...document.querySelectorAll('button, [role="button"]')]
                    .find(element => element.textContent.trim() === \(encoded));
                if (!button) return false;
                button.click();
                return true;
            })()
            """) as? Bool
        XCTAssertEqual(clicked, true, "Missing rendered button: \(label)")
    }

    @MainActor
    private func waitForCount(_ count: Int, in webView: WKWebView) async throws {
        let deadline = Date().addingTimeInterval(30)
        var body = ""
        var evaluationError = ""
        repeat {
            do {
                body = try await webView.evaluateJavaScript("document.body ? document.body.innerText : ''") as? String ?? ""
                if body.range(of: "Count:\\s*\(count)(?!\\d)", options: .regularExpression) != nil {
                    return
                }
            } catch {
                evaluationError = error.localizedDescription
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        } while Date() < deadline
        let errors = try? await webView.evaluateJavaScript("JSON.stringify(window.taoTestErrors || [])")
        XCTFail("Timed out waiting for Count: \(count). Body: \(body). Evaluation: \(evaluationError). Script/resource errors: \(String(describing: errors))")
        throw CounterTimeout()
    }

    private struct CounterTimeout: Error {}
}
