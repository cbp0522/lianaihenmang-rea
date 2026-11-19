import Foundation

private enum TestFailure: Error {
    case expectation(String)
    case storage
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw TestFailure.expectation(message) }
}

private struct FailingStore: RoundCountStore {
    var failsOnLoad = false
    func load() throws -> Int {
        if failsOnLoad { throw TestFailure.storage }
        return 3
    }
    func save(_ count: Int) throws { throw TestFailure.storage }
}

@main
struct RoundCounterTests {
    @MainActor
    static func main() throws {
        let scenario = CommandLine.arguments[1]
        let store = LocalRoundCountStore(fileURL: URL(fileURLWithPath: CommandLine.arguments[2]))
        let model = RoundCounter(store: store)

        switch scenario {
        case "fresh":
            try expect(model.count == 0, "首次打开应为 0 轮")
            try expect(model.storageError == nil, "首次打开不应报错")
            try expect(!model.canUndo, "0 轮应禁用撤销")
            try expect(!model.canStartNewSession, "0 轮应禁用新会话")
            model.undoRound()
            model.requestNewSession()
            try expect(model.count == 0, "撤销不能产生负数")
            try expect(!model.isNewSessionRequested, "0 轮不能请求新会话")
        case "record":
            model.recordRound()
            try expect(model.count == 1, "记录一次应加一")
            try expect(model.canUndo && model.canStartNewSession, "有记录时应启用底部操作")
            try expect(tryLoad(store) == 1, "记录应立即保存")
            let recreated = RoundCounter(store: store)
            try expect(recreated.count == 1, "重建模型应恢复记录")
        case "undo":
            model.recordRound()
            model.recordRound()
            model.undoRound()
            try expect(model.count == 1, "撤销一次应减一")
            try expect(tryLoad(store) == 1, "撤销应立即保存")
            model.undoRound()
            model.undoRound()
            try expect(model.count == 0 && !model.canUndo, "撤销至 0 后禁用")
            try expect(RoundCounter(store: store).count == 0, "撤销到 0 后应保存")
        case "rapid":
            for _ in 0..<1000 { model.recordRound() }
            try expect(model.count == 1000, "快速连点应逐次累计")
            try expect(RoundCounter(store: store).count == 1000, "快速连点结果应保存")
            for _ in 0..<1001 { model.undoRound() }
            try expect(model.count == 0, "快速撤销不应产生负数")
        case "cancel":
            model.recordRound()
            model.recordRound()
            model.requestNewSession()
            try expect(model.isNewSessionRequested, "新会话应先等待确认")
            try expect(model.count == 2 && tryLoad(store) == 2, "请求确认时不能清零")
            model.cancelNewSession()
            model.confirmNewSession()
            try expect(!model.isNewSessionRequested, "取消应关闭确认")
            try expect(model.count == 2, "取消后应保留当前数值")
            try expect(RoundCounter(store: store).count == 2, "取消后持久化数值应保留")
        case "confirm":
            model.recordRound()
            model.requestNewSession()
            model.confirmNewSession()
            try expect(model.count == 0, "确认后应清零")
            try expect(!model.isNewSessionRequested && !model.canUndo, "清零后应关闭确认并禁用撤销")
            try expect(RoundCounter(store: store).count == 0, "新会话清零应保存")
            model.recordRound()
            try expect(model.count == 1, "新会话可以继续记录")
        case "write":
            for _ in 0..<7 { model.recordRound() }
            model.undoRound()
            try expect(model.count == 6, "退出前应保存 6 轮")
        case "read":
            try expect(model.count == 6, "独立进程应读回上次的 6 轮")
        case "reset":
            model.requestNewSession()
            model.confirmNewSession()
            try expect(model.count == 0, "确认新会话应清零")
        case "readZero":
            try expect(model.count == 0, "独立进程应读回清零结果")
        case "saveFailure":
            let failing = RoundCounter(store: FailingStore())
            failing.recordRound()
            try expect(failing.count == 3, "保存失败不能显示未保存的数值")
            try expect(failing.storageError != nil, "保存失败应显示中文错误")
        case "loadFailure":
            let failing = RoundCounter(store: FailingStore(failsOnLoad: true))
            try expect(failing.storageError != nil, "读取失败应显示中文错误")
            failing.recordRound()
            try expect(failing.count == 0, "读取失败不能覆盖原记录")
        default:
            throw TestFailure.expectation("未知测试场景")
        }
    }

    // Convert unexpected read failures to a value that cannot satisfy an expectation.
    private static func tryLoad(_ store: LocalRoundCountStore) -> Int {
        (try? store.load()) ?? -1
    }
}
