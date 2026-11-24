import { setTimeout as sleep } from "node:timers/promises";

export class Slack {
  constructor({ appToken, botToken, team }, { fetcher = fetch, WebSocketClass = WebSocket } = {}) {
    if (!appToken?.startsWith("xapp-") || !botToken?.startsWith("xoxb-")) {
      throw new Error("需要本地 Slack App 与 Bot Token");
    }
    Object.assign(this, { appToken, botToken, team, fetch: fetcher, WebSocket: WebSocketClass });
  }
  async call(method, token, body = {}) {
    const response = await this.fetch("https://slack.com/api/" + method, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(12000),
    });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw Object.assign(new Error("Slack 限流"), { retryAfter: Math.max(1, seconds || 30) * 1000 });
    }
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error("Slack 未确认 API 操作");
    return data;
  }
  async verify() {
    const auth = await this.call("auth.test", this.botToken);
    if (auth.team_id !== this.team || !auth.user_id) throw new Error("Slack Bot 和授权工作区不匹配");
    return auth.user_id;
  }
  async post(channel, thread, text) {
    await this.call("chat.postMessage", this.botToken, {
      channel, thread_ts: thread, text, unfurl_links: false, unfurl_media: false,
    });
  }
  async socketURL() {
    const info = await this.call("apps.connections.open", this.appToken);
    const url = new URL(info.url);
    if (url.protocol !== "wss:" || !url.hostname.endsWith(".slack.com") || url.username || url.password) {
      throw new Error("Slack 返回了非预期 Socket 地址");
    }
    return url;
  }
  async listen(onEnvelope, signal, onConnected = () => {}) {
    let delay = 1000;
    while (!signal.aborted) {
      const started = Date.now();
      try {
        const socket = new this.WebSocket(await this.socketURL());
        await new Promise(resolve => {
          const finish = () => {
            socket.close();
            signal.removeEventListener("abort", finish);
            resolve();
          };
          if (signal.aborted) return finish();
          signal.addEventListener("abort", finish, { once: true });
          socket.addEventListener("close", finish, { once: true });
          socket.addEventListener("error", finish, { once: true });
          socket.addEventListener("message", event => {
            try {
              const envelope = JSON.parse(event.data);
              if (envelope.type === "disconnect") return finish();
              if (envelope.type === "hello") onConnected();
              if (typeof envelope.envelope_id === "string") {
                onEnvelope(envelope);
                socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
              }
            } catch {
              finish(); // 未持久化的事件不回执，由 Slack 重发。
            }
          });
        });
        delay = Date.now() - started > 60_000 ? 1000 : Math.min(delay * 2, 30_000);
      } catch (error) {
        delay = error.retryAfter || Math.min(delay * 2, 30_000);
      }
      await sleep(delay, undefined, { signal }).catch(() => {});
    }
  }
}
