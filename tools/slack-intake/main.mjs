import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Approvals, validateApprovalConfig } from "./approvals.mjs";
import { GitHubApproval } from "./github.mjs";
import { Bridge } from "./bridge.mjs";
import { claudeIntake } from "./intake.mjs";
import { Journal } from "./journal.mjs";
import { Kandev } from "./kandev.mjs";
import { Slack } from "./slack.mjs";

export function validateConfig(config) {
  const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  const { slack, kandev } = config;
  if (!/^T[A-Z0-9]+$/.test(slack?.team) || !/^A[A-Z0-9]+$/.test(slack?.app)
      || !slack.users?.length || !slack.users.every(id => /^[UW][A-Z0-9]+$/.test(id))
      || !slack.channels?.length || !slack.channels.every(id => /^D[A-Z0-9]+$/.test(id))) {
    throw new Error("须设置工作区、应用、授权用户及私聊 ID");
  }
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(kandev?.slug)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/.test(kandev.base)
      || /^(?:main|master)$|(?:\.\.|\/\/|\/$)/.test(kandev.base)
      || (kandev.autoStart !== undefined && typeof kandev.autoStart !== "boolean")
      || ![kandev.workspace, kandev.repository, kandev.executor,
        ...["light", "standard", "deep", "research"].map(key => kandev.workflows?.[key]),
        ...["antigravity-acp", "claude-acp", "codex-acp"].map(key => kandev.profiles?.[key])].every(id => uuid.test(id))) {
    throw new Error("Kandev 仓库、基线、执行器、Agent 及工作流配置不完整");
  }
  const view = new URL(kandev.viewUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(view.hostname);
  if (view.username || view.password || view.search || view.hash ||
      (view.protocol !== "https:" && !(view.protocol === "http:" && loopback))) {
    throw new Error("Kandev 查看链接应为本机或 HTTPS 私有地址");
  }
  validateApprovalConfig(config);
  return config;
}

async function files(configFile) {
  const config = validateConfig(JSON.parse(await readFile(configFile, "utf8")));
  const home = dirname(configFile);
  const tokenFile = join(home, "slack-secrets.json");
  if ((await stat(tokenFile)).mode & 0o077) throw new Error("令牌文件权限必须为 0600");
  const secrets = JSON.parse(await readFile(tokenFile, "utf8"));
  return { config, secrets, home };
}

async function main() {
  const [configFile, mode, deliveryID] = process.argv.slice(2);
  if (!configFile) throw new Error("提供私有 config.json 路径");
  process.umask(0o077);
  const { config, secrets, home } = await files(configFile);
  const journal = new Journal(join(home, "delivery.sqlite"), !mode);
  journal.installScope(JSON.stringify([config.slack.team, config.slack.app, config.kandev.workspace, config.kandev.repository]));
  if (mode === "--list-failed") {
    console.log(JSON.stringify(journal.failedDeliveries()));
    journal.close();
    return;
  }
  if (mode === "--retry-notification") {
    const updated = journal.retryDelivery(deliveryID);
    journal.close();
    if (!updated) throw new Error("通知不处于失败状态");
    console.log("通知已排入发送队列");
    return;
  }
  if (mode && mode !== "--check") throw new Error("未知启动选项");
  const kandev = new Kandev(config.kandev);
  const slack = new Slack({ ...secrets, team: config.slack.team });
  const [bot] = await Promise.all([slack.verify(), kandev.checkRepository()]);
  await Promise.all(Object.keys(config.kandev.workflows).map(depth => kandev.workflow(depth)));
  if (mode === "--check") {
    await slack.socketURL();
    journal.close();
    console.log("Slack 工作区与 Kandev 仓库、工作流绑定通过");
    return;
  }
  const reports = join(home, "reports");
  await mkdir(reports, { recursive: true, mode: 0o700 });
  const approvals = config.approvals && new Approvals({
    config, journal, kandev, github: config.approvals.merge && new GitHubApproval(config),
    interpret: claudeIntake(config.claudePath, undefined, { approval: true }),
  });
  const bridge = new Bridge({
    config, journal, kandev, slack, approvals, intake: claudeIntake(config.claudePath),
    saveReport: async (id, content) => {
      const file = join(reports, id + ".md");
      await writeFile(file + ".tmp", content + "\n", { mode: 0o600 });
      await rename(file + ".tmp", file);
    },
  });
  const controller = new AbortController();
  for (const event of ["SIGINT", "SIGTERM"]) process.once(event, () => controller.abort());
  const { signal } = controller;
  const loop = async (work, delay) => {
    while (!signal.aborted) {
      await work();
      await sleep(delay, undefined, { signal }).catch(() => {});
    }
  };
  console.log("Slack Intake 已启动");
  try {
    await Promise.all([
      slack.listen(envelope => bridge.accept(envelope, bot), signal, () => console.log("Slack Socket Mode 已确认连接")),
      loop(() => bridge.processOne(), 350),
      loop(() => bridge.deliverOne(), 500),
      loop(() => bridge.notify(), 25000),
    ]);
  } finally {
    controller.abort();
    journal.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error("Slack Intake 启动或运行失败", error.message);
    process.exitCode = 1;
  });
}
