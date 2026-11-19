import Combine
import Foundation

protocol RoundCountStore {
    func load() throws -> Int
    func save(_ count: Int) throws
}

struct LocalRoundCountStore: RoundCountStore {
    let fileURL: URL

    init(fileURL: URL = URL.applicationSupportDirectory
        .appendingPathComponent("FocusTally", isDirectory: true)
        .appendingPathComponent("round-count.json")) {
        self.fileURL = fileURL
    }

    func load() throws -> Int {
        do {
            let data = try Data(contentsOf: fileURL)
            return max(0, try JSONDecoder().decode(Int.self, from: data))
        } catch CocoaError.fileReadNoSuchFile {
            return 0
        }
    }

    func save(_ count: Int) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONEncoder().encode(count).write(to: fileURL, options: .atomic)
    }
}

@MainActor
final class RoundCounter: ObservableObject {
    @Published private(set) var count = 0
    @Published private(set) var isNewSessionRequested = false
    @Published private(set) var storageError: String?

    private let store: any RoundCountStore

    init(store: any RoundCountStore = LocalRoundCountStore()) {
        self.store = store
        do {
            count = max(0, try store.load())
        } catch {
            storageError = "无法读取上次记录，请稍后重新打开。"
        }
    }

    var canUndo: Bool { count > 0 && storageError == nil }
    var canStartNewSession: Bool { count > 0 && storageError == nil }

    func recordRound() {
        guard count < Int.max else { return }
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

    func cancelNewSession() {
        isNewSessionRequested = false
    }

    func confirmNewSession() {
        guard isNewSessionRequested else { return }
        isNewSessionRequested = false
        persist(0)
    }

    private func persist(_ newCount: Int) {
        // A failed load must never overwrite an unreadable existing record.
        guard storageError == nil else { return }
        do {
            try store.save(newCount)
            count = newCount
        } catch {
            storageError = "无法保存记录，当前轮次未更改。请稍后重新打开。"
        }
    }
}
