import { randomUUID } from "node:crypto";

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const nativeApprovals = /^(?:kandev_|mcp__kandev__|mcp\.kandev\.)(?:get_task_plan|create_task_plan|update_task_plan|step_complete)_kandev$/;
const models = { "antigravity-acp": "gemini-4-neon", "claude-acp": "default", "codex-acp": "gpt-6.2-sol" };

export class Kandev {
  constructor(config, { fetcher = fetch, WebSocketClass = WebSocket } = {}) {
    const url = new URL(config.url);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
        || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Kandev 必须使用本机回环地址");
    }
    this.url = url.origin;
    this.route = config;
    this.fetch = fetcher;
    this.WebSocket = WebSocketClass;
  }

  async rest(path) {
    const response = await this.fetch(this.url + "/api/v1" + path, {
      signal: AbortSignal.timeout(12000), redirect: "error",
    });
    if (!response.ok) throw new Error("Kandev REST 请求失败");
    return response.json();
  }

  async mcp(method, arguments_) {
    const send = async (request, sid) => {
      const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
      if (sid) headers["Mcp-Session-Id"] = sid;
      const response = await this.fetch(this.url + "/mcp", {
        headers, method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ jsonrpc: "2.0", ...request }),
      });
      if (!response.ok) throw new Error("Kandev MCP 请求失败");
      const text = await response.text();
      const json = response.headers.get("content-type")?.includes("event-stream")
        ? text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)))
          .find(message => message.id === request.id)
        : text ? JSON.parse(text) : {};
      return [json, response.headers.get("Mcp-Session-Id")];
    };
    const [, sid] = await send({ id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "rea-slack-intake", version: "1" },
    } });
    if (!sid) throw new Error("Kandev 未返回 MCP 会话");
    await send({ method: "notifications/initialized" }, sid);
    const [reply] = await send({ id: 2, method: "tools/call", params: { name: method, arguments: arguments_ } }, sid);
    const content = reply?.result?.content?.[0]?.text;
    if (!content || reply.error || reply.result.isError) throw new Error(`Kandev 未接受 ${method}`);
    try { return JSON.parse(content); } catch { return content; }
  }

  ws(action, payload) {
    const socket = new this.WebSocket(this.url.replace(/^http:/, "ws:") + "/ws");
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Kandev 操作结果待核对")), 15000);
      function finish(error, result) {
        clearTimeout(timer);
        socket.close();
        if (error) reject(error);
        else resolve(result);
      }
      socket.addEventListener("open", () => socket.send(JSON.stringify({ id, type: "request", action, payload })));
      socket.addEventListener("error", () => finish(new Error("Kandev WebSocket 连接失败")));
      socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        if (message.type === "error" || message.error) finish(new Error(`Kandev 未接受 ${action}`));
        else finish(null, message.payload);
      });
    });
  }

  async checkRepository() {
    const route = this.route;
    const [{ repositories }, { profiles }] = await Promise.all([
      this.rest(`/workspaces/${route.workspace}/repositories`), this.rest("/executor-profiles"),
    ]);
    const repo = repositories.find(item => item.id === route.repository);
    if (repo?.remote_url?.replace(/\.git$/, "") !== `https://github.com/${route.slug}`) {
      throw new Error("本地配置与 Kandev 仓库远端不一致");
    }
    if (!profiles.some(item => item.id === route.executor && item.executor_id === "exec-worktree")) {
      throw new Error("配置未绑定到 Kandev Worktree 执行器");
    }
  }

  async scope(id) {
    if (!UUID.test(id)) throw new Error("任务 ID 无效");
    const task = await this.rest(`/tasks/${id}`);
    if (task.workspace_id !== this.route.workspace || task.repositories?.length !== 1
        || task.repositories[0].repository_id !== this.route.repository) {
      throw new Error("任务不属于授权仓库");
    }
    return task;
  }

  async workflow(depth) {
    const route = this.route;
    const id = route.workflows[depth];
    const { workflows } = await this.rest(`/workspaces/${route.workspace}/workflows`);
    if (!workflows.some(item => item.id === id)) throw new Error("执行深度未绑定到本工作区的 Kandev 工作流");
    const [{ steps }, { agents }] = await Promise.all([
      this.rest(`/workflows/${id}/workflow/steps`), this.rest("/agents"),
    ]);
    const profiles = new Map(agents.flatMap(agent => (agent.profiles ?? []).map(profile => [profile.id, { ...profile, type: agent.name }])));
    for (const step of steps.filter(item => !item.complete_task_on_enter && !item.is_start_step)) {
      const profile = profiles.get(step.agent_profile_id);
      if (!profile?.enabled || profile.auto_fallback || this.route.profiles[profile.type] !== profile.id
          || profile.model !== models[profile.type] || (profile.type === "antigravity-acp" && !profile.require_exact_model)) {
        throw new Error("Kandev 工作流使用未授权、停用或可自动回退的 Agent");
      }
    }
    const start = steps.find(item => item.is_start_step);
    const execute = steps.find(item => item.position === 1);
    if (start?.name !== "等待启动" || start.agent_profile_id || start.events?.on_enter?.length || !execute) {
      throw new Error("工作流缺少无自动执行的入口");
    }
    return { id, start: start.id, execute: execute.id, profile: execute.agent_profile_id };
  }

  async create({ depth, id, title, prompt, hold = false }) {
    await this.checkRepository();
    const workflow = await this.workflow(depth);
    const route = this.route;
    const created = await this.mcp("create_task_kandev", {
      title, prompt, external_id: `rea-slack:${id}`, workspace_id: route.workspace,
      repository_id: route.repository, base_branch: route.base, workflow_id: workflow.id,
      workflow_step_id: workflow.start, agent_profile_id: workflow.profile,
      executor_profile_id: route.executor, start_agent: false,
    });
    const task = await this.scope(created.id);
    if (task.external_id !== `rea-slack:${id}` || task.repositories[0].base_branch !== route.base) {
      throw new Error("Kandev 返回的任务与已核对建单意图不一致");
    }
    if (!hold && route.autoStart === true && task.workflow_step_id === workflow.start) return this.start(task, workflow);
    return task;
  }

  async start(task, workflow) {
    await this.mcp("move_task_kandev", {
      task_id: task.id, workflow_id: workflow.id, workflow_step_id: workflow.execute,
    });
    const result = await this.status(task.id);
    if (result.workflow_id !== workflow.id || result.workflow_step_id === workflow.start) {
      throw new Error("Kandev 未确认任务进入执行步骤");
    }
    return result;
  }

  async status(id) {
    const task = await this.scope(id);
    const { steps } = await this.rest(`/workflows/${task.workflow_id}/workflow/steps`);
    return { ...task, stage: steps.find(step => step.id === task.workflow_step_id)?.name ?? task.workflow_step_id };
  }

  async plan(id) {
    await this.scope(id);
    return this.ws("task.plan.get", { task_id: id });
  }

  async pause(id) {
    await this.scope(id);
    await this.ws("orchestrator.stop", { task_id: id, reason: "Slack 用户已确认暂停", force: false });
    return this.status(id);
  }

  async resume(id) {
    const task = await this.scope(id);
    if (["COMPLETED", "CANCELLED"].includes(task.state)) throw new Error("终态任务需在 Kandev 中另行处理");
    const depth = Object.keys(this.route.workflows).find(key => this.route.workflows[key] === task.workflow_id);
    if (!depth) throw new Error("此工作流的恢复入口未授权");
    await this.checkRepository();
    const workflow = await this.workflow(depth);
    if (task.workflow_step_id === workflow.start) return this.start(task, workflow);
    const { sessions } = await this.rest(`/tasks/${id}/sessions`);
    const session = sessions.find(item => item.id === task.primary_session_id);
    if (!session || session.repository_id !== this.route.repository
        || !Object.values(this.route.profiles).includes(session.agent_profile_id)
        || !["CREATED", "WAITING_FOR_INPUT", "CANCELLED"].includes(session.state)) {
      throw new Error("当前会话不具备安全恢复条件");
    }
    if (session.pending_action || task.task_pending_action) throw new Error("任务有待决事项，请先处理");
    await this.ws("session.launch", {
      task_id: id, session_id: session.id, intent: session.state === "CREATED" ? "start_created" : "resume",
      prompt: session.state === "CREATED" ? task.description : "继续当前已授权任务。先核对当前工作树、任务计划与已验证状态。",
    });
    return this.status(id);
  }

  async retarget(id, title, prompt) {
    const task = await this.scope(id);
    if (task.state !== "CREATED" || task.primary_session_state && task.primary_session_state !== "CREATED") {
      throw new Error("目标调整仅支持尚未启动的任务。已开始的任务请在 Kandev 内核对范围");
    }
    await this.mcp("update_task_kandev", { task_id: id, title, description: prompt });
    return this.status(id);
  }

  async changeDepth(id, depth) {
    const task = await this.scope(id);
    if (task.state !== "CREATED" || task.primary_session_state && task.primary_session_state !== "CREATED") {
      throw new Error("跨工作流调整只支持未启动任务。运行中由本阶段记录影响并请求额外验收");
    }
    const workflow = await this.workflow(depth);
    if (task.workflow_id !== workflow.id) {
      await this.mcp("move_task_kandev", { task_id: id, workflow_id: workflow.id, workflow_step_id: workflow.start });
    }
    const changed = await this.status(id);
    if (changed.workflow_id !== workflow.id) throw new Error("Kandev 未确认切换执行深度");
    return changed;
  }

  async review(id, eventID) {
    const task = await this.status(id);
    if (!/^Claude (?:独立审查|复核(?:（第[1-3]轮）)?)$/.test(task.stage)) {
      throw new Error("当前阶段没有可接收追加审查的 Claude 会话");
    }
    const { sessions } = await this.rest(`/tasks/${id}/sessions`);
    const session = sessions.find(item => item.id === task.primary_session_id);
    if (session?.repository_id !== this.route.repository || !session.queue_incarnation_id
        || session.agent_profile_id !== this.route.profiles["claude-acp"]) throw new Error("未找到当前任务的 Claude 审查会话");
    await this.ws("message.queue.add", {
      task_id: id, session_id: session.id, session_incarnation_id: session.queue_incarnation_id,
      client_queue_id: eventID, require_primary_session: true,
      content: "用户请求再次独立审查。只核对当前已授权范围、真实测试、风险与验收证据，并记录结论。",
    });
    return this.status(id);
  }

  async pending(id) {
    await this.scope(id);
    const data = await this.mcp("list_pending_agent_permissions_kandev", { task_id: id });
    return data.permissions ?? [];
  }

  async safeApproval(id, requestID) {
    const pending = (await this.pending(id)).filter(item => !requestID || item.request_id === requestID);
    if (pending.length !== 1) return null;
    const item = pending[0];
    const option = item.options?.find(candidate => candidate.kind === "allow_once");
    if (!option || !nativeApprovals.test(item.title) || item.action?.type !== "other") return null;
    return {
      task_id: id, session_id: item.session_id, request_id: item.request_id, pending_id: item.pending_id,
      option_id: option.option_id, title: item.title,
    };
  }

  async approve(saved) {
    const next = await this.safeApproval(saved.task_id, saved.request_id);
    if (!next || JSON.stringify(next) !== JSON.stringify(saved)) throw new Error("原权限请求已失效或变化");
    const { title, ...args } = next;
    const result = await this.mcp("resolve_agent_permission_kandev", args);
    if (result.status !== "resolved") throw new Error("Kandev 未确认授权");
    return title;
  }
}
