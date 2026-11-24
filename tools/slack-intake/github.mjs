import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hasSecret } from "./policy.mjs";

const exec = promisify(execFile);
const sha = /^[a-f\d]{40}$/i;
const reviewThreads = `query($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
    headRefOid baseRefName mergeStateStatus reviewThreads(first:100) {
      pageInfo { hasNextPage } nodes { isResolved isOutdated }
    }
  } }
}`;

async function cli(args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "GH_CONFIG_DIR", "GH_TOKEN", "GITHUB_TOKEN"].includes(key)));
  env.GH_PROMPT_DISABLED = "1";
  const { stdout } = await exec("gh", ["api", "--hostname", "github.com", ...args], {
    env, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export class GitHubApproval {
  constructor(config, api = cli) {
    this.slug = config.kandev.slug;
    this.base = config.kandev.base;
    this.policy = config.approvals.merge;
    this.api = api;
  }

  get(endpoint) {
    return this.api([`repos/${this.slug}${endpoint}`]);
  }

  async snapshot(number) {
    if (!Number.isSafeInteger(number) || number < 1 || number > 999999999) throw new Error("PR 编号无效");
    const pr = await this.get(`/pulls/${number}`);
    if (pr.number !== number || pr.state !== "open" || pr.draft || pr.merged
        || pr.base?.repo?.full_name !== this.slug || pr.head?.repo?.full_name !== this.slug
        || pr.base?.ref !== this.base || pr.head?.ref === pr.base.ref
        || /^(?:main|master)$/i.test(pr.base.ref)
        || pr.head.ref === "research/slack-native-approvals"
        || !sha.test(pr.head.sha) || !sha.test(pr.base.sha)) throw new Error("PR 超出合并范围");
    const files = await this.get(`/pulls/${number}/files?per_page=100`);
    if (!Array.isArray(files) || !files.length || files.length !== pr.changed_files || files.length >= 100
        || !files.every(file => this.policy.paths.includes(file.filename) && !file.previous_filename
          && ["added", "modified"].includes(file.status) && typeof file.patch === "string" && !hasSecret(file.patch))) {
      throw new Error("PR 含超出授权范围或无法核对的修改");
    }
    return {
      number, base: pr.base.ref, baseHead: pr.base.sha, head: pr.head.sha,
      author: pr.user.login, files: files.map(file => file.filename).sort(),
    };
  }

  async check(saved) {
    // 先读取 PR 的身份，变更即使同时进了 Draft 或关闭也会撤销既有授权。
    const pr = await this.get(`/pulls/${saved.number}`);
    if (pr.head?.sha !== saved.head || pr.base?.sha !== saved.baseHead || pr.base?.ref !== saved.base
        || pr.head?.repo?.full_name !== this.slug || pr.base?.repo?.full_name !== this.slug
        || pr.state !== "open" || pr.draft || pr.merged) return "changed";
    const current = await this.snapshot(saved.number);
    if (JSON.stringify(current) !== JSON.stringify(saved)) return "changed";

    const [owner, name] = this.slug.split("/");
    const [actor, repo, reviews, threads, actions, checks, legacy] = await Promise.all([
      this.api(["user"]), this.get(""), this.get(`/pulls/${saved.number}/reviews?per_page=100`),
      this.api(["graphql", "-f", `query=${reviewThreads}`, "-f", `owner=${owner}`, "-f", `repo=${name}`, "-F", `number=${saved.number}`]),
      this.get(`/actions/workflows/checks.yml/runs?event=pull_request&head_sha=${saved.head}&per_page=100`),
      this.get(`/commits/${saved.head}/check-runs?per_page=100`),
      this.get(`/commits/${saved.head}/status?per_page=100`),
    ]);
    if (actor.login?.toLowerCase() !== this.policy.actor.toLowerCase() || actor.login.toLowerCase() === saved.author.toLowerCase()
        || repo.full_name !== this.slug || repo.default_branch === saved.base || !repo.allow_merge_commit
        || !repo.permissions?.push || repo.permissions.admin !== false || repo.permissions.maintain !== false) return "waiting";
    const status = threads.data?.repository?.pullRequest;
    if (status?.headRefOid !== saved.head || status.baseRefName !== saved.base
        || status.mergeStateStatus !== "CLEAN" || status.reviewThreads?.pageInfo?.hasNextPage !== false
        || !status.reviewThreads.nodes.every(thread => thread.isResolved || thread.isOutdated)) return "waiting";

    // Review 按 GitHub 返回的时间顺序折叠，仅有明确状态的审查会替换前一次决定。
    if (!Array.isArray(reviews) || reviews.length >= 100) return "waiting";
    const decisions = new Map();
    for (const review of reviews) {
      if (review.user?.login && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) {
        decisions.set(review.user.login.toLowerCase(), review);
      }
    }
    const reviewer = this.policy.reviewer.toLowerCase();
    const approval = decisions.get(reviewer);
    if (reviewer === saved.author.toLowerCase() || approval?.state !== "APPROVED" || approval.commit_id !== saved.head
        || !["OWNER", "MEMBER", "COLLABORATOR"].includes(approval.author_association)
        || !/^Claude 独立审查[:：]通过[。]?$/m.test(approval.body ?? "")
        || [...decisions.values()].some(review => review.state === "CHANGES_REQUESTED")) return "waiting";

    const runs = actions.workflow_runs;
    if (!Array.isArray(runs) || !Number.isInteger(actions.total_count) || actions.total_count !== runs.length || runs.length >= 100
        || !Number.isInteger(checks.total_count) || checks.total_count !== checks.check_runs?.length || checks.total_count >= 100
        || !Number.isInteger(legacy.total_count) || legacy.total_count !== legacy.statuses?.length || legacy.total_count >= 100) return "waiting";
    const currentRun = runs.filter(run => run.head_sha === saved.head && run.event === "pull_request"
      && run.path === ".github/workflows/checks.yml" && run.repository?.full_name === this.slug
      && run.pull_requests?.some(item => item.number === saved.number)).sort((a, b) => b.id - a.id)[0];
    if (currentRun?.status !== "completed" || currentRun.conclusion !== "success"
        || !checks.check_runs.some(check => check.app?.slug === "github-actions" && check.name === "check"
          && check.details_url?.startsWith(`https://github.com/${this.slug}/actions/runs/${currentRun.id}/job/`)
          && check.pull_requests?.some(item => item.number === saved.number))
        || checks.check_runs.some(check => check.head_sha !== saved.head || check.status !== "completed" || check.conclusion !== "success")
        || legacy.statuses.some(status => status.state !== "success")) return "waiting";
    return "ready";
  }

  async merge(saved) {
    // GitHub 的原生合并使用精确 HEAD，普通接口继续执行该分支的规则。
    const pr = await this.get(`/pulls/${saved.number}`);
    if (pr.head?.sha !== saved.head || pr.base?.ref !== saved.base || pr.base?.sha !== saved.baseHead
        || pr.state !== "open" || pr.draft || pr.merged) throw new Error("PR 在合并前发生变化");
    const result = await this.api([
      "--method", "PUT", `repos/${this.slug}/pulls/${saved.number}/merge`,
      "-f", `sha=${saved.head}`, "-f", "merge_method=merge",
    ]);
    if (result.merged !== true || !sha.test(result.sha)) throw new Error("GitHub 未确认合并");
    const confirmed = await this.get(`/pulls/${saved.number}`);
    if (confirmed.merged !== true || confirmed.merge_commit_sha !== result.sha
        || confirmed.base?.ref !== saved.base || confirmed.head?.sha !== saved.head) {
      throw new Error("合并提交未获 GitHub 复核确认");
    }
    return result.sha;
  }
}
