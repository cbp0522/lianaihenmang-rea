#!/usr/bin/env ruby
# 从现有三角色工作流生成带不同入口和审查深度的 Kandev 原生工作流。
require "yaml"

source = File.expand_path("../infra/kandev/ios-development.yml", __dir__)
base = YAML.safe_load(File.read(source), aliases: true).fetch("workflows").first.fetch("steps")
template = <<~PROMPT
  {{task_prompt}}

  使用本任务的原生计划交接。任务因失败、权限、模型或验收问题无法继续时，
  如能写入计划，追加一行「Slack 阻塞：当前阶段和具体原因」，不发完成信号。
  阻塞解除后追加一行「Slack 进度：已核实的当前进度」。

PROMPT
report = <<~PROMPT
  读取任务计划、实际提交和测试。开发任务核对 Draft PR 和已记录的 CI，
  仅查询结构化简报授权的仓库。研究任务记录研究范围和证据。
  用简体中文在原生任务计划末尾保存一个标题「## Slack 执行报告」。
  标题下一行填「摘要：」和简短可公开的状态，后续段落写目标、真实交付、
  技术决定、测试、Claude 审查、CI、Draft PR、遗留风险和待人工事项。
  无证据明确标未知。省略秘密、私人路径和聊天原文。报告保存成功后发完成信号。
  使用原生计划工具，禁止更换模型和代写。
PROMPT
routes = {
  "轻量" => %i[waiting implement draft ci report done],
  "标准" => %i[waiting architecture implement review draft ci report done],
  "深度" => %i[waiting research architecture spec implement review draft ci report done],
  "仅研究" => %i[waiting research report done],
}
indexes = {
  research: 0, architecture: 1, spec: 2, implement: 3, review: 4, repair: 5,
  draft: 8, ci: 9, report: 7, done: 10,
}
prompts = {
  research: <<~PROMPT,
    在独立 Gemini 会话中，从结构化简报理解用户问题，核对授权仓库的相关文件、
    公开资料及已有研究证据。把观察、推断、原创需求分别标注。创建原生任务计划。
    仅研究流程不修改产品或创建 PR。计划保存成功后发完成信号。
  PROMPT
  architecture: <<~PROMPT,
    在独立 Claude 会话中，从受信任务简报和授权仓库读写原生任务计划。
    有研究计划时追加「Claude 架构决定」，没有时创建。只设计实际需要的部分，
    写清影响、验收与风险。发现键盘生命周期、隐私、安全或大规模跨模块影响时，
    补充相应证据和必要门槛。完成后发信号。
  PROMPT
  spec: <<~PROMPT,
    在独立 Gemini 会话中依据研究和 Claude 决定，将必要任务、异常路径和可验证验收
    追加到原生任务计划「Gemini 开发交接」。保持原有权限边界，记录未知，再发完成信号。
  PROMPT
  implement: <<~PROMPT,
    在独立非主工作树，根据结构化简报和已有原生任务计划实施必要修改。
    轻量任务建立简短计划。运行已有检查及针对性测试，保存实际验收及精确提交。
    若轻量或标准工作发现高风险条件或必要验收缺失，记录原因及建议深度并暂停交接。
    只在目标仓库和现有授权范围工作，提交后发完成信号。
  PROMPT
  review: <<~PROMPT,
    使用新 Claude 会话，读取既有计划、实际差异和测试，独立审查。
    将结论追加至「Claude 独立审查」，区分有证据的阻断、非阻断建议、
    尚未验证风险和通过。无缺陷时直接写「未发现值得修复的问题，审查通过」，
    并用 step_complete_kandev 自然进入 Draft PR。
    有证据的阻断才移交 Codex，切勿发通过信号。保留当前任务及工作树。
    发现重复无进展、权限不足或验收条件不足时暂停。
  PROMPT
  repair: <<~PROMPT,
    读取 Claude 有证据的阻断、验收和既往修复记录，只改相关范围。
    修复有实质进展且针对测试通过才提交，记录证据后发信号回到独立 Claude 审查。
    可在本步骤内逐项修复。连续无进展、达到三轮、存在未知或测试失败则停留。
  PROMPT
  draft: <<~PROMPT,
    只向结构化简报中本地配置授权的 GitHub 仓库创建 Draft PR。
    核对 origin 与授权仓库相同，基线是简报所示非主分支，当前独立工作树干净，
    HEAD 包含已验实现。在标准和深度流程核对完成了有效独立审查。
    显式指定仓库、来源和目标基线，使用 gh pr create --draft，使用时核对 Draft 和 HEAD。
    将 Draft URL、HEAD、范围及真实测试写回任务计划，再发完成信号。
    另追加一行「Slack 进度：Draft PR 已建立」和同一真实 Draft PR 链接。
    不合并、不部署、不使用未授权账户或凭据。
  PROMPT
  ci: <<~PROMPT,
    再核对 Draft PR、授权仓库和精确 HEAD。读取真实 GitHub CI，最长等待 20 分钟。
    将 URL、实际结论、运行项、未验证项或失败证据保存至计划。
    追加「Slack 进度：」或「Slack 阻塞：」一行，附实际 CI 结论和 Draft PR 链接。
    失败或阻塞停在 CI 并记录待处理原因。全部通过才发完成信号。
  PROMPT
  report: report,
}

workflows = routes.map do |label, sequence|
  steps = sequence.map { |kind| [kind, 0] }
  if (review = sequence.index(:review))
    steps.insert(review + 1, *[1, 2, 3].flat_map { |round| [[:repair, round], [:review, round]] })
  end
  draft = steps.index([:draft, 0])
  steps = steps.map.with_index do |(kind, round), index|
    if kind == :waiting
      next {"name" => "等待启动", "position" => 0, "color" => "bg-slate-400",
            "is_start_step" => true, "allow_manual_move" => true,
            "complete_task_on_enter" => false, "events" => {}}
    end
    step = Marshal.load(Marshal.dump(base.fetch(indexes.fetch(kind))))
    step["position"] = index
    step["is_start_step"] = index.zero?
    step["allow_manual_move"] = true
    if kind == :done
      step["events"] = {}
    else
      step["name"] = case kind
                     when :report then "Gemini 最终中文报告"
                     when :repair then "Codex 反馈修复与复测（第#{round}轮）"
                     when :review then round.zero? ? "Claude 独立审查" : "Claude 复核（第#{round}轮）"
                     else step["name"]
                     end
      step["prompt"] = template + prompts.fetch(kind)
      if kind == :review
        step["prompt"] += if round < 3
          "确认需修复时，用原生 move_task_kandev 移动本任务到「Codex 反馈修复与复测（第#{round + 1}轮）」后结束此轮。\n"
        else
          "本次已用完最多三轮修复。有阻断时记录原因并停留本轮，不移动或发完成信号。\n"
        end
      end
      destination = kind == :review ? draft : index + 1
      step["events"] = {
        "on_enter" => [{"type" => "auto_start_agent"}],
        "on_turn_complete" => [{"type" => "move_to_step", "config" => {"step_position" => destination}}],
      }
    end
    step
  end
  {"name" => "REA Slack v1（#{label}）", "description" => "支持经 Slack 入口提交的 Kandev 原生任务", "steps" => steps}
end
puts YAML.dump({"version" => 2, "type" => "kandev_workflow", "workflows" => workflows})
