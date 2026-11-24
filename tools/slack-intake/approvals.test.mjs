import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Approvals, approvalIntent, validateApprovalConfig } from "./approvals.mjs";
import { Bridge } from "./bridge.mjs";
import { GitHubApproval } from "./github.mjs";
import { claudeIntake } from "./intake.mjs";
import { Journal } from "./journal.mjs";
import { Kandev } from "./kandev.mjs";

const ws = "aaaaaaaa-ffff-1111-2222-000000000000";
const taskId = "aaaaaaaa-ffff-1111-2222-111111111111";
const otherTask = "aaaaaaaa-ffff-1111-2222-222222222222";
const sessionId = "aaaaaaaa-ffff-1111-2222-333333333333";
const step = "aaaaaaaa-ffff-1111-2222-444444444444";
const thread = "1780000000.000000";
const slug = "cbp0522/lianaihenmang-rea";
const base = "research/kandev-native-antigravity";

function setup(t, overrides = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rea-approval-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "合成.md");
  writeFileSync(file, "测试资料");
  const now = { value: 1780000010000 };
  const journal = new Journal(join(root, "journal.sqlite"));
  t.after(() => journal.close());
  const source = { user: "U1", channel: "D1", thread };
  const task = {
    id: taskId, title: "独立验收", state: "IN_PROGRESS", stage: "研究",
    workflow_step_id: step, primary_session_id: sessionId, task_pending_action: { type: "permission" },
  };
  const calls = [], posts = [];
  let requests = [];
  const lookup = id => ({ ...task, id, title: id === taskId ? task.title : "另一个任务" });
  const kandev = {
    pending: async id => requests.filter(item => item.task_id === id),
    permissionSession: async () => ({ id: sessionId, state: "WAITING_FOR_INPUT" }),
    status: async id => lookup(id),
    plan: async () => null,
    resolvePermission: async (identity, option) => {
      calls.push({ identity, option });
      requests = requests.filter(item => item.request_id !== identity.request_id);
    },
  };
  const config = {
    slack: { team: "T1", app: "A1", users: ["U1"], channels: ["D1"] },
    kandev: { slug, base, viewUrl: "http://localhost:38439" },
    approvals: { readFiles: [file] },
  };
  const approvals = new Approvals({ config, journal, kandev, now: () => now.value,
    interpret: async ({ message }) => approvalIntent(message).intent, ...overrides });
  const bridge = new Bridge({ config, journal, kandev, approvals,
    slack: { post: async (_, __, text) => posts.push(text) },
    intake: async () => { throw new Error("意外进入建单入口"); },
  });
  journal.bind(source, taskId, task.title, "research");
  journal.bind({ ...source, thread: "1780000001.000000" }, otherTask, "另一个任务", "research");
  return {
    root, file, journal, source, task, calls, posts, config, approvals, bridge, now, kandev,
    request(number, overrides = {}) {
      const request = {
        task_id: taskId, session_id: sessionId, request_id: `aaaaaaaa-ffff-1111-2222-${String(number).padStart(12, "0")}`,
        pending_id: `provider-${number}`, tool_call_id: `call-${number}`, status: "pending",
        created_at: new Date(now.value).toISOString(), action: { type: "file_read", path: file, redacted: false },
        options: [
          { kind: "allow_once", option_id: "once" }, { kind: "allow_always", option_id: "forever" },
          { kind: "reject_once", option_id: "deny" },
        ], ...overrides,
      };
      requests.push(request);
      return request;
    },
    async flush() { while (await bridge.deliverOne()) {} },
    event(id, text, props = {}) {
      return { type: "events_api", payload: { type: "event_callback", event_id: id, team_id: "T1", api_app_id: "A1",
        event: { type: "message", channel_type: "im", thread_ts: thread, channel: "D1", user: "U1",
          ts: (now.value / 1000).toFixed(6), text, ...props } } };
    },
  };
}

