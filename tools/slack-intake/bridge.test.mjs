import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Bridge } from "./bridge.mjs";
import { Journal } from "./journal.mjs";
import { Kandev } from "./kandev.mjs";
import { Slack } from "./slack.mjs";

const id = "3913f503-9373-40af-b9db-e0eeb193527d";
const repo = "51113a11-1c21-4eba-9b16-1a0abd05383e";
const config = {
  slack: { team: "T1", app: "A1", users: ["U1"], channels: ["D1"] },
  kandev: { viewUrl: "http://localhost:38439", slug: "cbp0522/lianaihenmang-rea",
    base: "research/kandev-native-antigravity" },
};
const decision = (action, changes = {}) => ({
  action, reply: "先讨论方案。", title: "样本文档改进", goal: "完善说明",
  acceptance: ["核对文案"], task: "", depth: "light", risks: [], uncertain: false, ...changes,
});
const event = (id, text, props = {}, payload = {}) => ({
  type: "events_api", payload: { type: "event_callback", api_app_id: "A1", team_id: "T1", event_id: id,
    event: { type: "message", channel_type: "im", channel: "D1", user: "U1", ts: "1910000000.000001", text, ...props },
    ...payload },
});
const task = { id, title: "样本", state: "CREATED", stage: "等待启动", workflow_step_id: id };
function setup(journal, options = {}) {
  const posts = [];
  const calls = [];
  const bridge = new Bridge({ config, journal, intake: async () => decision("discuss"),
    slack: { post: async (channel, thread, text) => posts.push({ channel, thread, text }) },
    kandev: {
      create: async input => { calls.push(input); return task; },
      status: async () => task,
      plan: async () => null,
    }, ...options });
  return { bridge, posts, calls };
}

test("验证私聊来源、拒绝其他用户和工作区并去重", async () => {
  const journal = new Journal(":memory:");
  const { bridge, calls, posts } = setup(journal, { intake: async () => decision("create") });
  for (const envelope of [
    event("a", "建单", { user: "U2" }), event("b", "建单", { channel: "D2" }),
    event("c", "建单", { bot_id: "B1" }), event("d", "建单", { channel_type: "channel" }),
    event("e", "建单", {}, { team_id: "T2" }), event("f", "建单", {}, { api_app_id: "A2" }),
  ]) assert.equal(bridge.accept(envelope, "UBOT"), false);
  assert.equal(bridge.accept(event("g", "给键盘扩展增加一条文档，暂不启动"), "UBOT"), true);
  assert.equal(bridge.accept(event("g", "给键盘扩展增加一条文档，暂不启动"), "UBOT"), false);
  await bridge.processOne();
  await bridge.deliverOne();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].depth, "deep");
  assert.equal(calls[0].hold, true);
  assert.match(calls[0].prompt, /cbp0522\/lianaihenmang-rea/);
  assert.doesNotMatch(calls[0].prompt, /暂不启动/);
  assert.match(posts[0].text, /CREATED/);
  journal.close();
});

test("保留讨论和权限边界，任务状态来自 Kandev", async () => {
  const journal = new Journal(":memory:");
  let result = decision("create");
  const { bridge, calls, posts } = setup(journal, { intake: async () => result });
  bridge.accept(event("h", "先讨论要不要改"), "UBOT");
  await bridge.processOne();
  assert.equal(calls.length, 0);
  bridge.accept(event("i", "请补充样本说明"), "UBOT");
  await bridge.processOne();
  assert.equal(calls.length, 1);
  result = decision("status");
  bridge.accept(event("j", "刚才的任务到了哪里"), "UBOT");
  await bridge.processOne();
  while (await bridge.deliverOne()) {}
  assert.match(posts.at(-1).text, /CREATED · 等待启动/);
  assert.match(posts.at(-1).text, new RegExp(id));
  assert.deepEqual(journal.history({ user: "U2", channel: "D1", thread: "1910000000.000001" }), []);
  journal.close();
});

