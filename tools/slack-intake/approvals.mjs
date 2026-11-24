import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { hasSecret, publicText } from "./policy.mjs";

const toolWindow = 10 * 60_000;
const mergeWindow = 60 * 60_000;
const stopped = new Set(["CREATED", "COMPLETED", "FAILED", "CANCELLED", "BLOCKED"]);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const opaque = /^[\w.:-]{1,200}$/u;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const credentialPath = /(?:^|[/. _-])(?:\.env|\.ssh|\.aws|secrets?|credentials?|tokens?|keychains?|id_rsa|id_ed25519)(?:[/. _-]|$)|\.(?:pem|key|p12|pfx|mobileprovision)$/i;
const planReadTool = "kandev_get_task_plan_kandev";
const friendlyType = {
  file_read: "读取文件", file_write: "写入文件", command: "运行命令",
  network: "网络访问", mcp_tool: "调用 MCP 工具", other: "其他工具操作",
};

export function validateApprovalConfig(config) {
  const { approvals, kandev } = config;
  if (approvals === undefined) return;
  if (kandev.slug !== "cbp0522/lianaihenmang-rea" || !approvals || typeof approvals !== "object"
      || !Array.isArray(approvals.readFiles) || approvals.readFiles.some(path => typeof path !== "string"
        || !isAbsolute(path) || credentialPath.test(path) || hasSecret(path) || /[\r\n]/.test(path))
      || (approvals.taskIds !== undefined && (!Array.isArray(approvals.taskIds)
        || approvals.taskIds.length === 0 || approvals.taskIds.some(id => !uuid.test(id))))) {
    throw new Error("审批仅支持 REA 仓库和显式列出的只读文件");
  }
  const merge = approvals.merge;
  if (merge === undefined) return;
  if (!merge || !/^[A-Za-z0-9-]{1,39}$/.test(merge.reviewer ?? "")
      || !/^[A-Za-z0-9-]{1,39}$/.test(merge.actor ?? "")
      || merge.reviewer.toLowerCase() === merge.actor.toLowerCase()
      || !Array.isArray(merge.paths) || !merge.paths.length || merge.paths.some(path =>
        typeof path !== "string" || !/^(?:README\.md|docs\/[\p{L}\p{N} _/-]+\.md)$/iu.test(path)
        || /(?:\/\/|\/[-/]|Slack|AGENTS|审批|权限|安全)/iu.test(path) || credentialPath.test(path))) {
    throw new Error("合并须配置独立审查账号、合并账号和精确的低风险 Markdown 文件");
  }
}

function bindingMatches(binding, event) {
  return binding.user === event.user && binding.channel === event.channel && binding.thread === event.thread;
}

export function approvalIntent(text) {
  const normalized = text.normalize("NFKC").trim().replace(/\s+/gu, "").replace(/[。.!！?？]+$/gu, "");
  const match = normalized.match(/^审批([a-f\d]{10})[:：]?(.+)$/iu);
  const input = match?.[2] ?? normalized;
  const choices = [
    ["explain", /^(?:为什么(?:需要(?:这个(?:权限|操作)?)?)?|解释一下|请说明原因)$/u],
    ["reject_merge", /^(?:先(?:不要|别)合并|拒绝合并|取消合并(?:授权)?)$/u],
    ["reject", /^(?:我)?(?:拒绝(?:这次)?|不允许(?:这次)?|不要批准)$/u],
    ["allow", /^(?:我)?(?:允许|批准|同意)(?:这次|一次)?$/u],
    ["file", /^(?:只|仅)允许读取(?:这个|该|这份)文件$/u],
    ["remember", /^(?:这个任务里|本任务内)(?:同类型|相同)的?只读操作以后都允许$/u],
    ["merge", /^(?:允许|批准)合并(?:这个)?PR(?:[,，](?:但)?不要发布)?$/iu],
    ["conditional_merge", /^(?:这个PR)?CI(?:全绿|通过)(?:且|并且|、|[,，])(?:Claude)?审查(?:没问题|通过)就合并$/iu],
  ];
  return { code: match?.[1].toLowerCase(), intent: choices.find(([, pattern]) => pattern.test(input))?.[0], input };
}

function prRequest(text, slug) {
  const value = text.trim();
  const number = value.match(/^合并\s*(?:PR\s*)?#([1-9]\d{0,8})[。！!]?$/iu)?.[1];
  if (number) return Number(number);
  const link = value.match(/^合并\s+<?https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d{0,8})>?[。！!]?$/u);
  if (link?.[1] === slug) return Number(link[2]);
}

