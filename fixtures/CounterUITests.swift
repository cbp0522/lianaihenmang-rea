import XCTest

final class CounterUITests: XCTestCase {
    func testObservedCounterFlow() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let label = app.staticTexts["当前数值 0"]
        XCTAssertTrue(label.waitForExistence(timeout: 10))
        attachScreen(app, named: "实机或模拟器-初始")
        app.buttons["增加一次"].tap()
        XCTAssertTrue(app.staticTexts["当前数值 1"].exists)
        attachScreen(app, named: "实机或模拟器-增加")
        app.buttons["归零"].tap()
        XCTAssertTrue(label.exists)
        attachScreen(app, named: "实机或模拟器-归零")
    }

    private func attachScreen(_ app: XCUIApplication, named name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
