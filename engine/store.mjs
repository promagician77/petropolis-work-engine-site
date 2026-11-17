// The storage contract the Lambdas use, with an in-memory version that keeps
// DynamoDB's rules: every write to one item is atomic, and a conditional write
// either fully succeeds or fails with ConditionalCheckFailed. The DynamoDB
// adapter (src/lambda/lib/dynamo-store.mjs) implements the same methods.

export class ConditionalCheckFailed extends Error {
  constructor(message = 'The conditional request failed') {
    super(message);
    this.name = 'ConditionalCheckFailedException';
  }
}

const clone = (x) => (x == null ? x : structuredClone(x));
const tick = () => new Promise((r) => setTimeout(r, 0));

export function createMemoryStore({ latency = false } = {}) {
  const tasks = new Map();
  const staff = new Map();
  const actions = new Map();
  const shifts = new Map();
  const reservations = new Map();
  const meta = new Map();
  const wait = latency ? tick : async () => {};

  async function conditionalUpdate(id, condition, patch) {
    await wait(); // let other "requests" interleave, like separate Lambda calls
    const cur = tasks.get(id);
    if (!cur) return { ok: false, reason: 'not_found', task: null };
    const why = condition(cur);
    if (why !== true) return { ok: false, reason: why, task: clone(cur) };
    const next = { ...cur, ...patch, version: (cur.version ?? 1) + 1 };
    tasks.set(id, next);
    return { ok: true, task: clone(next) };
  }

  return {
    kind: 'memory',
    async putTasks(list) {
      let created = 0;
      for (const t of list) {
        if (tasks.has(t.id)) continue; // attribute_not_exists(PK): replays never double-create
        tasks.set(t.id, { version: 1, ...clone(t) });
        created++;
      }
      return { created, skipped: list.length - created };
    },
    async getTask(id) { await wait(); return clone(tasks.get(id)); },
    async listTasks(filter = () => true) { return [...tasks.values()].filter(filter).map(clone); },
    async replaceTask(t) { tasks.set(t.id, clone(t)); },

    /** Atomic claim: only succeeds while the task is still queued. */
    claim(taskId, staffId, now) {
      return conditionalUpdate(taskId, (t) => (t.status === 'queued' ? true : `already_${t.status}`), {
        status: 'assigned', staffId, assignedAt: now,
      });
    },

    /** Move a task between states if it is in one of `from` and (optionally) held by `by`. */
    transition(taskId, { from, by = null }, patch) {
      return conditionalUpdate(taskId, (t) => {
        if (!from.includes(t.status)) return `already_${t.status}`;
        if (by && t.staffId !== by) return 'held_by_other';
        return true;
      }, patch);
    },

    /** Idempotency key. true the first time an id is seen, false after (PutItem with attribute_not_exists). */
    async rememberAction(id, record = {}) {
      await wait();
      if (actions.has(id)) return false;
      actions.set(id, clone(record));
      return true;
    },

    async listOpen() { return [...tasks.values()].filter((t) => ['queued', 'assigned', 'started', 'blocked'].includes(t.status)).map(clone); },

    async putStaff(s) { staff.set(s.id, clone(s)); },
    async getStaff(id) { return clone(staff.get(id)); },
    async getStaffBySlack(uid) { return clone([...staff.values()].find((s) => s.slackUserId === uid)); },
    async updateStaff(id, patch) { staff.set(id, { ...staff.get(id), ...clone(patch) }); return clone(staff.get(id)); },
    async listStaff() { return [...staff.values()].map(clone); },

    async appendShiftEvent(staffId, ev) {
      if (!shifts.has(staffId)) shifts.set(staffId, []);
      shifts.get(staffId).push(clone(ev));
    },
    async listShiftEvents(staffId) { return clone(shifts.get(staffId) ?? []); },

    /** Keep the newest Goose version only (ConditionExpression on updated_at in DynamoDB). */
    async putReservation(raw) {
      const cur = reservations.get(raw.id);
      if (cur && Date.parse(cur.updated_at) >= Date.parse(raw.updated_at)) return { ok: false, reason: cur.updated_at === raw.updated_at ? 'unchanged' : 'stale', prev: clone(cur) };
      reservations.set(raw.id, clone(raw));
      return { ok: true, prev: clone(cur) ?? null };
    },
    async listReservations() { return [...reservations.values()].map(clone); },
    async getCursor() { return meta.get('cursor') ?? ''; },
    async setCursor(c) { meta.set('cursor', c); },
  };
}
