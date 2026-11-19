import SwiftUI

@main
struct FocusTallyApp: App {
    var body: some Scene {
        WindowGroup {
            RoundCounterView()
        }
    }
}

struct RoundCounterView: View {
    @StateObject private var counter = RoundCounter()
    @State private var isShowingNewSessionAlert = false
    @State private var isShowingRecoveryAlert = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("节奏记录")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)

                VStack(alignment: .leading, spacing: 24) {
                    Text("本次会话")
                        .font(.headline)

                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(counter.count.formatted(.number.locale(Locale(identifier: "zh_CN"))))
                            .font(.largeTitle.bold())
                            .monospacedDigit()
                        Text("轮")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("已记录 \(counter.count) 轮")
                    .accessibilityIdentifier("roundCount")

                    Button(action: counter.recordRound) {
                        Text("记录一轮")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!counter.canRecord)
                    .accessibilityHint("为本次会话增加一轮，并保存记录")
                    .accessibilityIdentifier("recordRound")

                    VStack(alignment: .leading, spacing: 12) {
                        Button("撤销一轮", action: counter.undoRound)
                            .disabled(!counter.canUndo)
                            .accessibilityHint("减去一轮，并保存记录")
                            .accessibilityIdentifier("undoRound")

                        Button("开始新会话") {
                            counter.requestNewSession()
                            isShowingNewSessionAlert = counter.isNewSessionRequested
                        }
                        .disabled(!counter.canStartNewSession)
                        .accessibilityHint("确认后将当前轮次清零")
                        .accessibilityIdentifier("newSession")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
                .background(.background, in: RoundedRectangle(cornerRadius: 24))

                if let error = counter.storageError {
                    Text(error)
                        .font(.body)
                        .foregroundStyle(.red)
                }

                if counter.canRecover {
                    Button("恢复本地记录") {
                        counter.requestRecovery()
                        isShowingRecoveryAlert = counter.isRecoveryRequested
                    }
                    .accessibilityHint("确认后备份损坏文件，并从零轮重新开始")
                    .accessibilityIdentifier("recoverRecord")
                    .alert("恢复本地记录？", isPresented: $isShowingRecoveryAlert) {
                        Button("取消", role: .cancel, action: counter.cancelRecovery)
                        Button("备份并重新开始", role: .destructive, action: counter.confirmRecovery)
                    } message: {
                        Text("将保留损坏文件的独立备份，再写入 0 轮。已有备份会保留。")
                    }
                }

                Text("记录自动保存在此设备。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .tint(.indigo)
        .onChange(of: counter.count) { _, count in
            AccessibilityNotification.Announcement("已记录 \(count) 轮").post()
        }
        .alert("开始新会话？", isPresented: $isShowingNewSessionAlert) {
            Button("取消", role: .cancel, action: counter.cancelNewSession)
            Button("确认开始", role: .destructive, action: counter.confirmNewSession)
        } message: {
            Text("当前的 \(counter.count) 轮记录将清零。")
        }
        .environment(\.locale, Locale(identifier: "zh_CN"))
    }
}
