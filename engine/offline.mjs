// Offline fallback for weak phone signal.
//
// The phone keeps a queue of taps (Start, Done, Can't complete, clock events),
// each stamped with the time it happened on the device and a unique id.
// When the signal returns the queue is sent in one batch. The server applies
// each action once (the id is an idempotency key), keeps the device time as
// the record time, and reports conflicts instead of silently overwriting.

export function createOfflineQueue({ deviceId, storage = new Map(), key = 'we-offline-queue' }) {
  const load = () => {
    try { return JSON.parse(storage.get(key) ?? '{"seq":0,"items":[]}'); } catch { return { seq: 0, items: [] }; }
  };
  const save = (state) => { try { storage.set(key, JSON.stringify(state)); } catch { /* storage full or blocked: keep in memory */ } };
  let state = load();
  return {
    add(action, deviceNow) {
      state.seq += 1;
      const item = { id: `${deviceId}:${state.seq}`, at: deviceNow, ...action };
      state.items.push(item);
      save(state);
      return item;
    },
    pending() { return [...state.items]; },
    /** send(batch) -> results[{id, result}]; anything acknowledged leaves the queue. Network errors keep it. */
    async flush(send) {
      if (!state.items.length) return [];
      const batch = [...state.items];
      let results;
      try { results = await send(batch); } catch { return null; }
      const acked = new Set(results.map((r) => r.id));
      state.items = state.items.filter((i) => !acked.has(i.id));
      save(state);
      return results;
    },
    reload() { state = load(); },
  };
}

const MAX_SKEW = 10; // minutes a phone clock may run ahead before we flag it

/**
 * Server side. Applies a batch in device-time order. Each result is one of:
 *   applied       - recorded with the device's time
 *   applied_late  - recorded, but the task had been handed to someone else meanwhile (they get told to skip it)
 *   duplicate     - this action id was already applied (a retry); nothing changes
 *   conflict      - could not apply (already done by someone else, or cancelled); kept for the manager
 */
export async function applyOfflineBatch(store, batch, serverNow) {
  const results = [];
  const sorted = [...batch].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  for (const a of sorted) {
    const fresh = await store.rememberAction(a.id, { at: a.at, type: a.type, staffId: a.staffId });
    if (!fresh) { results.push({ id: a.id, result: 'duplicate' }); continue; }
    const skewed = a.at > serverNow + MAX_SKEW;
    const at = Math.min(a.at, serverNow);
    const flags = skewed ? ['clock_skew'] : [];

    if (a.type === 'clock_in' || a.type === 'clock_out' || a.type === 'break_start' || a.type === 'break_end') {
      await store.appendShiftEvent(a.staffId, { type: a.type, at, syncedAt: serverNow, offline: true });
      results.push({ id: a.id, result: 'applied', at, flags });
      continue;
    }

    if (a.type === 'start') {
      const r = await store.transition(a.taskId, { from: ['assigned'], by: a.staffId }, { status: 'started', startedAt: at });
      results.push(r.ok ? { id: a.id, result: 'applied', at, flags } : { id: a.id, result: 'conflict', reason: r.reason, flags });
      continue;
    }

    if (a.type === 'done' || a.type === 'cant') {
      const patch = a.type === 'done'
        ? { status: 'done', doneAt: at, doneBy: a.staffId, outcome: a.outcome ?? null, syncedAt: serverNow, offline: true }
        : { status: 'blocked', closedAt: at, doneBy: a.staffId, reason: a.reason ?? 'Not given', syncedAt: serverNow, offline: true };
      const mine = await store.transition(a.taskId, { from: ['assigned', 'started'], by: a.staffId }, patch);
      if (mine.ok) { results.push({ id: a.id, result: 'applied', at, flags }); continue; }
      if (mine.reason === 'held_by_other') {
        // Reassigned while this phone was offline. The work was really done, so record it and tell the other person to skip.
        const other = mine.task.staffId;
        const r = await store.transition(a.taskId, { from: ['assigned', 'started'] }, { ...patch, reassignedFrom: other });
        if (r.ok) { results.push({ id: a.id, result: 'applied_late', at, notify: other, flags }); continue; }
        results.push({ id: a.id, result: 'conflict', reason: r.reason, flags });
        continue;
      }
      results.push({ id: a.id, result: 'conflict', reason: mine.reason, flags });
      continue;
    }

    results.push({ id: a.id, result: 'conflict', reason: 'unknown_action' });
  }
  return results;
}
