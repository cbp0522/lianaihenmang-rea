import Foundation

enum ReplyIntent: String, CaseIterable, Identifiable, Sendable {
    case decline, soften, confirm, followUp

    var id: String { rawValue }

    var title: String {
        switch self {
        case .decline: "婉拒"
        case .soften: "缓和"
        case .confirm: "确认"
        case .followUp: "跟进"
        }
    }

    var explanation: String {
        switch self {
        case .decline: "说明做不到，同时保留关系"
        case .soften: "先降温，再谈事情"
        case .confirm: "把关键信息说清楚"
        case .followUp: "不施压地询问进展"
        }
    }
}