test("任务控制确认码绑定发送者与线程且只能用一次", async () => {
  const journal = new Journal(":memory:");
  const source = { user: "U1", channel: "D1", thread: "1.1" };
  const code = journal.confirm(source, { id, action: "pause" }, 120);
  assert.equal(journal.takeConfirmation({ ...source, thread: "2.2" }, code, 121), undefined);
  assert.equal(journal.takeConfirmation({ ...source, user: "U2" }, code, 121), undefined);
  assert.deepEqual(journal.takeConfirmation(source, code, 121), { id, action: "pause" });
  assert.equal(journal.takeConfirmation(source, code, 121), undefined);
  const old = journal.confirm(source, { id, action: "pause" }, 120);
  assert.equal(journal.takeConfirmation(source, old, 700000), undefined);
  journal.close();
});

test("真实 SQLite 重启后限流通知补发且报告只投递一次", async () => {
  const home = mkdtempSync(join(tmpdir(), "rea-journal-"));
  const file = join(home, "delivery.sqlite");
  let journal = new Journal(file);
  const content = "## Slack 执行报告\n摘要：样本测试通过\nhttps://github.com/cbp0522/lianaihenmang-rea/pull/7";
  const kandev = { status: async () => ({ ...task, state: "COMPLETED" }), plan: async () => ({ content }) };
  let written = 0;
  const saveReport = async (taskID, report) => {
    assert.equal(taskID, id);
    assert.match(report, /样本测试通过/);
    written++;
  };
  const now = Date.now() + 3000;
  try {
    journal.bind({ user: "U1", channel: "D1", thread: "1.1" }, id, task.title, "light");
    let { bridge } = setup(journal, { kandev, saveReport, slack: { post: async () => {
      throw Object.assign(new Error("429"), { retryAfter: 1000 });
    } } });
    await bridge.notify();
    assert.equal(await bridge.deliverOne(now), true);
    journal.close();
    journal = new Journal(file);
    const next = setup(journal, { kandev, saveReport });
    await next.bridge.notify();
    assert.equal(await next.bridge.deliverOne(now + 500), false);
    assert.equal(await next.bridge.deliverOne(now + 1000), true);
    assert.equal(await next.bridge.deliverOne(now + 1000), false);
    assert.equal(written, 1);
    assert.match(next.posts[0].text, /Gemini 摘要/);
    assert.match(next.posts[0].text, /pull\/7/);
  } finally {
    journal.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("拒绝匹配 ID 但远端不符或挂载多个仓库的任务", async () => {
  const testTask = { ...task, workspace_id: id, repositories: [{ repository_id: repo }, { repository_id: id }] };
  const kandev = new Kandev({ url: "http://127.0.0.1:38439", workspace: id, repository: repo, slug: config.kandev.slug });
  kandev.rest = async path => path.endsWith("/repositories")
    ? { repositories: [{ id: repo, remote_url: "https://github.com/fixture/other" }] } : testTask;
  await assert.rejects(kandev.scope(id), /不属于授权仓库/);
  await assert.rejects(kandev.checkRepository(), /远端不一致/);
  assert.throws(() => new Kandev({ url: "https://example.com" }), /回环/);
});

test("报告已写入但 Provider 失败时通知阻塞并保存报告", async () => {
  const journal = new Journal(":memory:");
  journal.bind({ user: "U1", channel: "D1", thread: "1.1" }, id, task.title, "research");
  const saved = [];
  const { bridge, posts } = setup(journal, {
    kandev: {
      status: async () => ({ ...task, state: "REVIEW", stage: "Gemini 最终中文报告",
        primary_session_state: "WAITING_FOR_INPUT", status_summary: { turn_error: {
          stamp: "native-error-event", preview: "服务方返回的原始错误数据",
        } } }),
      plan: async () => ({ content: "## Slack 执行报告\n摘要：已核对样本证据" }),
    },
    saveReport: async (taskID, report) => saved.push([taskID, report]),
  });
  await bridge.notify();
  await bridge.notify();
  assert.equal(await bridge.deliverOne(), true);
  assert.equal(await bridge.deliverOne(), false);
  assert.deepEqual(saved, [[id, "摘要：已核对样本证据"]]);
  assert.match(posts[0].text, /Agent 最近一轮执行异常/);
  assert.match(posts[0].text, /报告已保存/);
  assert.doesNotMatch(posts[0].text, /原始错误数据|COMPLETED/);
  journal.close();
});

test("Socket Mode 回执发生在入库之后，断线后重连", async () => {
  const controller = new AbortController();
  const persisted = [];
  const acks = [];
  let connections = 0;
  class FakeSocket extends EventTarget {
    constructor() {
      super();
      const n = ++connections;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ envelope_id: `env-${n}` }),
      })));
    }
    send(raw) {
      acks.push(JSON.parse(raw).envelope_id);
      assert.deepEqual(acks, persisted);
      if (connections === 2) controller.abort();
      else this.dispatchEvent(new MessageEvent("message", { data: '{"type":"disconnect"}' }));
    }
    close() {}
  }
  const slack = new Slack({ appToken: "xapp-sample", botToken: "xoxb-sample", team: "T1" }, {
    WebSocketClass: FakeSocket,
    fetcher: async () => Response.json({ ok: true, url: "wss://wss-primary.slack.com/link" }),
  });
  const deadline = setTimeout(() => controller.abort(), 4500);
  try {
    await slack.listen(envelope => persisted.push(envelope.envelope_id), controller.signal);
    assert.deepEqual(acks, ["env-1", "env-2"]);
  } finally {
    clearTimeout(deadline);
  }
});

