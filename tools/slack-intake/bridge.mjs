import { DecisionValidationError, brief, directTaskID, executionDepth, hasSecret, publicText, slackEvent, validateDecision } from "./policy.mjs";

function reportText(plan) {
  const content = plan?.content ?? plan?.plan?.content;
  if (typeof content !== "string") return "";
  return content.match(/^#{1,6}\s+Slack 执行报告\s*\n([\s\S]*)$/m)?.[1]?.trim() ?? "";
}

function confirmedStart(text, tasks) {
  const name = text.match(/^(?:我\s*)?确认\s*(?:现在\s*)?启动\s*(.+?)\s*[。！!]?$/u)?.[1];
  if (!name) return;
  const normalize = value => value.normalize("NFKC").toLowerCase().replace(/[\s「」“”"]/gu, "");
  const target = normalize(name);
  const matches = tasks.filter(task => [task.title, task.task].some(value => normalize(value) === target));
  if (matches.length === 1) {
    return { action: "resume", task: matches[0].task, depth: "light", goal: "", acceptance: [], risks: [] };
  }
}

export class Bridge {
  constructor({ config, kandev, journal, intake, slack, saveReport, approvals }) {
    Object.assign(this, { config, kandev, journal, intake, slack, saveReport, approvals });
  }
  link(id) {
    return `${this.config.kandev.viewUrl.replace(/\/$/, "")}/t/${id}`;
  }
  allowed(event) {
    return this.config.slack.users.includes(event.user) && this.config.slack.channels.includes(event.channel);
  }
  accept(envelope, bot) {
    const event = slackEvent(envelope, this.config, bot);
    if (!event) return false;
    if (event.text.length > 6000 || hasSecret(event.text)) {
      if (!this.journal.receive({ ...event, text: "[已过滤]" })) return false;
      this.journal.finish(event, "此消息包含疑似凭据或超出长度。请删除敏感内容并简化后重发。");
      return true;
    }
    return this.journal.receive(event);
  }
  async processOne() {
    const item = this.journal.nextEvent();
    if (!item) return false;
    const { event } = item;
    if (!this.allowed(event)) {
      this.journal.drop(event.id);
      return true;
    }
    try {
      const result = await this.approvals?.reply(event);
      if (result !== undefined) {
        this.journal.finish(event, result);
        return true;
      }
      const matched = event.text.match(/^确认\s+([0-9a-f]{16})$/i);
      if (matched) {
        await this.confirm(event, matched[1]);
      } else {
        const tasks = this.journal.recent(event);
        const explicit = directTaskID(event.text);
        if (explicit && !tasks.some(task => task.task === explicit)) {
          const task = await this.kandev.scope(explicit);
          tasks.unshift({ task: task.id, title: task.title, state: task.state });
        }
        const decision = item.decision ?? confirmedStart(event.text, tasks) ?? validateDecision(await this.intake({
          repository: this.config.kandev.slug, message: event.text,
          history: this.journal.history(event), tasks,
        }));
        this.journal.remember(event.id, decision);
        const text = await this.dispatch(event, decision, tasks);
        this.journal.issue(event.id, "decision", decision.action);
        if (["discuss", "clarify"].includes(decision.action)) this.journal.addHistory(event, decision.reply);
        this.journal.finish(event, text);
      }
    } catch (error) {
      if (error instanceof DecisionValidationError) {
        this.journal.issue(event.id, "failure", error.message);
        this.journal.finish(event, `简报未通过校验：${error.message}。未执行 Kandev 操作。`, "简报校验失败");
      } else {
        this.journal.issue(event.id, "failure", "请核对本机操作状态");
        this.journal.finish(event, "本次操作未获成功确认。请在 Kandev 核对当前任务或状态后重试。", "操作未获确认");
      }
    }
    return true;
  }
  async dispatch(event, value, tasks) {
    const { action } = value;
    if (["discuss", "clarify"].includes(action)) return publicText(value.reply) || "请补充你最想确认的问题。";
    if (action === "restricted") return "删除、产生费用、合并和生产发布需要在相应系统中由本人明确处理。";
    const route = this.config.kandev;
    const depth = executionDepth(value, event.text);
    if (["create", "research"].includes(action)) {
      if (action === "create" && (value.uncertain || /只讨论|先讨论|先聊聊|要不要|有没有必要|值不值得|需不需要/.test(event.text))) {
        return publicText(value.reply) || "请确认你希望现在启动开发，还是先讨论方案。";
      }
      const chosen = action === "research" ? "research" : depth;
      const hold = /暂(?:不|缓)启动|先别启动|只(?:建单|创建任务)/.test(event.text);
      const task = await this.kandev.create({ id: event.id, depth: chosen, title: value.title, hold, prompt: brief(value, route, event) });
      this.journal.bind(event, task.id, task.title, chosen);
      return `Kandev 任务已创建 · ${publicText(task.title)} · ${chosen} · ${task.state}\n${this.link(task.id)}`;
    }
    const id = value.task || (tasks.length === 1 ? tasks[0].task : "");
    if (!id || !tasks.some(task => task.task === id)) return "请提供本仓库的任务链接或完整任务 ID。";
    const task = await this.kandev.status(id);
    if (action === "status") {
      const plan = await this.kandev.plan(id);
      const details = await this.taskDetails(task, plan);
      return this.statusText(task, details);
    }
    if (action === "approve") {
      if (this.approvals) {
        const binding = this.journal.tracked().find(item => item.task === id && item.user === event.user && item.channel === event.channel);
        if (binding) await this.approvals.pollTask(binding, task);
        return "待审批工具会在任务原线程通知。请在对应审批下回复。";
      }
      const request = await this.kandev.safeApproval(id);
      if (!request) return "当前没有可通过 Slack 单次批准的唯一原生计划工具请求。其他权限请在 Kandev 中查看。";
      const code = this.journal.confirm(event, { action, id, request });
      return `单次批准 ${request.title} · ${publicText(task.title)}\n${this.link(id)}\n在此线程回复“确认 ${code}”，10 分钟有效。`;
    }
    if (action === "pause") {
      const code = this.journal.confirm(event, { action, id, session: task.primary_session_id, step: task.workflow_step_id });
      return `暂停会停止当前 Agent 执行。确认任务 ${publicText(task.title)}\n${this.link(id)}\n在此线程回复“确认 ${code}”，10 分钟有效。`;
    }
    if (["resume", "review", "retarget", "depth"].includes(action)) {
      if (!this.journal.effect(event.id, action, id)) return "操作已尝试，请在 Kandev 核对当前状态。";
      if (action === "resume") return this.statusText(await this.kandev.resume(id));
      if (action === "review") return `Kandev 已接收追加审查请求。\n${this.statusText(await this.kandev.review(id, event.id))}`;
      if (action === "retarget") {
        if (value.uncertain) return "请先明确新的目标和验收条件。";
        if (task.workflow_id !== route.workflows.research && depth === "deep" && task.workflow_id !== route.workflows.deep) {
          await this.kandev.changeDepth(id, "deep");
          this.journal.depth(id, "deep");
        }
        return this.statusText(await this.kandev.retarget(id, value.title, brief(value, route, event)));
      }
      let existing = task.description ?? "";
      try {
        const original = JSON.parse(existing.split("\n").find(line => line.startsWith("{")) ?? "");
        existing = [original.goal, ...(original.acceptance ?? [])].join(" ");
      } catch { /* 既有任务说明仍参与风险判定。 */ }
      const chosen = executionDepth(value, existing);
      if (route.workflows.research === task.workflow_id) throw new Error("研究任务无需变更为开发深度");
      const changed = await this.kandev.changeDepth(id, chosen);
      this.journal.depth(id, chosen);
      return `执行深度为 ${chosen}。\n${this.statusText(changed)}`;
    }
    return "该操作未在当前版本开放，请在 Kandev 中处理。";
  }
  async confirm(event, code) {
    const saved = this.journal.takeConfirmation(event, code);
    if (!saved) {
      this.journal.finish(event, "确认码已使用、过期或不属于此线程。");
      return;
    }
    if (!this.journal.effect(event.id, saved.action, saved.id)) {
      this.journal.finish(event, "操作已尝试，请在 Kandev 核对。");
      return;
    }
    const task = await this.kandev.status(saved.id);
    let result;
    if (saved.action === "pause") {
      if (task.primary_session_id !== saved.session || task.workflow_step_id !== saved.step) {
        throw new Error("确认后原任务阶段已变化");
      }
      result = this.statusText(await this.kandev.pause(saved.id));
    } else if (this.approvals) {
      result = "此旧版工具确认已失效。请在新的工具审批消息中回复。";
    } else {
      result = `Kandev 已确认单次批准 ${await this.kandev.approve(saved.request)}。\n${this.link(saved.id)}`;
    }
    this.journal.finish(event, result);
  }
  statusText(task, report = "") {
    const pending = task.task_pending_action ?? task.primary_session_pending_action;
    const state = task.primary_session_state && task.primary_session_state !== task.state
      ? ` · 会话 ${task.primary_session_state}` : "";
    return [`${publicText(task.title)} · ${task.state} · ${task.stage}${state}`,
      pending && "有待处理事项，详见 Kandev。",
      task.status_summary?.turn_error && "Agent 最近一轮执行异常，详见 Kandev。",
      this.link(task.id), report].filter(Boolean).join("\n");
  }
  planStatus(plan) {
    const content = plan?.content ?? "";
    const progress = [...content.matchAll(/^Slack (阻塞|进度)[：:]\s*([^\n]{1,420})$/gm)].at(-1);
    if (!progress || hasSecret(progress[2])) return "";
    const pr = progress[2].match(/https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/\d+/i)?.[0];
    const authorized = pr?.startsWith(`https://github.com/${this.config.kandev.slug}/pull/`) ? pr : "";
    return [`Slack ${progress[1]} · ${publicText(progress[2])}`, authorized].filter(Boolean).join("\n");
  }
  async report(id, plan) {
    const report = reportText(plan);
    if (!report) return "当前未找到 Gemini 最终报告。";
    if (hasSecret(report)) return "报告含疑似凭据，请在 Kandev 核对后分享。";
    await this.saveReport(id, report);
    const pr = report.match(/https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/\d+/i)?.[0];
    const authorizedPR = pr?.startsWith(`https://github.com/${this.config.kandev.slug}/pull/`) ? pr : "";
    const summary = report.match(/^摘要[：:]\s*(.+)$/m)?.[1] ?? "";
    return [summary && !hasSecret(summary) ? `Gemini 摘要 · ${publicText(summary).slice(0, 420)}` : "完整报告见 Kandev 任务计划。",
      authorizedPR].filter(Boolean).join("\n");
  }
  async taskDetails(task, plan) {
    if (task.state === "COMPLETED") return this.report(task.id, plan);
    const report = reportText(plan);
    const status = this.planStatus(plan);
    if (!report || hasSecret(report)) return status;
    await this.saveReport(task.id, report);
    return [status, "Gemini 报告已保存，任务状态以 Kandev 为准。"].filter(Boolean).join("\n");
  }
  async notify() {
    for (const binding of this.journal.tracked()) {
      if (!this.allowed(binding)) continue;
      try {
        const task = await this.kandev.status(binding.task);
        const pending = task.task_pending_action ?? task.primary_session_pending_action;
        if (pending) await this.approvals?.pollTask(binding, task);
        const terminal = ["COMPLETED", "FAILED", "CANCELLED", "BLOCKED"].includes(task.state);
        const agentError = ["FAILED", "CANCELLED"].includes(task.primary_session_state);
        const turnError = task.status_summary?.turn_error;
        const plan = task.state === "CREATED" ? null : await this.kandev.plan(task.id);
        const status = this.planStatus(plan);
        const blocked = status.startsWith("Slack 阻塞");
        if (!terminal && !pending && !agentError && !turnError && !blocked) continue;
        const key = `status:${task.id}:${task.state}:${task.workflow_step_id}:${task.primary_session_state ?? ""}:${Boolean(pending)}:${turnError?.stamp ?? ""}`;
        if (this.journal.hasDelivery(key)) continue;
        const report = await this.taskDetails(task, plan);
        this.journal.enqueue(key, binding, this.statusText(task, report));
      } catch {
        // A transient Kandev read failure leaves the task available for the next poll.
      }
    }
    await this.approvals?.pollMerges(card => this.allowed(card));
  }
  async deliverOne(now = Date.now()) {
    const item = this.journal.nextDelivery(now);
    if (!item) return false;
    if (!this.allowed(item)) {
      this.journal.delivery(item.id, "failed", "原接收人已不在白名单");
      return true;
    }
    if (this.approvals && !this.approvals.deliverable(item.id)) {
      this.journal.delivery(item.id, "failed", "审批已经关闭或过期");
      return true;
    }
    try {
      await this.slack.post(item.channel, item.thread, item.text);
      this.journal.delivery(item.id, "sent");
    } catch (error) {
      if (error.retryAfter && item.attempts < 4) {
        this.journal.delivery(item.id, "queued", "Slack 限流", now + error.retryAfter);
      } else {
        this.journal.delivery(item.id, "failed", error.retryAfter ? "达到重试上限" : "Slack 未确认送达");
      }
    }
    return true;
  }
}
