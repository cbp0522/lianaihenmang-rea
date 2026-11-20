import SwiftUI

struct WorkbenchView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @StateObject private var model = WorkbenchModel(clipboard: SystemClipboardWriter())
    @FocusState private var isEditing: Bool

    private static let copiedMessage = "已复制到剪贴板"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("回应练习台")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)

                LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                    ForEach(ReplyIntent.allCases, content: intentButton)
                }
                draftSection
                copySection
            }
            .padding(20)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .confirmationDialog(
            "替换当前草稿？",
            isPresented: Binding(
                get: { model.session.pendingIntent != nil },
                set: { if !$0 { model.cancelReplacement() } }
            ),
            titleVisibility: .visible
        ) {
            Button("替换为新模板", role: .destructive) {
                model.confirmReplacement()
            }
            Button("保留当前草稿") {
                model.cancelReplacement()
            }
        }
    }

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: 10, alignment: .top),
            count: dynamicTypeSize.isAccessibilitySize ? 1 : 2
        )
    }

    private func intentButton(_ intent: ReplyIntent) -> some View {
        let isSelected = model.session.selectedIntent == intent
        return Group {
            if isSelected {
                selectionButton(for: intent, isSelected: true)
                    .buttonStyle(.borderedProminent)
                    .accessibilityAddTraits(.isSelected)
            } else {
                selectionButton(for: intent, isSelected: false)
                    .buttonStyle(.bordered)
            }
        }
        .accessibilityIdentifier("intent.\(intent.id)")
    }

    private func selectionButton(for intent: ReplyIntent, isSelected: Bool) -> some View {
        Button {
            isEditing = false
            _ = model.select(intent)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(intent.title).font(.headline)
                    if isSelected {
                        Image(systemName: "checkmark")
                            .accessibilityHidden(true)
                    }
                }
                Text(intent.explanation)
                    .font(.subheadline)
            }
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private var draftSection: some View {
        if model.session.selectedIntent == nil {
            Text("先选择一种沟通意图，再生成离线草稿")
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("emptyStateHint")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                TextEditor(text: Binding(
                    get: { model.session.draft },
                    set: { model.updateDraft($0) }
                ))
                .font(.body)
                .frame(height: 180)
                .padding(4)
                .background(.background, in: RoundedRectangle(cornerRadius: 10))
                .overlay {
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(.quaternary)
                        .allowsHitTesting(false)
                }
                .focused($isEditing)
                .accessibilityLabel("草稿")
                .accessibilityIdentifier("draftEditor")

                Text("\(model.session.draft.count) 字")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var copySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                isEditing = false
                if model.copy() == .copied {
                    AccessibilityNotification.Announcement(Self.copiedMessage).post()
                }
            } label: {
                Text("复制草稿")
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!model.session.canCopy)
            .accessibilityIdentifier("copyDraft")

            if model.session.selectedIntent != nil, model.session.isDraftBlank,
               model.session.copyStatus != .blankRejected {
                statusLine("草稿为空，输入内容后才能复制", identifier: "blankHint")
            } else {
                statusLine(copyStatusText, identifier: "copyStatus")
            }
        }
    }

    private var copyStatusText: String {
        guard model.session.selectedIntent != nil else { return "" }
        switch model.session.copyStatus {
        case .idle: return ""
        case .copied: return Self.copiedMessage
        case .blankRejected: return "草稿为空，未复制"
        }
    }

    private func statusLine(_ text: String, identifier: String) -> some View {
        Text(text.isEmpty ? " " : text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .accessibilityHidden(text.isEmpty)
            .accessibilityIdentifier(identifier)
    }
}
