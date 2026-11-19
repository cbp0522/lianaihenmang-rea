import Combine
import Foundation

protocol RoundCountStore {
    func load() throws -> Int
    func save(_ count: Int) throws
    func recoverCorruptedRecord() throws -> Int
}

enum RoundStorageIssue: Error {
    case loadFailed, corruptedRecord, saveFailed, backupFailed, recoverySaveFailed

    var message: String {
        switch self {
        case .loadFailed: "无法读取上次记录，原记录未更改。请稍后重新打开。"
        case .corruptedRecord: "本地记录内容损坏，原文件已保留。可备份后重新开始。"
        case .saveFailed: "本次未保存，当前轮次未更改。请再次操作以重试。"
        case .backupFailed: "无法备份损坏记录，原文件未更改。可再次尝试恢复。"
        case .recoverySaveFailed: "损坏记录已备份，但无法写入新记录，原文件仍保留。可再次尝试恢复。"
        }
    }
}

struct LocalRoundCountStore: RoundCountStore {
    let fileURL: URL
    // Injectable file operations allow deterministic disk failure tests.
    var writeData: (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }
    var copyFile: (URL, URL) throws -> Void = { try FileManager.default.copyItem(at: $0, to: $1) }

    init(fileURL: URL = URL.applicationSupportDirectory
        .appendingPathComponent("FocusTally", isDirectory: true)
        .appendingPathComponent("round-count.json")) {
        self.fileURL = fileURL
    }

    func load() throws -> Int {
        let data: Data
        do {
            data = try Data(contentsOf: fileURL)
        } catch CocoaError.fileReadNoSuchFile {
            return 0
        }
        // Only decoding failures qualify for recovery. Other I/O failures propagate.
        do {
            let count = try JSONDecoder().decode(Int.self, from: data)
            guard count >= 0 else { throw RoundStorageIssue.corruptedRecord }
            return count
        } catch {
            throw RoundStorageIssue.corruptedRecord
        }
    }

    func save(_ count: Int) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try writeData(JSONEncoder().encode(count), fileURL)
    }

    func recoverCorruptedRecord() throws -> Int {
        // 文件若已恢复可读，直接采用当前计数。
        do {
            return try load()
        } catch RoundStorageIssue.corruptedRecord {
            // 确认仍然损坏后再创建独立备份。
        } catch {
            throw RoundStorageIssue.loadFailed
        }
        let backupURL = fileURL.appendingPathExtension("corrupt-\(UUID().uuidString).bak")
        do {
            try copyFile(fileURL, backupURL)
        } catch {
            throw RoundStorageIssue.backupFailed
        }
        do {
            try save(0)
        } catch {
            throw RoundStorageIssue.recoverySaveFailed
        }
        return 0
    }
}

@MainActor
final class RoundCounter: ObservableObject {
    @Published private(set) var count = 0
    @Published private(set) var isNewSessionRequested = false
    @Published private(set) var isRecoveryRequested = false
    @Published private(set) var storageIssue: RoundStorageIssue?

    var storageError: String? { storageIssue?.message }
    private let store: any RoundCountStore

    init(store: any RoundCountStore = LocalRoundCountStore()) {
        self.store = store
        do {
            count = max(0, try store.load())
        } catch RoundStorageIssue.corruptedRecord {
            storageIssue = .corruptedRecord
        } catch {
            storageIssue = .loadFailed
        }
    }

    var canRecord: Bool { !isReadBlocked && count < Int.max }
    var canUndo: Bool { count > 0 && !isReadBlocked }
    var canStartNewSession: Bool { count > 0 && !isReadBlocked }
    var canRecover: Bool {
        switch storageIssue {
        case .corruptedRecord, .backupFailed, .recoverySaveFailed: true
        default: false
        }
    }
    private var isReadBlocked: Bool {
        switch storageIssue {
        case nil, .saveFailed: false
        default: true
        }
    }

    func recordRound() {
        guard canRecord else { return }
        persist(count + 1)
    }

    func undoRound() {
        guard canUndo else { return }
        persist(count - 1)
    }

    func requestNewSession() {
        guard canStartNewSession else { return }
        isNewSessionRequested = true
    }

    func cancelNewSession() { isNewSessionRequested = false }

    func confirmNewSession() {
        guard isNewSessionRequested else { return }
        isNewSessionRequested = false
        persist(0)
    }

    func requestRecovery() {
        guard canRecover else { return }
        isRecoveryRequested = true
    }

    func cancelRecovery() { isRecoveryRequested = false }

    func confirmRecovery() {
        guard isRecoveryRequested && canRecover else { return }
        isRecoveryRequested = false
        do {
            count = try store.recoverCorruptedRecord()
            storageIssue = nil
        } catch let issue as RoundStorageIssue {
            storageIssue = issue
        } catch {
            storageIssue = .loadFailed
        }
    }

    private func persist(_ newCount: Int) {
        guard !isReadBlocked else { return }
        do {
            try store.save(newCount)
            count = newCount
            storageIssue = nil
        } catch {
            storageIssue = .saveFailed
        }
    }
}
