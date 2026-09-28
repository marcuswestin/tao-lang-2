import XCTest

// Copied into the generated UI-test target by the Tao test orchestration layer.
final class WatchJourneyTests: XCTestCase {
    private struct Position: Decodable { let line: Int; let character: Int }
    private struct Range: Decodable { let start: Position; let end: Position }
    private struct Source: Decodable {
        let filePath: String
        let range: Range?
        var marker: String {
            guard let start = range?.start else { return filePath }
            return "\(filePath):\(start.line + 1):\(start.character + 1)"
        }
    }
    private enum Kind: String, Decodable { case run, press, expect, expectNavigationTitle }
    private struct Operation: Decodable {
        let kind: Kind
        let source: Source
        let appName: String?
        let appSourcePath: String?
        let text: String?
        let missing: Bool?
        let title: String?
    }
    private struct Plan: Decodable {
        let version: Int
        let bundleIdentifier: String
        let check: String
        let sourcePath: String
        let operations: [Operation]
    }
    private enum JourneyFailure: Error { case invalid(String), assertion }

    func testJourney() throws {
        continueAfterFailure = false
        let bundle = Bundle(for: WatchJourneyTests.self)
        let resource = try XCTUnwrap(bundle.url(forResource: "WatchJourneyPlan", withExtension: "json"))
        let data = try Data(contentsOf: resource)
        let plan = try JSONDecoder().decode(Plan.self, from: data)
        try validate(plan, data: data)
        let app = XCUIApplication(bundleIdentifier: plan.bundleIdentifier)
        defer { app.terminate() }
        do {
            for operation in plan.operations {
                try XCTContext.runActivity(named: "\(operation.source.marker) — \(operation.kind.rawValue)") { _ in
                    switch operation.kind {
                    case .run:
                        app.launch()
                    case .press:
                        let button = app.buttons.matching(NSPredicate(format: "label == %@", operation.text!))
                        try require(button.firstMatch.waitForExistence(timeout: 30), "Missing button '\(operation.text!)'", operation)
                        try require(button.count == 1, "Ambiguous button '\(operation.text!)'", operation)
                        // Tapping a disabled control is legal in a Tao journey: its action must not fire.
                        if button.element.isEnabled { button.element.tap() }
                    case .expect:
                        let label = app.staticTexts.matching(NSPredicate(format: "label == %@", operation.text!)).firstMatch
                        let predicate = NSPredicate(format: "exists == %@", NSNumber(value: !operation.missing!))
                        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: label)
                        try require(XCTWaiter.wait(for: [expectation], timeout: 30) == .completed,
                                    "Expected \(operation.missing! ? "missing" : "visible") text '\(operation.text!)'", operation)
                    case .expectNavigationTitle:
                        let title = app.navigationBars.matching(identifier: operation.title!).firstMatch
                        try require(title.waitForExistence(timeout: 30), "Expected native navigation title '\(operation.title!)'", operation)
                    }
                }
            }
        } catch JourneyFailure.assertion {
            return // The source-linked XCTest issue was recorded by require.
        }
    }

    private func require(_ condition: Bool, _ message: String, _ operation: Operation) throws {
        guard condition else {
            let location = XCTSourceCodeLocation(fileURL: URL(fileURLWithPath: operation.source.filePath),
                                                 lineNumber: (operation.source.range?.start.line ?? 0) + 1)
            record(XCTIssue(type: .assertionFailure, compactDescription: "\(operation.source.marker): \(message)",
                            sourceCodeContext: XCTSourceCodeContext(location: location)))
            throw JourneyFailure.assertion
        }
    }

    // Decode and validate the entire plan before launching anything, including foreign JSON input.
    private func validate(_ plan: Plan, data: Data) throws {
        guard plan.version == 1, !plan.bundleIdentifier.isEmpty, !plan.operations.isEmpty,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(json.keys) == Set(["version", "bundleIdentifier", "check", "sourcePath", "operations"]),
              let operations = json["operations"] as? [[String: Any]] else {
            throw JourneyFailure.invalid("Invalid watch journey plan")
        }
        for (index, operation) in plan.operations.enumerated() {
            let payload: Set<String>
            switch operation.kind {
            case .run:
                guard index == 0, operation.appName?.isEmpty == false, operation.appSourcePath?.isEmpty == false else {
                    throw JourneyFailure.invalid("\(operation.source.marker): Invalid run")
                }
                payload = ["appName", "appSourcePath"]
            case .press:
                guard index > 0, operation.text?.isEmpty == false else {
                    throw JourneyFailure.invalid("\(operation.source.marker): Invalid press")
                }
                payload = ["text"]
            case .expect:
                guard index > 0, operation.text?.isEmpty == false, operation.missing != nil else {
                    throw JourneyFailure.invalid("\(operation.source.marker): Invalid text expectation")
                }
                payload = ["text", "missing"]
            case .expectNavigationTitle:
                guard index > 0, operation.title?.isEmpty == false else {
                    throw JourneyFailure.invalid("\(operation.source.marker): Invalid navigation title")
                }
                payload = ["title"]
            }
            guard Set(operations[index].keys) == payload.union(["kind", "source"]) else {
                throw JourneyFailure.invalid("\(operation.source.marker): Unsupported operation payload")
            }
        }
    }
}
