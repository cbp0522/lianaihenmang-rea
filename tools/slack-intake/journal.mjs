import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export class Journal {
  constructor(path, recover = true) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=4000;
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY, event TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'queued', result TEXT,
        created INTEGER NOT NULL, error TEXT
      );
      CREATE TABLE IF NOT EXISTS bindings (
        task TEXT PRIMARY KEY, user TEXT NOT NULL, channel TEXT NOT NULL, thread TEXT NOT NULL,
        title TEXT NOT NULL, depth TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, user TEXT NOT NULL, channel TEXT NOT NULL, thread TEXT NOT NULL, text TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'queued', error TEXT
      );
      CREATE TABLE IF NOT EXISTS confirmations (
        code TEXT PRIMARY KEY, user TEXT NOT NULL, channel TEXT NOT NULL, thread TEXT NOT NULL,
        operation TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        event TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation (
        id TEXT PRIMARY KEY, user TEXT NOT NULL, channel TEXT NOT NULL, thread TEXT NOT NULL,
        input TEXT NOT NULL, reply TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY, scope TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approval_cards (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, user TEXT NOT NULL, channel TEXT NOT NULL, thread TEXT NOT NULL,
        subject TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approval_rules (
        scope TEXT PRIMARY KEY, kind TEXT NOT NULL, issued INTEGER NOT NULL, expires INTEGER NOT NULL
      );
    `);
    if (recover) {
      this.db.exec("UPDATE outbox SET state='failed', error='中断时交付结果不明' WHERE state='sending'");
      // Kandev 建单有外部 ID。其他动作在调用结果不明时需要重新核对状态。
      this.db.exec("UPDATE inbox SET phase='queued' WHERE phase='working'");
      this.db.exec("UPDATE approval_cards SET state='uncertain' WHERE state='executing'");
    }
  }
  installScope(scope) {
    this.db.prepare("INSERT OR IGNORE INTO installation VALUES(1,?)").run(scope);
    if (this.db.prepare("SELECT scope FROM installation WHERE id=1").get().scope !== scope) {
      throw new Error("此交付数据库属于另一个 Slack 应用或仓库");
    }
  }

  receive(event, now = Date.now()) {
    return this.db.prepare("INSERT OR IGNORE INTO inbox(id,event,created) VALUES(?,?,?)")
      .run(event.id, JSON.stringify(event), now).changes === 1;
  }
  nextEvent() {
    const row = this.db.prepare("SELECT * FROM inbox WHERE phase='queued' ORDER BY created,id LIMIT 1").get();
    if (!row) return;
    this.db.prepare("UPDATE inbox SET phase='working' WHERE id=?").run(row.id);
    return { event: JSON.parse(row.event), decision: row.result ? JSON.parse(row.result) : null };
  }
  remember(id, decision) {
    this.db.prepare("UPDATE inbox SET result=? WHERE id=?").run(JSON.stringify(decision), id);
  }
  drop(id) {
    this.db.prepare("UPDATE inbox SET phase='done',event='{}',result=NULL,error='授权已撤销' WHERE id=?").run(id);
  }
  issue(id, action, detail = "") {
    this.db.prepare("INSERT INTO audit VALUES(?,?,?,?)").run(id, action, detail, Date.now());
  }
  effect(id, action, identity) {
    const existing = this.db.prepare("SELECT 1 FROM audit WHERE event=? AND action=?").get(id, action);
    if (existing) return false;
    this.issue(id, action, identity);
    return true;
  }
  finish(event, text, error = null) {
    this.db.exec("BEGIN");
    try {
      if (text) this.enqueue(`reply:${event.id}`, event, text);
      this.db.prepare("UPDATE inbox SET phase='done',event='{}',result=NULL,error=? WHERE id=?").run(error, event.id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  bind(event, task, title, depth) {
    this.db.prepare("INSERT OR IGNORE INTO bindings VALUES(?,?,?,?,?,?,?)")
      .run(task, event.user, event.channel, event.thread, title, depth, Date.now());
  }
  recent(event) {
    return this.db.prepare("SELECT task,title,depth FROM bindings WHERE user=? AND channel=? ORDER BY created DESC LIMIT 10")
      .all(event.user, event.channel);
  }
  history(event) {
    return this.db.prepare(`SELECT input,reply FROM conversation WHERE user=? AND channel=? AND thread=?
      AND created>=? ORDER BY created DESC LIMIT 4`).all(event.user, event.channel, event.thread, Date.now() - 7 * 86400_000).reverse();
  }
  addHistory(event, reply) {
    this.db.prepare("INSERT OR IGNORE INTO conversation VALUES(?,?,?,?,?,?,?)")
      .run(event.id, event.user, event.channel, event.thread, event.text.slice(0, 900), reply, Date.now());
    this.db.prepare("DELETE FROM conversation WHERE created<?").run(Date.now() - 7 * 86400_000);
  }
  tracked() {
    return this.db.prepare("SELECT * FROM bindings ORDER BY created DESC").all();
  }
  depth(task, depth) {
    this.db.prepare("UPDATE bindings SET depth=? WHERE task=?").run(depth, task);
  }
  confirm(event, operation, now = Date.now()) {
    const code = randomBytes(8).toString("hex");
    this.db.prepare("DELETE FROM confirmations WHERE expires<?").run(now);
    this.db.prepare("INSERT INTO confirmations VALUES(?,?,?,?,?,?)")
      .run(code, event.user, event.channel, event.thread, JSON.stringify(operation), now + 600_000);
    return code;
  }
  takeConfirmation(event, code, now = Date.now()) {
    const row = this.db.prepare(`DELETE FROM confirmations WHERE code=? AND user=? AND channel=?
      AND thread=? AND expires>=? RETURNING operation`).get(code, event.user, event.channel, event.thread, now);
    return row && JSON.parse(row.operation);
  }
  openApproval(id, kind, event, subject, now, expires) {
    this.db.prepare("INSERT OR IGNORE INTO approval_cards VALUES(?,?,?,?,?,?,?,?,'pending')")
      .run(id, kind, event.user, event.channel, event.thread, JSON.stringify(subject), now, expires);
    return this.approval(id);
  }
  approval(id) {
    const row = this.db.prepare("SELECT * FROM approval_cards WHERE id=?").get(id);
    return row && { ...row, subject: JSON.parse(row.subject) };
  }
  approvalsFor(event) {
    return this.db.prepare(`SELECT id FROM approval_cards WHERE user=? AND channel=? AND thread=?
      ORDER BY created DESC LIMIT 40`).all(event.user, event.channel, event.thread).map(({ id }) => this.approval(id));
  }
  authorizedMerges() {
    return this.db.prepare("SELECT id FROM approval_cards WHERE kind='merge' AND state='authorized'")
      .all().map(({ id }) => this.approval(id));
  }
  moveApproval(card, from, to, now = Date.now()) {
    return this.db.prepare(`UPDATE approval_cards SET state=? WHERE id=? AND state=?
      AND (state='executing' OR ?='expired' OR expires>?)`).run(to, card.id, from, to, now).changes === 1;
  }
  approvalRule(scope, born, now) {
    return this.db.prepare("SELECT kind FROM approval_rules WHERE scope=? AND issued<=? AND expires>?")
      .get(scope, born, now)?.kind;
  }
  saveApprovalRule(scope, kind, expires, now) {
    this.db.prepare("DELETE FROM approval_rules WHERE expires<=?").run(now);
    this.db.prepare("INSERT OR REPLACE INTO approval_rules VALUES(?,?,?,?)").run(scope, kind, now, expires);
  }
  approvalSent(id) {
    return this.db.prepare("SELECT state FROM outbox WHERE id=?").get(`approval:${id}`)?.state === "sent";
  }
  enqueue(id, delivery, text, now = Date.now()) {
    this.db.prepare("INSERT OR IGNORE INTO outbox(id,user,channel,thread,text,due) VALUES(?,?,?,?,?,?)")
      .run(id, delivery.user, delivery.channel, delivery.thread, text, now);
  }
  hasDelivery(id) {
    return Boolean(this.db.prepare("SELECT 1 FROM outbox WHERE id=?").get(id));
  }
  nextDelivery(now = Date.now()) {
    return this.db.prepare(`UPDATE outbox SET state='sending',attempts=attempts+1
      WHERE id=(SELECT id FROM outbox WHERE state='queued' AND due<=? ORDER BY due,id LIMIT 1) RETURNING *`).get(now);
  }
  delivery(id, state, error = null, due = Date.now()) {
    this.db.prepare("UPDATE outbox SET state=?,due=?,error=? WHERE id=?").run(state, due, error, id);
  }
  retryDelivery(id) {
    return this.db.prepare("UPDATE outbox SET state='queued',attempts=0,due=?,error=NULL WHERE id=? AND state='failed'")
      .run(Date.now(), id).changes === 1;
  }
  failedDeliveries() {
    return this.db.prepare("SELECT id,attempts,error FROM outbox WHERE state='failed' ORDER BY due DESC LIMIT 30").all();
  }
  close() {
    this.db.close();
  }
}