test("进程在发送中断开，交付结果待核对，补发不会重放建单", () => {
  const home = mkdtempSync(join(tmpdir(), "rea-delivery-"));
  const file = join(home, "delivery.sqlite");
  const journal = new Journal(file);
  const source = { id: "evt", user: "U1", channel: "D1", thread: "1.1", text: "开发" };
  journal.receive(source);
  journal.nextEvent();
  journal.finish(source, "已建单");
  assert.equal(journal.nextDelivery().id, "reply:evt");
  journal.close();
  const restarted = new Journal(file);
  try {
    assert.equal(restarted.nextEvent(), undefined);
    assert.equal(restarted.nextDelivery(), undefined);
    assert.deepEqual(restarted.failedDeliveries().map(row => ({ ...row })), [
      { id: "reply:evt", attempts: 1, error: "中断时交付结果不明" },
    ]);
    assert.equal(restarted.retryDelivery("reply:evt"), true);
    assert.equal(restarted.nextDelivery().id, "reply:evt");
  } finally {
    restarted.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("原生流程结构允许无缺陷直接通过，并将修复送回独立审查", () => {
  const generator = new URL("../slack_workflows.rb", import.meta.url);
  const yaml = execFileSync("ruby", [generator.pathname], { encoding: "utf8" });
  const groups = JSON.parse(execFileSync("ruby", ["-ryaml", "-rjson", "-e",
    "puts JSON.generate(YAML.safe_load(STDIN.read, aliases: true))"], { input: yaml, encoding: "utf8" })).workflows;
  assert.equal(groups.length, 4);
  for (const { steps } of groups) {
    assert.equal(steps[0].name, "等待启动");
    assert.deepEqual(steps[0].events, {});
    assert.equal(steps.at(-1).complete_task_on_enter, true);
    assert.deepEqual(steps.at(-2).agent_profile, {
      agent_name: "Antigravity", model: "gemini-4-neon",
    });
    for (const step of steps.slice(1, -1)) {
      assert.equal(step.profile_session_start_policy, "new");
      assert.equal(step.auto_advance_requires_signal, true);
    }
    const review = steps.find(step => step.name === "Claude 独立审查");
    if (!review) continue;
    const next = step => steps[step.events.on_turn_complete[0].config.step_position].name;
    assert.equal(next(review), "原生 Draft PR");
    for (const round of [1, 2, 3]) {
      const repair = steps.find(step => step.name === `Codex 反馈修复与复测（第${round}轮）`);
      const followup = steps.find(step => step.name === `Claude 复核（第${round}轮）`);
      assert.equal(next(repair), followup.name);
      assert.equal(next(followup), "原生 Draft PR");
      if (round === 3) assert.match(followup.prompt, /最多三轮修复/);
    }
  }
});