export class Approvals {
  constructor({ config, journal, kandev, github, interpret, now = Date.now }) {
    Object.assign(this, { config, journal, kandev, github, interpret, now });
  }

  allowedTask(id) {
    const ids = this.config.approvals.taskIds;
    return !ids || ids.includes(id);
  }

  async read(action) {
    const path = action?.path;
    if (action?.type !== "file_read" || action.redacted !== false
        || action.command || action.destination || action.server || action.tool
        || !this.config.approvals.readFiles.includes(path) || credentialPath.test(path)) return;
    try {
      if (await realpath(path) !== path) return;
      const file = await stat(path);
      if (file.isFile()) return { path, version: hash([path, file.dev, file.ino, file.size, file.mtimeMs]) };
    } catch { /* 文件不存在、已失效或不可读取时交回原生审批。 */ }
  }

  async snapshot(task, item) {
    if (stopped.has(task.state) || item.task_id !== task.id || item.session_id !== task.primary_session_id
        || !uuid.test(item.session_id) || !uuid.test(item.request_id) || !opaque.test(item.pending_id)
        || item.status !== "pending" || item.human_input || !Array.isArray(item.options)) return;
    const session = await this.kandev.permissionSession(task, item.session_id);
    if (!session || ["COMPLETED", "FAILED", "CANCELLED"].includes(session.state)) return;
    const identity = {
      task_id: task.id, session_id: item.session_id, request_id: item.request_id, pending_id: item.pending_id,
    };
    const type = Object.hasOwn(friendlyType, item.action?.type) ? item.action.type : "other";
    const options = item.options.filter(option => ["allow_once", "reject_once"].includes(option.kind)
        && opaque.test(option.option_id)).map(({ kind, option_id }) => ({ kind, option_id }));
    const read = await this.read(item.action);
    const planRead = type === "other" && item.action?.redacted === false
      && item.title === planReadTool && item.action.description === planReadTool;
    const mark = hash([identity, item.tool_call_id, item.created_at, item.title, item.action, item.options, task.workflow_step_id]);
    return { identity, type, options, read, planRead, mark, step: task.workflow_step_id };
  }

  async pollTask(binding, task) {
    if (!this.allowedTask(task.id) || stopped.has(task.state) || !task.primary_session_id) return;
    for (const item of await this.kandev.pending(task.id)) {
      const now = this.now();
      const born = Date.parse(item.created_at);
      if (!Number.isFinite(born) || born > now + 30_000 || born + toolWindow <= now) continue;
      const subject = await this.snapshot(task, item);
      if (!subject) continue;
      const id = hash(subject.identity).slice(0, 10);
      const card = this.journal.openApproval(id, "tool", binding, subject, now, born + toolWindow);
      if (card.state !== "pending" || !bindingMatches(card, binding) || card.subject.mark !== subject.mark) continue;
      const rule = subject.read && this.journal.approvalRule(this.scope(subject), born, this.now());
      const kind = rule === "deny" ? "reject_once" : "allow_once";
      if (rule && subject.options.some(option => option.kind === kind)) {
        const text = await this.resolve(card, rule === "deny" ? "reject" : "allow", `reuse:${id}`, false);
        this.journal.enqueue(`reuse:${id}`, binding, text, this.now());
      } else {
        const name = publicText(task.title);
        const detail = subject.read ? `文件 ${publicText(subject.read.path)}` : "详细参数或权限范围请在 Kandev 查看。";
        const operation = subject.planRead ? "读取任务计划" : friendlyType[subject.type];
        const canAllow = subject.read && subject.options.some(option => option.kind === "allow_once");
        this.journal.enqueue(`approval:${id}`, binding, [
          `工具审批 ${id} · ${name} · ${operation}`, detail,
          canAllow ? "在此线程回复「允许这次」「拒绝」或「为什么需要」。" : "此操作的批准需在 Kandev 操作。可在此回复「拒绝」或「为什么需要」。",
          `同时有多条时，以「审批 ${id}」开头。有效期至请求发出后 10 分钟。`,
        ].join("\n"), now);
      }
    }
  }

  scope(subject) {
    return hash([subject.identity.task_id, subject.identity.session_id, subject.step, subject.type, subject.read?.version]);
  }

