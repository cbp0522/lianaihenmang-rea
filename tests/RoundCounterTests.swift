import Foundation

private enum TestFailure: Error {
    case expectation(String)
    case storage
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw TestFailure.expectation(message) }
}

private struct FailingStore: RoundCountStore {
    var failsOnLoad = false
    func load() throws -> Int {
        if failsOnLoad { throw TestFailure.storage }
        return 3
    }
    func save(_ count: Int) throws { throw TestFailure.storage }
    func recoverCorruptedRecord() throws -> Int { throw TestFailure.storage }
}

private final class TransientStore: RoundCountStore {
    var value = 3
    var failures = 1
    var saveAttempts = 0
    var failsOnLoad = false
    var recoveryAttempts = 0
    func load() throws -> Int {
        if failsOnLoad { throw TestFailure.storage }
        return value
    }
    func save(_ count: Int) throws {
        saveAttempts += 1
        if failures > 0 {
            failures -= 1
            throw TestFailure.storage
        }
        value = count
    }
    func recoverCorruptedRecord() throws -> Int {
        recoveryAttempts += 1
        return 0
    }
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
            try expect(!FileManager.default.fileExists(atPath: store.fileURL.path), "首次打开和无效操作不应创建记录")
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
        case "retry":
            for action in ["record", "undo", "reset"] {
                let memory = TransientStore()
                let counter = RoundCounter(store: memory)
                func act() {
                    switch action {
                    case "record": counter.recordRound()
                    case "undo": counter.undoRound()
                    default:
                        counter.requestNewSession()
                        counter.confirmNewSession()
                    }
                }
                act()
                try expect(counter.count == 3 && memory.value == 3, "保存失败应保留轮次")
                try expect(counter.storageIssue == .saveFailed, "保存错误应区别于读取错误")
                try expect(counter.canRecord && counter.canUndo && counter.canStartNewSession, "保存失败后操作仍可重试")
                counter.confirmNewSession()
                counter.cancelNewSession()
                try expect(memory.saveAttempts == 1, "未确认或取消不能重试保存")
                act()
                let expected = action == "record" ? 4 : (action == "undo" ? 2 : 0)
                try expect(counter.count == expected && memory.value == expected, "下一次操作应基于已保存轮次重试")
                try expect(counter.storageError == nil, "重试成功应清除错误")
                try expect(memory.saveAttempts == 2, "每次有效操作只保存一次")
                try expect(RoundCounter(store: memory).count == expected, "重建模型应读回重试结果")
            }
        case "readProtection":
            let memory = TransientStore()
            memory.failsOnLoad = true
            let counter = RoundCounter(store: memory)
            counter.recordRound()
            counter.undoRound()
            counter.requestNewSession()
            counter.confirmNewSession()
            counter.requestRecovery()
            counter.confirmRecovery()
            try expect(counter.storageIssue == .loadFailed, "意外读取失败应独立显示")
            try expect(!counter.canRecover && !counter.canRecord, "读取失败不能提供损坏恢复或记录")
            try expect(memory.saveAttempts == 0 && memory.recoveryAttempts == 0 && memory.value == 3, "读取失败保护原记录")
            try FileManager.default.createDirectory(at: store.fileURL, withIntermediateDirectories: true)
            let directoryModel = RoundCounter(store: store)
            try expect(directoryModel.storageIssue == .loadFailed && !directoryModel.canRecover, "目录等读取故障不能判为损坏")
        case "corruption", "backupFailure", "recoveryWriteFailure", "recoveryReadFailure", "recoveredExternally":
            try testRecovery(scenario, store: store)
        case "noOperation":
            let memory = TransientStore()
            memory.value = 0
            memory.failures = 0
            let counter = RoundCounter(store: memory)
            counter.undoRound()
            counter.requestNewSession()
            counter.confirmNewSession()
            counter.confirmRecovery()
            counter.requestRecovery()
            counter.cancelRecovery()
            try expect(counter.count == 0 && memory.saveAttempts == 0 && memory.recoveryAttempts == 0, "无效操作不能改变或保存计数")
            memory.value = Int.max
            let maximum = RoundCounter(store: memory)
            maximum.recordRound()
            try expect(maximum.count == Int.max && memory.saveAttempts == 0, "最大值不能溢出或保存")
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

