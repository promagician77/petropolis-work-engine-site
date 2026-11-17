// Minute-by-minute simulation of one pilot day, driving the real engine:
// Goose feed -> tasks -> priority -> dispatch -> outcomes -> records.
// Deterministic: same seed and policy, same day, every time.

import { LOCATION, STAFF, INCIDENTS, sampleGooseFeed } from './day.mjs';
import { fromGoose, applyGooseRecord, createBook, tasksForChange, tasksForFrontDesk } from './goose.mjs';
import { generateDayTasks, dayEvents, TASK_TYPES } from './tasks.mjs';
import { dispatch } from './dispatch.mjs';
import { rank, score as scoreAt } from './priority.mjs';
import { hash, rng, median, percentile, clock } from './util.mjs';

export const SIM_END = 21 * 60; // stop the clock at 9:00 PM

export function buildDay(seed = 18) {
  const feed = sampleGooseFeed(seed);
  const book = createBook();
  for (const raw of feed.records) applyGooseRecord(book, raw);
  const reservations = [...book.byId.values()].map((x) => x.res).filter(Boolean);
  const tasks = generateDayTasks(reservations);
  const events = dayEvents(reservations, { opensAt: LOCATION.opensAt, closesAt: LOCATION.closesAt });
  return { feed, book, reservations, tasks, events };
}

/** How long a task really takes in the sim: 85%-125% of the estimate, fixed per task id. */
export const actualMinutes = (task) => Math.max(1, Math.round(task.estMinutes * (0.85 + 0.4 * rng(hash(task.id))())));

export const SCENARIOS = {
  normal: { label: 'Normal day', callOut: null },
  callout: { label: 'Sam calls out sick', callOut: 's3' },
};

/**
 * overrides: manager changes applied at a minute, e.g. [{ taskId, at: 480, pinned: true }] or { override: 20 }.
 */