  async resolve(card, choice, eventID, rememberDecision = true) {
    const { subject } = card;
    const now = this.now();
    if (!this.allowedTask(subject.identity.task_id) || card.expires <= now || card.state !== "pending") return "此工具审批已过期或已处理。";
    const task = await this.kandev.status(subject.identity.task_id);
    const items = await this.kandev.pending(task.id);
    const current = items.find(item => item.request_id === subject.identity.request_id);
    const live = current && await this.snapshot(task, current);
    if (!live || live.mark !== subject.mark || live.read?.version !== subject.read?.version) {
      this.journal.moveApproval(card, "pending", "expired", this.now());
      return "原请求已撤回、变化或会话已结束。";
    }
    const reject = choice === "reject";
    if (!reject && (!live.read || !["allow", "file", "remember"].includes(choice))) {
      return "当前操作需要在 Kandev 中人工批准。";
    }
    const available = live.options.filter(option => option.kind === (reject ? "reject_once" : "allow_once"));
    if (available.length !== 1) return "Provider 未给出唯一的原生单次选项。请在 Kandev 确认。";
    if (!this.journal.moveApproval(card, "pending", "executing", this.now())) return "此工具审批已过期或已处理。";
    this.journal.issue(eventID, "tool-approval-claim", `${card.id}:${card.user}:${available[0].kind}`);
    try {
      await this.kandev.resolvePermission(live.identity, available[0]);
    } catch {
      this.journal.moveApproval(card, "executing", "uncertain", this.now());
      this.journal.issue(eventID, "tool-approval-unconfirmed", card.id);
      return "Kandev 未确认收到决定。请核对原会话。此请求不会自动重试。";
    }
    this.journal.moveApproval(card, "executing", reject ? "rejected" : "resolved", this.now());
    this.journal.issue(eventID, "tool-approval-resolved", `${card.id}:${live.identity.request_id}:${available[0].kind}`);
    if (rememberDecision && live.read && (choice === "remember" || reject)) {
      this.journal.saveApprovalRule(this.scope(live), reject ? "deny" : "allow", now + toolWindow, now);
    }
    if (reject) return live.read
      ? "Kandev 已向原会话送达拒绝。此任务、会话和文件版本的重复读取将在 10 分钟内继续拒绝。"
      : "Kandev 已向原会话送达拒绝。Agent 可选择替代路径。";
    return `Kandev 已向原会话送达单次批准。${choice === "remember" ? "未来 10 分钟仅复用当前任务、会话和同一文件版本的只读授权。" : ""}工具执行结果以原会话为准。`;
  }

  deliverable(id) {
    if (!id.startsWith("approval:")) return true;
    const card = this.journal.approval(id.slice("approval:".length));
    return card?.state === "pending" && card.expires > this.now()
      && (!card.subject.identity || this.allowedTask(card.subject.identity.task_id));
  }

  async openMerge(event, number) {
    if (!this.github) return "此入口尚未配置 GitHub 合并。";
    const subject = await this.github.snapshot(number);
    const now = this.now();
    const id = hash(["merge", event.id, subject]).slice(0, 10);
    const card = this.journal.openApproval(id, "merge", event, subject, now, now + mergeWindow);
    this.journal.enqueue(`approval:${id}`, card, [
      `合并审批 ${id} · PR #${number} → ${subject.base}`,
      `HEAD ${subject.head}\nhttps://github.com/${this.config.kandev.slug}/pull/${number}`,
      "在此回复「CI 通过且审查没问题就合并」「允许合并这个 PR，但不要发布」或「先不要合并」。此授权 1 小时有效。",
    ].join("\n"), now);
  }