    @MainActor
    private static func testRecovery(_ scenario: String, store: LocalRoundCountStore) throws {
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let history = directory.appendingPathComponent("round-count.json.corrupt-history.bak")
        let historyData = Data("历史备份".utf8)
        try historyData.write(to: history)
        let samples = scenario == "corruption" ? ["{", "null", "\"三轮\"", "-1", "1.5", "9223372036854775808", ""] : ["{broken"]
        for sample in samples {
            let original = Data(sample.utf8)
            try original.write(to: store.fileURL)
            var tested = store
            var shouldFail = true
            if scenario == "backupFailure" {
                tested.copyFile = { source, destination in
                    if shouldFail { throw TestFailure.storage }
                    try FileManager.default.copyItem(at: source, to: destination)
                }
            }
            if scenario == "recoveryWriteFailure" {
                tested.writeData = { data, destination in
                    if shouldFail { throw TestFailure.storage }
                    try data.write(to: destination, options: .atomic)
                }
            }
            let model = RoundCounter(store: tested)
            try expect(model.storageIssue == .corruptedRecord && model.canRecover, "JSON 损坏应提供显式恢复入口")
            model.recordRound()
            model.undoRound()
            model.requestNewSession()
            model.confirmNewSession()
            model.confirmRecovery()
            try expect(try Data(contentsOf: store.fileURL) == original, "默认与未确认恢复必须保留原文件")
            model.requestRecovery()
            model.cancelRecovery()
            model.confirmRecovery()
            try expect(try Data(contentsOf: store.fileURL) == original, "取消恢复必须保留原文件")
            let before = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            if scenario == "recoveryReadFailure" {
                try FileManager.default.removeItem(at: store.fileURL)
                try FileManager.default.createDirectory(at: store.fileURL, withIntermediateDirectories: false)
            }
            if scenario == "recoveredExternally" {
                try store.save(5)
            }
            model.requestRecovery()
            model.confirmRecovery()
            let after = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            let added = after.filter { candidate in !before.contains { $0.lastPathComponent == candidate.lastPathComponent } }
            switch scenario {
            case "backupFailure":
                try expect(model.storageIssue == .backupFailed && added.isEmpty, "备份失败不能写零")
                try expect(try Data(contentsOf: store.fileURL) == original, "备份失败必须保留坏文件")
            case "recoveryWriteFailure":
                try expect(model.storageIssue == .recoverySaveFailed && added.count == 1, "备份后写入失败应显示准确状态")
                try expect(try Data(contentsOf: store.fileURL) == original, "写入失败必须保留坏文件")
            case "recoveryReadFailure":
                try expect(model.storageIssue == .loadFailed && !model.canRecover && added.isEmpty, "恢复前读取失败不能备份或重置")
            case "recoveredExternally":
                try expect(model.storageIssue == nil && model.count == 5 && added.isEmpty, "已恢复的有效记录应被读回")
                try expect(tryLoad(store) == 5, "已恢复的记录不得重置")
            default:
                try expect(model.storageError == nil && model.count == 0 && model.canRecord, "确认恢复后可以从零记录")
                try expect(tryLoad(store) == 0, "恢复后应保存零轮")
                model.recordRound()
                try expect(RoundCounter(store: store).count == 1, "恢复后记录应持久化")
                try expect(added.count == 1, "恢复必须新增独立备份")
            }
            for backup in added {
                try expect(try Data(contentsOf: backup) == original, "备份必须完整保留坏文件")
            }
            try expect(try Data(contentsOf: history) == historyData, "不得覆盖历史备份")
            if scenario == "backupFailure" || scenario == "recoveryWriteFailure" {
                // Clear the simulated disk fault without recreating the view model.
                shouldFail = false
                model.requestRecovery()
                model.confirmRecovery()
                try expect(model.storageError == nil && tryLoad(store) == 0, "恢复失败后同一模型应允许重试")
                for backup in added {
                    try expect(try Data(contentsOf: backup) == original, "重试不得覆盖上次备份")
                }
            }
        }
    }

    // Convert unexpected read failures to a value that cannot satisfy an expectation.
    private static func tryLoad(_ store: LocalRoundCountStore) -> Int {
        (try? store.load()) ?? -1
    }
}