export function simulateDay({ policy = 'priority', seed = 18, rules, scenario = 'normal', staffList = STAFF, overrides = [], snapshots = false } = {}) {
  const callOut = SCENARIOS[scenario]?.callOut ?? null;
  const day = buildDay(seed);
  const { feed, book, tasks } = day;
  const resById = new Map(day.reservations.map((r) => [r.id, r]));
  const log = [];
  const say = (t, kind, text, extra = {}) => log.push({ t, kind, text, ...extra });

  const timeline = day.events.map((e) => ({ ...e }));
  timeline.push({ at: feed.sameDayBooking.createdAt, kind: 'booking', raw: feed.sameDayBooking.record });

  const staff = staffList.filter((s) => s.id !== callOut).map((s) => ({
    ...s, state: 'off', taskId: null, busyUntil: null, idleSince: null,
    clockIn: null, clockOut: null, breaks: [], breakTaken: false, busyMinutes: 0, done: 0,
  }));
  const byStaff = new Map(staff.map((s) => [s.id, s]));
  const incidentsUsed = new Set();
  let blockedSeen = 0;
  const helpRequests = [];
  const snaps = [];

  const finish = (st, task, t) => {
    task.status = 'done';
    task.doneAt = t;
    task.doneBy = st.id;
    st.done += 1;
    // Scripted incident: a pet in a Row C breakfast round leaves food -> re-offer task.
    const refused = INCIDENTS.find((i) => i.kind === 'refused');
    if (!incidentsUsed.has('refused') && task.type === 'feeding' && task.zone === refused.match.zone && task.meal === refused.match.meal) {
      incidentsUsed.add('refused');
      const pet = task.petNames[0];
      task.outcome = `${pet} did not eat`;
      tasks.push({
        ...task, id: `feed:reoffer:${pet}:${t}`, title: `Re-offer breakfast: ${pet}`, petNames: [pet], reservationIds: [task.reservationIds[0]],
        steps: [`Offer ${pet}'s breakfast again`, 'If refused twice, tap Can\'t complete: Pet seems unwell'], status: 'queued',
        createdAt: t, availableAt: t + 45, dueAt: t + 60, estMinutes: 3, perPetOutcome: false, source: 'event', outcome: null, doneAt: null, doneBy: null,
        staffId: null, assignedAt: null, scoreAtAssign: null, reason: null, whyYou: null, meal: 'reoffer',
      });
      say(t, 'outcome', `${pet} left breakfast. Re-offer task queued for ${clock(t + 45)}.`, { taskId: task.id, staffId: st.id });
    } else if (!task.outcome) {
      task.outcome = task.type === 'potty' ? 'Both' : task.type === 'meds' ? 'Given' : task.perPetOutcome ? 'All ate' : 'Done';
    }
  };

  const assign = (pick, t) => {
    const task = tasks.find((x) => x.id === pick.taskId);
    const st = byStaff.get(pick.staffId);
    task.status = 'assigned';
    task.staffId = st.id;
    task.assignedAt = t;
    task.scoreAtAssign = pick.score?.total ?? null;
    task.reason = pick.reason;
    task.whyYou = pick.whyYou;
    let minutes = actualMinutes(task);

    // Scripted: a large-dog walk after 10:45 needs a second handler.
    const help = INCIDENTS.find((i) => i.kind === 'help');
    if (!incidentsUsed.has('help') && task.type === 'potty' && task.bigdog && t >= help.match.after) {
      incidentsUsed.add('help');
      const assist = {
        ...task, id: `assist:${task.id}`, type: 'assist', title: `Assist ${st.name}: ${task.petNames[0]} needs a second handler`,
        quals: ['care', 'bigdog'], steps: [`Meet ${st.name} at ${task.where}`, 'Take the second lead', 'Tap Done when the dog is back in the suite'],
        status: 'queued', createdAt: t + 2, availableAt: t + 2, dueAt: t + 4, estMinutes: 6, welfare: true, source: 'event', staffId: null, assignedAt: null,
        scoreAtAssign: null, reason: null, whyYou: null, bigdog: true,
      };
      tasks.push(assist);
      helpRequests.push({ taskId: assist.id, from: st.id, at: t + 2 });
      minutes += 4;
      say(t + 2, 'help', `${st.name} tapped Need help on ${task.title}. Assist task created.`, { taskId: task.id, staffId: st.id });
    }

    // Scripted: the second check-out clean finds the suite still occupied -> Can't complete.
    const blocked = INCIDENTS.find((i) => i.kind === 'blocked');
    if (task.type === 'cleaning' && task.subtype === 'checkout' && !task.requeued) {
      blockedSeen += 1;
      if (blockedSeen === blocked.nth + 1) {
        task.blockedAt = t + 1;
        task.blockedBy = st.id;
        task.blockReason = blocked.note;
        timeline.push({ at: t + 1, kind: 'blocked', taskId: task.id, staffId: st.id });
        minutes = 1;
      }
    }

    task.attempts = [...(task.attempts ?? []), { staffId: st.id, start: t, end: t + minutes }];
    st.state = 'busy';
    st.taskId = task.id;
    st.busyUntil = t + minutes;
    st.busyMinutes += minutes;
    say(t, 'assign', `${st.name} ← ${task.title}`, { taskId: task.id, staffId: st.id, reason: pick.reason });
  };

  for (let t = LOCATION.opensAt; t <= SIM_END; t++) {
    // 1. Goose and floor events due this minute.
    for (const ev of timeline.filter((e) => e.at === t)) {
      if (ev.kind === 'booking') {
        const result = applyGooseRecord(book, ev.raw);
        const summary = tasksForChange(tasks, result, t);
        resById.set(result.after.id, result.after);
        timeline.push({ at: result.after.arriveAt, kind: 'check_in', resId: result.after.id });
        say(t, 'goose', `Goose: same-day booking for ${result.after.petName} (arrives ${clock(result.after.arriveAt)}). ${summary.added.length} tasks added, ${summary.updated.length} feeding round updated.`);
      } else if (ev.kind === 'check_in' || ev.kind === 'check_out') {
        const res = resById.get(ev.resId);
        const added = tasksForFrontDesk(tasks, res, ev.kind, t);
        say(t, 'goose', `Goose: ${ev.kind === 'check_in' ? 'check-in' : 'check-out'} started for ${res.petName}. ${added.map((a) => TASK_TYPES[a.type].label.toLowerCase()).join(' + ')} task${added.length > 1 ? 's' : ''} queued.`);
      } else if (ev.kind === 'blocked') {
        const task = tasks.find((x) => x.id === ev.taskId);
        const st = byStaff.get(ev.staffId);
        task.status = 'blocked';
        task.attempts.at(-1).end = t;
        task.attempts.at(-1).outcome = 'blocked';
        task.history = [...(task.history ?? []), { at: t, status: 'blocked', by: st.id, reason: task.blockReason }];
        st.state = 'idle'; st.taskId = null; st.busyUntil = null; st.idleSince = t;
        timeline.push({ at: t + 45, kind: 'requeue', taskId: task.id });
        say(t, 'blocked', `${st.name} tapped Can't complete on ${task.title}: ${task.blockReason}. Back in the queue at ${clock(t + 45)}.`, { taskId: task.id, staffId: st.id });
      } else if (ev.kind === 'requeue') {
        const task = tasks.find((x) => x.id === ev.taskId);
        Object.assign(task, { status: 'queued', availableAt: t, dueAt: Math.max(task.dueAt, t + 60), staffId: null, assignedAt: null, requeued: true });
        say(t, 'requeue', `${task.title} is back in the queue.`, { taskId: task.id });
      }
    }

    // 2. Work finishing this minute.
    for (const st of staff) {
      if (st.state === 'busy' && st.busyUntil === t) {
        const task = tasks.find((x) => x.id === st.taskId);
        if (task.status === 'assigned') finish(st, task, t);
        st.state = 'idle'; st.taskId = null; st.busyUntil = null; st.idleSince = t;
      }
    }

    // 3. Clock in, breaks, clock out (breaks and clock-out wait for the current task to finish).
    for (const st of staff) {
      if (st.state === 'off' && st.clockIn == null && t === st.start) {
        st.state = 'idle'; st.clockIn = t; st.idleSince = t;
        say(t, 'clock', `${st.name} clocked in.`, { staffId: st.id });
      }
      if (st.state === 'break' && t >= st.breaks.at(-1).end) {
        st.state = 'idle'; st.idleSince = t;
      }
      if (st.state === 'idle' && t >= st.end) {
        st.state = 'off'; st.clockOut = t;
        say(t, 'clock', `${st.name} clocked out${t > st.end ? ` (${t - st.end} min over)` : ''}.`, { staffId: st.id });
      } else if (st.state === 'idle' && !st.breakTaken && t >= st.breakStart) {
        st.state = 'break'; st.breakTaken = true; st.breaks.push({ start: t, end: t + st.breakMinutes });
        say(t, 'clock', `${st.name} started a ${st.breakMinutes}-minute break.`, { staffId: st.id });
      }
    }

    // 4. Escalate welfare work that is 15 minutes overdue and still waiting.
    for (const task of tasks) {
      if (task.status === 'queued' && task.welfare && !task.escalated && t - task.dueAt === 15) {
        task.escalated = t;
        say(t, 'escalate', `Overdue 15 min: ${task.title}. Alert sent to #floor-leads.`, { taskId: task.id });
      }
    }

    // 5. Manager changes from the admin take effect at their minute.
    for (const o of overrides.filter((x) => x.at === t)) {
      const task = tasks.find((x) => x.id === o.taskId);
      if (!task || task.status !== 'queued') continue;
      if (o.pinned != null) task.pinned = o.pinned;
      if (o.override != null) task.override = o.override;
      say(t, 'manager', `Manager ${o.pinned ? 'pinned' : o.override > 0 ? 'raised' : 'lowered'} ${task.title}.`, { taskId: task.id });
    }

    // 6. Dispatch to whoever is free.
    const free = staff.filter((s) => s.state === 'idle').map((s) => ({ id: s.id, name: s.name, quals: s.quals, idleSince: s.idleSince }));
    if (free.length) for (const pick of dispatch(tasks, free, t, { policy, rules })) assign(pick, t);

    if (snapshots) {
      let waiting = rank(tasks, t, rules);
      if (policy === 'earliest') waiting = [...waiting].sort((a, b) => a.task.dueAt - b.task.dueAt || a.task.availableAt - b.task.availableAt || (a.task.id < b.task.id ? -1 : 1));
      snaps.push({
        t,
        waiting: waiting.length,
        queue: waiting.slice(0, 10).map(({ task, score }) => ({ id: task.id, total: score.total, parts: score.parts, late: score.late, minsToDue: score.minsToDue })),
        staff: staff.map((s) => ({ id: s.id, state: s.state, taskId: s.taskId, busyUntil: s.busyUntil })),
      });
    }
  }

  // Anything still open at the end of the simulated day.
  for (const task of tasks) {
    if (task.status === 'queued' || task.status === 'blocked') {
      task.status = 'missed';
      task.reason = 'Not reached before close';
    }
  }
  for (const h of helpRequests) {
    const a = tasks.find((x) => x.id === h.taskId);
    h.respondedAt = a.assignedAt ?? null;
  }

  return { policy, seed, scenario, callOut, snaps, tasks, staff, log: log.sort((a, b) => a.t - b.t), helpRequests, reservations: [...resById.values()], metrics: metrics(tasks, staff, helpRequests) };
}