test("工具审批走原线程，追问不执行，批准与 Slack 重投只交给 Kandev 一次", async t => {
  const s = setup(t);
  const item = s.request(1);
  await s.bridge.notify();
  await s.flush();
  assert.match(s.posts[0], /工具审批.*读取文件/);
  assert.equal(s.bridge.accept(s.event("question", "为什么需要？"), "UBOT"), true);
  await s.bridge.processOne();
  await s.flush();
  assert.match(s.posts.at(-1), /请求读取.*合成.md/);
  assert.equal(s.calls.length, 0);

  const approval = s.event("allow", "允许这次。");
  assert.equal(s.bridge.accept(approval, "UBOT"), true);
  assert.equal(s.bridge.accept(approval, "UBOT"), false);
  await s.bridge.processOne();
  await s.flush();
  assert.match(s.posts.at(-1), /已向原会话送达单次批准/);
  assert.equal(s.calls[0].identity.request_id, item.request_id);
  assert.equal(s.calls[0].option.kind, "allow_once");
  assert.equal(s.bridge.accept(s.event("again", "批准"), "UBOT"), true);
  await s.bridge.processOne();
  assert.equal(s.calls.length, 1);
});

test("已知计划读取说明请求用途，仍需在原生界面批准", async t => {
  const s = setup(t);
  const tool = "kandev_get_task_plan_kandev";
  s.request(1, { title: tool, action: { type: "other", description: tool, redacted: false } });
  await s.bridge.notify();
  await s.flush();
  assert.match(s.posts[0], /读取任务计划/);
  s.bridge.accept(s.event("why-plan", "为什么需要？"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  assert.match(s.posts.at(-1), /计划用于查看任务当前记录和前一阶段的交接内容/);
  assert.equal(s.calls.length, 0);
  s.bridge.accept(s.event("allow-plan", "允许这次"), "UBOT");
  await s.bridge.processOne();
  assert.equal(s.calls.length, 0);
});

test("限定只读授权复用在同一任务和文件版本，拒绝相同调用不会续期", async t => {
  const s = setup(t);
  s.request(1);
  await s.bridge.notify();
  await s.flush();
  s.bridge.accept(s.event("grant", "这个任务里同类型的只读操作以后都允许。"), "UBOT");
  await s.bridge.processOne();
  s.request(2);
  s.request(3, { task_id: otherTask });
  await s.bridge.notify();
  await s.flush();
  assert.deepEqual(s.calls.map(call => call.identity.pending_id), ["provider-1", "provider-2"]);
  assert.ok(s.posts.some(post => /另一个任务/.test(post)));

  writeFileSync(s.file, "新版本，不使用既有授权");
  s.request(4);
  await s.bridge.notify();
  await s.flush();
  assert.equal(s.calls.length, 2);
  const current = s.journal.approvalsFor(s.source).find(card => card.subject.identity.pending_id === "provider-4");
  s.bridge.accept(s.event("deny", `审批 ${current.id} 拒绝。`), "UBOT");
  await s.bridge.processOne();
  assert.equal(s.calls.at(-1).option.kind, "reject_once");
  const expired = s.now.value + 600001;
  s.now.value += 1000;
  s.request(5);
  await s.bridge.notify();
  assert.equal(s.calls.at(-1).identity.pending_id, "provider-5");
  assert.equal(s.calls.at(-1).option.kind, "reject_once");
  s.now.value = expired;
  s.request(6);
  await s.bridge.notify();
  assert.equal(s.calls.length, 4);
});

test("在过期、错线程、非白名单、操作已变化和旧回复上保守拒绝", async t => {
  const s = setup(t);
  const item = s.request(1);
  await s.bridge.notify();
  await s.flush();
  const [card] = s.journal.approvalsFor(s.source);
  assert.equal(s.bridge.accept(s.event("intruder", "允许", { user: "U2" }), "UBOT"), false);
  for (const message of [
    s.event("expired-message", "允许", { ts: "1780000000.100000" }),
    s.event("wrong-thread", `审批 ${card.id} 允许`, { thread_ts: "1780000001.000000" }),
    s.event("wrong-code", "审批 0000000000 允许"),
    s.event("ambiguous", "看起来还行，可以的话就批"),
  ]) {
    s.bridge.accept(message, "UBOT");
    await s.bridge.processOne();
  }
  assert.equal(s.calls.length, 0);
  item.pending_id = "replaced";
  s.bridge.accept(s.event("stale", "允许"), "UBOT");
  await s.bridge.processOne();
  assert.equal(s.calls.length, 0);
  await s.bridge.notify();
  s.now.value += 601000;
  await s.flush();
  s.bridge.accept(s.event("expired-card", "允许"), "UBOT");
  await s.bridge.processOne();
  assert.equal(s.calls.length, 0);
});

test("只批准显式列出的真实普通文件，路径重定向、任意 Shell 和互动问题不获放行", async t => {
  const s = setup(t);
  const alias = join(s.root, "alias.md");
  symlinkSync(s.file, alias);
  s.config.approvals.readFiles.push(alias);
  s.request(1, { action: { type: "command", path: s.file, command: "cat somewhere", redacted: false } });
  s.request(2, { action: { type: "file_read", path: alias, redacted: false } });
  s.request(3, { human_input: true });
  await s.bridge.notify();
  await s.flush();
  const cards = s.journal.approvalsFor(s.source);
  assert.equal(cards.length, 2);
  assert.ok(cards.every(card => card.subject.read === undefined));
  const card = cards[0];
  s.bridge.accept(s.event("unsafe", `审批 ${card.id} 允许这次`), "UBOT");
  await s.bridge.processOne();
  assert.equal(s.calls.length, 0);
  assert.ok(s.posts.every(post => !post.includes("cat somewhere")));
});

test("Kandev 成功响应必须确认原请求代次、会话、选项与处置类型", async () => {
  const client = new Kandev({ url: "http://localhost:38439", workspace: ws });
  const identity = { task_id: taskId, session_id: sessionId, request_id: ws, pending_id: "p" };
  let received;
  client.mcp = async (tool, args) => {
    received = { tool, args };
    return { ...args, status: "resolved", source: "external_mcp", option_kind: "allow_once" };
  };
  await client.resolvePermission(identity, { option_id: "x", kind: "allow_once" });
  assert.deepEqual(received.args, { ...identity, option_id: "x" });
  await assert.rejects(client.resolvePermission(identity, { option_id: "x", kind: "reject_once" }), /未确认/);
});

test("Claude 中文审批使用无工具的独立结构化模式，前后语义不一致时不执行", async t => {
  const s = setup(t);
  const received = [];
  s.approvals.interpret = claudeIntake("test-fixture", async (_cmd, args, _cwd, _env, input) => {
    if (args[0] === "auth") return { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "pro" };
    received.push({ args, input });
    return { structured_output: { intent: "remember" } };
  }, { approval: true });
  s.request(1);
  await s.bridge.notify();
  await s.flush();
  s.bridge.accept(s.event("only-file", "只允许读取这个文件。"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  assert.deepEqual(JSON.parse(received[0].input), { message: "只允许读取这个文件", kind: "tool" });
  assert.equal(received[0].args[received[0].args.indexOf("--tools") + 1], "");
  assert.match(s.posts.at(-1), /不够明确/);
  assert.equal(s.calls.length, 0);
});

test("进程断开后执行中的审批归为结果待核对，不再调用写接口", () => {
  const root = mkdtempSync(join(tmpdir(), "rea-replay-"));
  try {
    const file = join(root, "journal.sqlite");
    let journal = new Journal(file);
    const now = Date.now();
    const card = journal.openApproval("approval", "tool", { user: "U1", channel: "D1", thread }, { id: "request" }, now, now + 100000);
    assert.equal(journal.moveApproval(card, "pending", "executing"), true);
    journal.close();
    journal = new Journal(file);
    assert.equal(journal.approval(card.id).state, "uncertain");
    assert.equal(journal.moveApproval(card, "pending", "executing"), false);
    journal.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const head = "a".repeat(40), baseHead = "b".repeat(40), commit = "c".repeat(40);
const prFile = { filename: "docs/演示.md", status: "modified", patch: "+测试" };
function githubFixture() {
  const state = {
    pr: {
      number: 12, draft: false, state: "open", merged: false, changed_files: 1, user: { login: "author" },
      base: { ref: base, sha: baseHead, repo: { full_name: slug } },
      head: { ref: "example", sha: head, repo: { full_name: slug } },
    },
    files: [prFile], repo: { full_name: slug, default_branch: "main", allow_merge_commit: true,
      permissions: { push: true, admin: false, maintain: false } },
    actor: { login: "operator" },
    threads: { headRefOid: head, baseRefName: base, mergeStateStatus: "CLEAN",
      reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } },
    reviews: [{ user: { login: "reviewer" }, state: "APPROVED", commit_id: head, author_association: "COLLABORATOR",
      body: "Claude 独立审查：通过" }],
    actions: { total_count: 1, workflow_runs: [{ id: 21, head_sha: head, event: "pull_request", path: ".github/workflows/checks.yml",
      repository: { full_name: slug }, pull_requests: [{ number: 12 }], status: "completed", conclusion: "success" }] },
    checks: { total_count: 1, check_runs: [{ app: { slug: "github-actions" }, name: "check",
      details_url: `https://github.com/${slug}/actions/runs/21/job/31`, pull_requests: [{ number: 12 }],
      head_sha: head, status: "completed", conclusion: "success" }] },
    legacy: { total_count: 0, statuses: [] }, merges: [],
  };
  const api = async args => {
    const [path] = args;
    if (path === "user") return state.actor;
    if (path === "graphql") return { data: { repository: { pullRequest: state.threads } } };
    if (path === "--method") {
      state.merges.push(args);
      state.pr.merged = true;
      state.pr.merge_commit_sha = commit;
      return { merged: true, sha: commit };
    }
    const url = path.slice(`repos/${slug}`.length);
    if (!url) return state.repo;
    if (url === "/pulls/12") return state.pr;
    if (url.startsWith("/pulls/12/files")) return state.files;
    if (url.startsWith("/pulls/12/reviews")) return state.reviews;
    if (url.includes("/check-runs?")) return state.checks;
    if (url.includes("/checks.yml/runs?")) return state.actions;
    if (url.includes("/status?")) return state.legacy;
    throw new Error("未知 API");
  };
  const client = new GitHubApproval({ kandev: { slug, base }, approvals: {
    merge: { reviewer: "reviewer", actor: "operator", paths: [prFile.filename] },
  } }, api);
  return { client, state };
}

test("GitHub 合并门需要确切 CI、独立评审、可合并状态和非特权账号", async () => {
  const { client, state } = githubFixture();
  const subject = await client.snapshot(12);
  assert.equal(await client.check(subject), "ready");
  state.threads.mergeStateStatus = "BLOCKED";
  assert.equal(await client.check(subject), "waiting");
  state.threads.mergeStateStatus = "CLEAN";
  state.reviews[0].commit_id = baseHead;
  assert.equal(await client.check(subject), "waiting");
  state.reviews[0].commit_id = head;
  state.reviews.push({ user: { login: "reviewer" }, state: "CHANGES_REQUESTED" });
  assert.equal(await client.check(subject), "blocked");
  state.reviews.pop();
  state.checks.check_runs[0].conclusion = "failure";
  assert.equal(await client.check(subject), "blocked");
  state.checks.check_runs[0].conclusion = "success";
  state.repo.permissions.admin = true;
  assert.equal(await client.check(subject), "waiting");
  state.repo.permissions.admin = false;
  state.pr.base.ref = "main";
  assert.equal(await client.check(subject), "changed");
  await assert.rejects(client.snapshot(12));
  state.pr.base.ref = base;
  state.pr.head.ref = "research/slack-native-approvals";
  await assert.rejects(client.snapshot(12));
  assert.equal(state.merges.length, 0);
});

test("条件合并从 Slack 绑定 PR，拒绝保留 PR，允许后等待 CI 并回执真实结果字段", async t => {
  const { client, state } = githubFixture();
  const s = setup(t, { github: client });
  s.bridge.accept(s.event("merge1", "合并 PR #12"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  s.bridge.accept(s.event("no", "先不要合并。"), "UBOT");
  await s.bridge.processOne();
  await s.bridge.notify();
  assert.equal(state.merges.length, 0);

  s.bridge.accept(s.event("merge2", "合并 PR #12"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  assert.ok(s.posts.some(post => post.includes(head)));
  const card = s.journal.approvalsFor(s.source).find(item => item.state === "pending");
  const reply = s.event("yes", `审批 ${card.id} CI 和审查通过以后再合并。`);
  state.actions.workflow_runs[0].status = "in_progress";
  s.bridge.accept(reply, "UBOT");
  await s.bridge.processOne();
  await s.bridge.notify();
  assert.equal(state.merges.length, 0);
  state.actions.workflow_runs[0].status = "completed";
  await s.bridge.notify();
  assert.equal(s.bridge.accept(reply, "UBOT"), false);
  await s.bridge.notify();
  await s.flush();
  assert.equal(state.merges.length, 1);
  assert.ok(state.merges[0].includes(`sha=${head}`));
  assert.ok(s.posts.some(post => post.includes(`Merge Commit ${commit}`)));
});

test("限一次合并的句式不扩大到发布，显式变更的 HEAD 使授权过期", async t => {
  const { client, state } = githubFixture();
  const s = setup(t, { github: client });
  s.bridge.accept(s.event("merge", "合并 PR #12"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  s.bridge.accept(s.event("yes", "允许合并这个 PR，但不要发布。"), "UBOT");
  await s.bridge.processOne();
  state.pr.head.sha = "d".repeat(40);
  await s.bridge.notify();
  await s.flush();
  assert.equal(state.merges.length, 0);
  assert.ok(s.posts.some(post => /需要重新审批/.test(post)));
});


test("延迟回复使用实时原生请求和期限，旧说明继续可查", async t => {
  const s = setup(t);
  const hour = 3600000;
  const start = s.now.value;
  validateApprovalConfig(s.config);
  s.config.approvals.toolHours = 9;
  assert.throws(() => validateApprovalConfig(s.config), /toolHours/);
  s.config.approvals.toolHours = 2;
  s.request(1);
  await s.bridge.notify();
  await s.flush();
  const first = s.journal.approvalsFor(s.source)[0];
  s.now.value = start + hour;
  s.bridge.accept(s.event("still-needed", "现在还需要这个权限吗？"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  assert.match(s.posts.at(-1), /仍在等待同一条审批/);
  assert.equal(s.calls.length, 0);
  s.bridge.accept(s.event("late", "如果还在等待，就允许。"), "UBOT");
  await s.bridge.processOne();
  assert.equal(s.calls.length, 1);

  const nativeDeadline = s.now.value + 60000;
  s.request(2, { expires_at: new Date(nativeDeadline).toISOString() });
  await s.bridge.notify();
  await s.flush();
  const second = s.journal.approvalsFor(s.source).find(c => c.subject.identity.pending_id === "provider-2");
  assert.equal(second.expires, nativeDeadline);
  s.now.value = nativeDeadline + 1000;
  s.bridge.accept(s.event("expired", `审批 ${second.id} 允许这次。`), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  assert.match(s.posts.at(-1), /这条审批已失效，未执行任何操作/);
  s.bridge.accept(s.event("historic", `审批 ${first.id} 为什么需要？`), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  assert.match(s.posts.at(-1), /请求读取/);
  assert.equal(s.calls.length, 1);
});

test("多卡线程不会把延迟同意转给新操作，历史卡可撤销跨小时只读授权", async t => {
  const s = setup(t);
  const hour = 3600000;
  s.request(1);
  await s.bridge.notify();
  await s.flush();
  s.bridge.accept(s.event("grant-long", "允许这个任务接下来的同类只读操作。"), "UBOT");
  await s.bridge.processOne();
  s.now.value += 3 * hour;
  s.request(2);
  await s.bridge.notify();
  assert.equal(s.calls.length, 2);
  s.bridge.accept(s.event("revoke", "取消之前的持续授权。"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  assert.ok(s.posts.some(text => text.includes("已撤销 1 条")));
  s.request(3);
  await s.bridge.notify();
  await s.flush();
  s.bridge.accept(s.event("ambiguous-old", "如果还在等待，就允许。"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  assert.ok(s.posts.some(text => text.includes("有多条审批记录")));
  assert.equal(s.calls.length, 2);
});

test("条件合并遇 CI 失败会撤销，包括检查修复后也不重放", async t => {
  const { client, state } = githubFixture();
  const s = setup(t, { github: client });
  s.config.approvals.mergeHours = 24;
  s.bridge.accept(s.event("open-block", "合并 PR #12"), "UBOT");
  await s.bridge.processOne();
  await s.flush();
  const [card] = s.journal.approvalsFor(s.source);
  assert.equal(card.expires - card.created, 24 * 3600000);
  s.bridge.accept(s.event("confirm-block", "CI 和审查通过以后再合并。"), "UBOT");
  await s.bridge.processOne();
  state.actions.workflow_runs[0].conclusion = "failure";
  await s.bridge.notify();
  assert.equal(s.journal.approval(card.id).state, "expired");
  state.actions.workflow_runs[0].conclusion = "success";
  await s.bridge.notify();
  assert.equal(state.merges.length, 0);
});
