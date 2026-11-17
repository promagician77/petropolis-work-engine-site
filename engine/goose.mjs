// Goose -> Work Engine. The ONLY file that knows Goose field names.
//
// Goose's real payload and webhook event names are not public; the names here
// (status, lodging.unit, feeding_schedule, check_in.started ...) are placeholders
// shaped like a typical kennel system. Milestone 1 swaps them for the real feed.

import { PILOT_DATE } from './day.mjs';
import { toMin } from './util.mjs';
import { reservationTasks, addSameDayReservation, lobbyTask, checkoutCleanTask } from './tasks.mjs';

/** Raw Goose record -> internal reservation for `date`, or null if not on site that day. */
export function fromGoose(raw, date = PILOT_DATE) {
  if (!raw || raw.status === 'cancelled') return null;
  const [sd, st] = raw.start.split('T');
  const [ed, et] = raw.end.split('T');
  if (sd > date || ed < date) return null;
  const weight = Number(raw.pet?.weight_lb ?? 0);
  return {
    id: raw.id,
    version: raw.updated_at,
    status: raw.status,
    service: raw.service,
    petId: raw.pet.id,
    petName: raw.pet.name,
    species: raw.pet.species,
    weight,
    bigDog: raw.pet.species === 'dog' && weight >= 60,
    unit: raw.lodging?.unit ?? null,
    playgroup: raw.playgroup ?? null,
    arriveAt: sd === date ? toMin(st.slice(0, 5)) : null,
    departAt: ed === date ? toMin(et.slice(0, 5)) : null,
    feedings: (raw.feeding_schedule ?? []).map((f) => ({ at: toMin(f.at), meal: f.meal, amount: f.amount })),
    meds: (raw.medications ?? []).map((m) => ({ name: m.name, dose: m.dose, withFood: Boolean(m.withFood ?? m.with_food), at: m.at.map(toMin) })),
    addons: raw.add_ons ?? [],
    alerts: raw.alerts ?? [],
  };
}

/** Reservation book keyed by Goose id, with version checks so replays and out-of-order events are harmless. */
export function createBook() {
  return { byId: new Map(), cursor: '' };
}

const newer = (a, b) => Date.parse(a) > Date.parse(b);

/**
 * Apply one raw record (from a webhook or a poll). Returns
 * { change: 'created'|'updated'|'cancelled'|'unchanged'|'stale', before, after }.
 */
export function applyGooseRecord(book, raw, date = PILOT_DATE) {
  const prev = book.byId.get(raw.id);
  if (prev && prev.raw.updated_at === raw.updated_at) return { change: 'unchanged', before: prev.res, after: prev.res };
  if (prev && !newer(raw.updated_at, prev.raw.updated_at)) return { change: 'stale', before: prev.res, after: prev.res };
  const res = fromGoose(raw, date);
  book.byId.set(raw.id, { raw, res });
  if (!book.cursor || newer(raw.updated_at, book.cursor)) book.cursor = raw.updated_at;
  if (raw.status === 'cancelled') return { change: 'cancelled', before: prev?.res ?? null, after: null };
  return { change: prev ? 'updated' : 'created', before: prev?.res ?? null, after: res };
}

/**
 * Turn a reservation change into task changes at time `now`.
 * Mutates `tasks` (adds, cancels, edits queued work) and returns a summary.
 */
export function tasksForChange(tasks, result, now) {
  const summary = { added: [], updated: [], cancelled: [] };
  const { change, before, after } = result;
  if (change === 'unchanged' || change === 'stale') return summary;
  const resId = (after ?? before)?.id;
  if (!resId) return summary;

  if (change === 'cancelled' || !after) {
    for (const t of tasks) {
      if (t.status !== 'queued' || !t.reservationIds.includes(resId)) continue;
      if (t.reservationIds.length > 1) {
        const i = t.reservationIds.indexOf(resId);
        t.reservationIds = t.reservationIds.filter((_, j) => j !== i);
        t.petNames = t.petNames.filter((_, j) => j !== i);
        t.steps = t.steps.filter((_, j) => j !== i);
        t.estMinutes = Math.max(3, t.estMinutes - 2);
        t.petCount = t.petNames.length;
        summary.updated.push(t);
      } else {
        t.status = 'cancelled';
        t.reason = 'Reservation cancelled in Goose';
        t.closedAt = now;
        summary.cancelled.push(t);
      }
    }
    return summary;
  }

  if (change === 'created') {
    const { added, updated } = addSameDayReservation(tasks, after, now);
    const known = new Set(tasks.map((t) => t.id));
    for (const t of added) if (!known.has(t.id)) { tasks.push(t); summary.added.push(t); }
    summary.updated.push(...updated);
    return summary;
  }

  // Updated: regenerate this reservation's own tasks for the whole day. Cancel queued
  // tasks that no longer exist (even overdue ones); add new ones only from now on,
  // so a dose time already in the past is never created late (no double-dosing).
  const desired = new Map(reservationTasks(after).map((t) => [t.id, t]));
  for (const t of tasks) {
    if (t.status !== 'queued' || t.reservationIds.length !== 1 || t.reservationIds[0] !== resId) continue;
    if (t.source !== 'goose') continue;
    if (!desired.has(t.id)) {
      t.status = 'cancelled';
      t.reason = 'Changed in Goose';
      t.closedAt = now;
      summary.cancelled.push(t);
    } else {
      desired.delete(t.id);
    }
  }
  const known = new Set(tasks.map((t) => t.id));
  for (const t of desired.values()) {
    if (known.has(t.id) || t.dueAt < now) continue;
    t.createdAt = now;
    tasks.push(t);
    summary.added.push(t);
  }
  return summary;
}

/** Front-desk moments from Goose: a check-in or check-out has started. */
export function tasksForFrontDesk(tasks, res, kind, now) {
  const added = [];
  const known = new Set(tasks.map((t) => t.id));
  const push = (t) => { if (!known.has(t.id)) { tasks.push(t); added.push(t); } };
  if (kind === 'check_in') push(lobbyTask(res, 'in', now));
  if (kind === 'check_out') {
    push(lobbyTask(res, 'out', now));
    if (res.service === 'boarding' && res.unit) push(checkoutCleanTask(res, now));
    // Anything still queued for a pet that has left is no longer needed.
    for (const t of tasks) {
      if (t.status === 'queued' && t.reservationIds.length === 1 && t.reservationIds[0] === res.id && t.type !== 'lobby' && t.type !== 'cleaning') {
        t.status = 'cancelled';
        t.reason = 'Pet checked out';
        t.closedAt = now;
      }
    }
  }
  return added;
}

/**
 * Poll fallback. `fetchSince(cursor)` returns raw records updated after the cursor.
 * Records already seen through a webhook come back as 'unchanged', so nothing doubles.
 */
export async function pollOnce(book, tasks, fetchSince, now, date = PILOT_DATE) {
  const records = await fetchSince(book.cursor);
  const results = [];
  for (const raw of records) {
    const result = applyGooseRecord(book, raw, date);
    const summary = tasksForChange(tasks, result, now);
    results.push({ id: raw.id, change: result.change, added: summary.added.length, cancelled: summary.cancelled.length, updated: summary.updated.length });
  }
  return results;
}
