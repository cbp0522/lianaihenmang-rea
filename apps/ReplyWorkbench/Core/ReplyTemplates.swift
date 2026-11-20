import Foundation

enum ReplyTemplates {
    static func text(for intent: ReplyIntent) -> String {
        switch intent {
        case .decline:
            "谢谢你想到我。这次我确实安排不开，先不答应了，免得到时做不好耽误你。之后有合适的机会，我们再约。"
        case .soften:
            "刚才我的语气有点急，抱歉。我不是在怪你，只是想把这件事处理好。我们都缓一缓，晚点再好好聊，可以吗？"
        case .confirm:
            "我再确认一下：我们约定的是【时间】在【地点】，由我负责【事项】。如果有出入请告诉我，没有的话就按这个来。"
        case .followUp:
            "想跟你确认一下之前聊的那件事，现在进展怎么样了？不着急，你方便时回我一句就好，有需要我配合的也可以直接说。"
        }
    }
}