  async reply(event) {
    const number = prRequest(event.text, this.config.kandev.slug);
    if (number) {
      if (!this.github) return "此入口尚未配置 GitHub 合并。";
      try { await this.openMerge(event, number); } catch { return "这个 PR 目前无法发起合并审批。请核对仓库、目标分支、Draft 状态和允许文件。"; }
      return "";
    }
    const { code, intent, input } = approvalIntent(event.text);
    const all = this.journal.approvalsFor(event);
    const targetKind = ["merge", "conditional_merge", "reject_merge"].includes(intent) ? "merge"
      : ["allow", "file", "remember"].includes(intent) ? "tool" : null;
    if (!all.length && !code && !intent) return;
    if (!all.length && !code && intent === "explain") return;
    if (!intent && !code && (!all.some(card => card.state === "pending" && card.expires > this.now())
        || !/允许|批准|拒绝|合并|为什么|只读/.test(event.text))) return;
    if (!intent) return "请明确当前审批的决定。可以回复「允许这次」「拒绝」或「为什么需要」。";

    const now = this.now();
    const candidates = all.filter(card => (!code || card.id === code) && (!targetKind || card.kind === targetKind)
      && ["pending", "authorized"].includes(card.state) && card.expires > now
      && (!card.subject.identity || this.allowedTask(card.subject.identity.task_id))
      && this.journal.approvalSent(card.id) && event.sentAt >= card.created && event.sentAt <= now + 30_000
      && event.sentAt < card.expires);
    if (candidates.length !== 1) return candidates.length
      ? "此线程有多条请求，请用「审批 编号」开头，指定其中一条。"
      : "没有与这条回复、权限类型及线程匹配的有效审批。";
    const [card] = candidates;
    // Only pass the small recognized vocabulary. No raw tool data, paths or credentials go to Claude.
    if (await this.interpret({ message: input, kind: card.kind }) !== intent) {
      return "这条回复的授权范围不够明确，请再明确一次。";
    }
    if (intent === "explain") {
      if (card.kind === "merge") return "合并会更改目标分支。系统会再次核对 HEAD、CI、独立审查和 GitHub 合并状态。";
      if (card.subject.planRead) {
        return "Agent 在请求读取 Kandev 任务计划。计划用于查看任务当前记录和前一阶段的交接内容。这条追问没有执行审批。";
      }
      if (card.subject.read) return `本任务的 Agent 请求读取 ${publicText(basename(card.subject.read.path))}。`;
      return "Kandev 未提供可核对的操作用途。请在原会话查看完整参数；当前追问未执行审批。";
    }
    if (card.kind === "tool") return this.resolve(card, intent, event.id);
    if (["reject", "reject_merge"].includes(intent)) {
      if (!this.journal.moveApproval(card, card.state, "rejected", this.now())) return "此合并审批已变化。";
      this.journal.issue(event.id, "merge-refused", `${card.id}:${card.user}:${card.subject.number}`);
      return "已拒绝这次合并授权，未调用 GitHub 合并接口。";
    }
    if (card.state === "authorized") return "这次合并已记录，仍在检查条件。";
    if (!this.journal.moveApproval(card, "pending", "authorized", this.now())) return "此合并审批已变化。";
    this.journal.issue(event.id, "merge-authorized", `${card.id}:${card.user}:${card.subject.number}:${card.subject.head}`);
    return "已记录此 PR 和 HEAD 的一次合并授权。每次合并前都会核对所有条件。";
  }

  async pollMerges(allowed) {
    if (!this.github) return;
    for (const card of this.journal.authorizedMerges()) {
      const key = `merge-result:${card.id}`;
      if (!allowed(card)) continue;
      if (card.expires <= this.now()) {
        this.journal.moveApproval(card, "authorized", "expired", this.now());
        this.journal.enqueue(key, card, "合并授权已到期。需要重新发起审批。", this.now());
        continue;
      }
      let check;
      try { check = await this.github.check(card.subject); } catch { continue; }
      if (check === "changed") {
        if (this.journal.moveApproval(card, "authorized", "expired", this.now())) {
          this.journal.enqueue(key, card, "PR 的 HEAD、目标分支或允许范围发生变化。需要重新审批。", this.now());
        }
      }
      if (check !== "ready" || !this.journal.moveApproval(card, "authorized", "executing", this.now())) continue;
      this.journal.issue(card.id, "merge-claim", `${card.user}:${card.subject.number}:${card.subject.head}`);
      try {
        const sha = await this.github.merge(card.subject);
        this.journal.moveApproval(card, "executing", "resolved", this.now());
        this.journal.issue(card.id, "merge-verified", sha);
        this.journal.enqueue(key, card, `GitHub 已确认 PR #${card.subject.number} 合并。Merge Commit ${sha}\nhttps://github.com/${this.config.kandev.slug}/commit/${sha}`, this.now());
      } catch {
        this.journal.moveApproval(card, "executing", "uncertain", this.now());
        this.journal.issue(card.id, "merge-unconfirmed", String(card.subject.number));
        this.journal.enqueue(key, card, "GitHub 未确认合并结果。请核对原 PR，入口不会自动重试。", this.now());
      }
    }
  }
}