export function onTime(task) {
  if (task.assignedAt == null) return false;
  return task.assignedAt <= task.dueAt + TASK_TYPES[task.type].grace;
}

export function metrics(tasks, staff, helpRequests = []) {
  const live = tasks.filter((t) => t.status !== 'cancelled');
  const byType = {};
  for (const type of Object.keys(TASK_TYPES)) {
    const list = live.filter((t) => t.type === type);
    if (!list.length) continue;
    const late = list.filter((t) => t.assignedAt != null).map((t) => Math.max(0, t.assignedAt - t.dueAt));
    byType[type] = {
      count: list.length,
      onTime: list.filter(onTime).length,
      missed: list.filter((t) => t.status === 'missed').length,
      medianLate: median(late),
      p90Late: percentile(late, 90),
      maxLate: late.length ? Math.max(...late) : null,
    };
  }
  const welfare = live.filter((t) => t.welfare);
  const petEvents = welfare.reduce((a, t) => a + Math.max(1, t.petCount), 0);
  const petOnTime = welfare.filter(onTime).reduce((a, t) => a + Math.max(1, t.petCount), 0);
  const petMinutesLate = welfare.reduce((a, t) => a + Math.max(1, t.petCount) * Math.max(0, (t.assignedAt ?? SIM_END) - t.dueAt), 0);
  const checkout = live.filter((t) => t.type === 'lobby' && t.subtype === 'out' && t.assignedAt != null).map((t) => t.assignedAt - t.availableAt);
  const lobby = live.filter((t) => t.type === 'lobby' && t.assignedAt != null).map((t) => t.assignedAt - t.availableAt);
  const worked = staff.map((s) => {
    const shiftMin = (s.clockOut ?? SIM_END) - (s.clockIn ?? s.start);
    const breakMin = s.breaks.reduce((a, b) => a + (b.end - b.start), 0);
    return { id: s.id, name: s.name, done: s.done, busy: s.busyMinutes, utilization: Math.round((100 * s.busyMinutes) / Math.max(1, shiftMin - breakMin)), overtime: Math.max(0, (s.clockOut ?? s.end) - s.end) };
  });
  return {
    tasks: live.length,
    cancelled: tasks.length - live.length,
    done: live.filter((t) => t.status === 'done').length,
    missed: live.filter((t) => t.status === 'missed').length,
    welfareOnTimePct: pct(welfare.filter(onTime).length, welfare.length),
    petCareOnTimePct: pct(petOnTime, petEvents),
    petCareEvents: petEvents,
    petMinutesLate,
    checkoutWaitMax: checkout.length ? Math.max(...checkout) : null,
    checkoutWaitMedian: median(checkout),
    medsOnTimePct: byType.meds ? pct(byType.meds.onTime, byType.meds.count) : null,
    allOnTimePct: pct(live.filter(onTime).length, live.length),
    escalations: live.filter((t) => t.escalated).length,
    lobbyWaitMedian: median(lobby),
    lobbyWaitMax: lobby.length ? Math.max(...lobby) : null,
    helpResponse: helpRequests.map((h) => (h.respondedAt == null ? null : h.respondedAt - h.at)),
    byType,
    staff: worked,
  };
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
