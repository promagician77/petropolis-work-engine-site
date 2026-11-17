// Asset 1: the pilot day. Runs the real simulation in the browser and shows
// the queue, the floor and each person's phone at any minute.

import { simulateDay, buildDay, SCENARIOS } from '../engine/sim.mjs';
import { STAFF, QUALS } from '../engine/day.mjs';
import { RULES } from '../engine/priority.mjs';
import { coverageGaps, skillLabel } from '../engine/dispatch.mjs';
import { forecastFrontDesk, TASK_TYPES } from '../engine/tasks.mjs';
import { taskCard, homeTab, ICON } from '../engine/slack.mjs';
import { clock } from '../engine/util.mjs';
import { renderMessage, renderHome } from './blockkit.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  scenario: 'normal',
  policy: 'priority',
  t: 425,
  staffId: 's1',
  tab: 'dm',
  rules: { ...RULES },
  overrides: [],
  open: null,
  playing: null,
};
let current = null;
let byId = new Map();
const metricsCache = new Map();
const keyOf = (scenario, policy) => `${scenario}|${policy}|${JSON.stringify(state.rules)}|${JSON.stringify(state.overrides)}`;

function runCurrent() {
  current = simulateDay({ scenario: state.scenario, policy: state.policy, rules: state.rules, overrides: state.policy === 'priority' ? state.overrides : [], snapshots: true });
  byId = new Map(current.tasks.map((t) => [t.id, t]));
}

function metricsFor(scenario, policy) {
  const k = keyOf(scenario, policy);
  if (!metricsCache.has(k)) metricsCache.set(k, simulateDay({ scenario, policy, rules: state.rules, overrides: policy === 'priority' ? state.overrides : [] }).metrics);
  return metricsCache.get(k);
}

const snapAt = (t) => current.snaps[Math.max(0, Math.min(current.snaps.length - 1, t - current.snaps[0].t))];

// ---------------- queue ----------------
function renderQueue() {
  const snap = snapAt(state.t);
  $('#q-count').textContent = `(${snap.waiting})`;
  $('#q-hint').textContent = state.policy === 'priority'
    ? 'Highest score goes to the next free person with the skills. Open a row to see the score, or change it as a manager would.'
    : 'Earliest due goes first, like working down a paper checklist. Scores are shown for comparison only.';
  const ol = $('#queue');
  if (!snap.queue.length) {
    ol.innerHTML = '<li class="empty">Nothing waiting. Everyone with the right skills is busy or the queue is clear.</li>';
    return;
  }
  const shown = snap.queue.slice(0, 7);
  const scale = Math.max(140, ...shown.map((q) => q.total));
  ol.innerHTML = shown.map((q, i) => {
    const task = byId.get(q.id);
    const p = q.parts;
    const w = (x) => `${Math.max(0, (x / scale) * 100).toFixed(1)}%`;
    const due = q.late > 0 ? `${q.late} min past late line` : q.minsToDue > 0 ? `due ${clock(task.dueAt)}` : 'due now';
    const open = state.open === q.id;
    return `<li>
      <button type="button" class="qrow" aria-expanded="${open}" data-q="${esc(q.id)}">
        <span class="ic" aria-hidden="true">${ICON[task.type]}</span>
        <span class="t">${esc(task.title)}</span>
        <span class="s"><span class="sr-only">score </span>${Math.round(q.total)}</span>
        <span class="m">${esc(task.where)} · ${due}${task.quals.filter((x) => x !== 'care').length ? ` · needs ${task.quals.filter((x) => x !== 'care').map(skillLabel).join(' + ')}` : ''}</span>
        <span class="bar" aria-hidden="true"><i class="imp" style="width:${w(p.importance)}"></i><i class="soon" style="width:${w(p.dueSoon)}"></i><i class="late" style="width:${w(p.overdue)}"></i><i class="care" style="width:${w(p.welfare)}"></i><i class="mgr" style="width:${w(Math.max(0, Math.min(p.manager, 60)))}"></i></span>
      </button>
      ${open ? queueDetail(task, q, i) : ''}
    </li>`;
  }).join('') + (snap.waiting > shown.length ? `<li class="empty">${snap.waiting - shown.length} more waiting</li>` : '');
}

function queueDetail(task, q, rank) {
  const p = q.parts;
  const rows = [['Importance', p.importance, `${TASK_TYPES[task.type].label} tasks start at this`], ['How soon', p.dueSoon, 'climbs over the hour before its late line'], ['Overdue', p.overdue, q.late ? `${q.late} min past the late line` : 'not late'], ['Pet welfare', p.welfare, task.welfare ? 'extra weight for pet care' : 'not a welfare task'], ['Manager', p.manager, p.manager ? 'set in the admin' : 'no change']];
  const actions = state.policy === 'priority'
    ? `<div class="mgr-actions"><button type="button" class="btn small" data-mgr="pin">Do this next</button><button type="button" class="btn small ghost" data-mgr="up">Raise by 20</button><button type="button" class="btn small ghost" data-mgr="down">Lower by 20</button></div>`
    : '<p class="hint">Switch to Work Engine priority to try a manager change.</p>';
  return `<div class="qmore">
    <p class="why">#${rank + 1} in line. ${esc(task.steps.length)} step${task.steps.length === 1 ? '' : 's'}, about ${task.estMinutes} min.</p>
    <table><tbody>${rows.map(([k, v, note]) => `<tr><td>${k}</td><td class="num">${Math.round(v * 10) / 10}</td><td class="hint">${note}</td></tr>`).join('')}<tr><td><strong>Score</strong></td><td class="num">${q.total}</td><td></td></tr></tbody></table>
    ${actions}
  </div>`;
}

// ---------------- floor ----------------
function renderFloor() {
  const snap = snapAt(state.t);
  const scenarioOut = SCENARIOS[state.scenario].callOut;
  $('#floor').innerHTML = STAFF.map((s) => {
    const st = snap.staff.find((x) => x.id === s.id);
    const out = s.id === scenarioOut;
    const status = out ? 'off' : st?.state ?? 'off';
    const label = out ? 'Called out' : { busy: 'On a task', idle: 'Free', break: 'On break', off: state.t < s.start ? `In at ${clock(s.start)}` : 'Clocked out' }[status];
    const task = st?.taskId ? byId.get(st.taskId) : null;
    let prog = '';
    if (task) {
      const a = task.attempts?.find((x) => x.staffId === s.id && x.start <= state.t && state.t < x.end + 1) ?? task.attempts?.at(-1);
      const pct = a ? Math.min(100, ((state.t - a.start) / Math.max(1, a.end - a.start)) * 100) : 0;
      prog = `<span class="prog" aria-hidden="true"><i style="width:${pct.toFixed(0)}%"></i></span>`;
    }
    return `<li><button type="button" data-staff="${s.id}" aria-pressed="${state.staffId === s.id}">
      <span class="n">${esc(s.name)}</span>
      <span class="pill ${status}">${esc(label)}</span>
      <span class="skills">${s.quals.filter((q) => q !== 'care').map((q) => QUALS[q]).join(', ')}</span>
      ${task ? `<span class="doing">${ICON[task.type]} ${esc(task.title)}</span>${prog}` : ''}
    </button></li>`;
  }).join('');
}

// ---------------- phone ----------------
function renderPhone() {
  const s = STAFF.find((x) => x.id === state.staffId);
  const snap = snapAt(state.t);
  const st = snap.staff.find((x) => x.id === s.id);
  $('#phone-who').textContent = s.name;
  $('#phone-time').textContent = clock(state.t).replace(/ (AM|PM)/, '');
  $('#tab-dm').setAttribute('aria-selected', String(state.tab === 'dm'));
  $('#tab-home').setAttribute('aria-selected', String(state.tab === 'home'));
  const body = $('#phone-body');
  const out = s.id === SCENARIOS[state.scenario].callOut;
  const task = st?.taskId ? byId.get(st.taskId) : null;
  if (state.tab === 'home') {
    const sim = current.staff.find((x) => x.id === s.id);
    const brk = sim?.breaks.find((b) => b.start <= state.t && state.t < b.end);
    const done = current.tasks.filter((x) => x.doneBy === s.id && x.doneAt <= state.t).length;
    const view = homeTab(s, { now: state.t, onShift: !out && st && st.state !== 'off', onBreak: brk ? brk.start : null, shiftStart: sim?.clockIn ?? s.start, current: task, doneToday: done, offlineUrl: 'https://example.com/offline/app' });
    body.innerHTML = renderHome(view, 'ph');
    return;
  }
  if (out) { body.innerHTML = '<p class="sk-empty">Sam called out sick today, so the engine plans around the gap. See the coverage check below.</p>'; return; }
  if (!task) {
    const msg = !st || st.state === 'off' ? (state.t < s.start ? `Shift starts at ${clock(s.start)}. Clock in from the Home tab.` : 'Shift over. Clocked out.') : st.state === 'break' ? 'On break. New tasks wait until you tap End break.' : 'Nothing assigned right now. Your next task will arrive here.';
    body.innerHTML = `<p class="sk-empty">${esc(msg)}</p>`;
    return;
  }
  const a = task.attempts?.find((x) => x.staffId === s.id && x.start <= state.t && state.t <= x.end) ?? task.attempts?.at(-1);
  const cardState = a && state.t - a.start < 1 ? 'assigned' : 'started';
  const card = taskCard(task, { now: a?.start ?? state.t, state: cardState, reason: task.reason, whyYou: task.whyYou });
  body.innerHTML = renderMessage(card, clock(a?.start ?? state.t), 'ph');
}

// ---------------- feed, gaps, results ----------------
const FEED_KINDS = new Set(['assign', 'goose', 'help', 'blocked', 'requeue', 'outcome', 'escalate', 'clock', 'manager']);
function renderFeed() {
  const items = current.log.filter((l) => l.t <= state.t && FEED_KINDS.has(l.kind)).slice(-7).reverse();
  const text = (l) => (l.kind === 'assign' ? l.text.replace(' ← ', ' got ') : l.text);
  $('#feed').innerHTML = items.length ? items.map((l) => `<li class="k-${l.kind}"><time>${clock(l.t)}</time><span>${esc(text(l))}</span></li>`).join('') : '<li><span></span><span class="hint">Nothing yet. Move the clock forward.</span></li>';
}

let dayCache = null;
function renderGaps() {
  dayCache ??= buildDay();
  const all = [...dayCache.tasks, ...forecastFrontDesk(dayCache.reservations)];
  const out = SCENARIOS[state.scenario].callOut;
  const gaps = coverageGaps(all, STAFF.filter((s) => s.id !== out));
  $('#gaps').innerHTML = gaps.map((g) => `<li>${esc(g.text)}</li>`).join('');
}

const MEASURES = [
  ['Meds started on time', 'meds on time', (m) => m.byType.meds.onTime / m.byType.meds.count, (m) => `${m.byType.meds.onTime} of ${m.byType.meds.count}`, 'up'],
  ['Pet care on time, counted per pet', 'pet care per pet', (m) => m.petCareOnTimePct, (m) => `${m.petCareOnTimePct}%`, 'up'],
  ['All tasks started on time', 'all tasks on time', (m) => m.allOnTimePct, (m) => `${m.allOnTimePct}%`, 'up'],
  ['Longest wait at a check-out (customer at the desk)', 'check-out wait', (m) => m.checkoutWaitMax, (m) => `${m.checkoutWaitMax} min`, 'down'],
  ['Longest wait for any lobby run', 'lobby wait', (m) => m.lobbyWaitMax, (m) => `${m.lobbyWaitMax} min`, 'down'],
  ['Feeding rounds, worst lateness', 'feeding lateness', (m) => m.byType.feeding.maxLate, (m) => `${m.byType.feeding.maxLate} min`, 'down'],
  ['Potty walks, worst lateness', 'walk lateness', (m) => m.byType.potty.maxLate, (m) => `${m.byType.potty.maxLate} min`, 'down'],
  ['Overdue alerts sent to #floor-leads', 'overdue alerts', (m) => m.escalations, (m) => String(m.escalations), 'down'],
];

const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

function renderResults() {
  const a = metricsFor(state.scenario, 'priority');
  const b = metricsFor(state.scenario, 'earliest');
  const winsA = [];
  const winsB = [];
  $('#results-table tbody').innerHTML = MEASURES.map(([label, short, val, show, dir]) => {
    const va = val(a);
    const vb = val(b);
    const aWin = dir === 'up' ? va > vb : va < vb;
    const bWin = dir === 'up' ? vb > va : vb < va;
    if (aWin) winsA.push(`${short} (${show(a)} vs ${show(b)})`);
    if (bWin) winsB.push(`${short} (${show(b)} vs ${show(a)})`);
    return `<tr><th scope="row">${label}</th><td class="${aWin ? 'win' : ''}">${show(a)}</td><td class="${bWin ? 'win' : ''}">${show(b)}</td></tr>`;
  }).join('');
  const day = state.scenario === 'callout' ? 'With Sam out' : 'On a normal day';
  const p1 = winsA.length ? `Work Engine priority is ahead on ${listJoin(winsA.slice(0, 3))}.` : 'Work Engine priority is not ahead on any measure here.';
  const p2 = winsB.length ? `Earliest due first is ahead on ${listJoin(winsB.slice(0, 3))}.` : 'Earliest due first is not ahead on any measure here.';
  $('#verdict').textContent = `${day}: ${p1} ${p2} The default rules lean toward pet welfare and waiting customers; change the weights below to move that trade.`;
}

function renderAll() {
  $('#time').value = state.t;
  $('#time-out').textContent = clock(state.t);
  renderQueue();
  renderFloor();
  renderPhone();
  renderFeed();
}

function rerun({ keepResults = false } = {}) {
  runCurrent();
  renderAll();
  if (!keepResults) { renderResults(); renderGaps(); }
}

function busiestMorningMinute() {
  let best = state.t;
  let max = -1;
  for (const s of current.snaps) if (s.t >= 400 && s.t <= 540 && s.waiting > max) { max = s.waiting; best = s.t; }
  return best;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => el.classList.remove('show'), 4200);
}

export function initBoard() {
  runCurrent();
  state.t = busiestMorningMinute();
  const first = snapAt(state.t).staff.find((s) => s.state === 'busy');
  if (first) state.staffId = first.id;
  renderAll();
  renderResults();
  renderGaps();

  document.querySelectorAll('input[name=scenario]').forEach((r) => r.addEventListener('change', () => { state.scenario = r.value; state.open = null; rerun(); }));
  document.querySelectorAll('input[name=policy]').forEach((r) => r.addEventListener('change', () => { state.policy = r.value; state.open = null; rerun({ keepResults: true }); }));
  $('#time').addEventListener('input', (e) => { state.t = Number(e.target.value); renderAll(); });
  $('#play').addEventListener('click', (e) => {
    if (state.playing) { clearInterval(state.playing); state.playing = null; e.target.textContent = 'Play'; e.target.setAttribute('aria-pressed', 'false'); return; }
    e.target.textContent = 'Pause';
    e.target.setAttribute('aria-pressed', 'true');
    state.playing = setInterval(() => {
      if (state.t >= 1230) { clearInterval(state.playing); state.playing = null; $('#play').textContent = 'Play'; $('#play').setAttribute('aria-pressed', 'false'); return; }
      state.t += 1;
      renderAll();
    }, 110);
  });
  $('#queue').addEventListener('click', (e) => {
    const row = e.target.closest('[data-q]');
    if (row) { state.open = state.open === row.dataset.q ? null : row.dataset.q; renderQueue(); return; }
    const mgr = e.target.closest('[data-mgr]');
    if (!mgr || !state.open) return;
    const id = state.open;
    const before = byId.get(id)?.attempts?.[0]?.start ?? null;
    const kind = mgr.dataset.mgr;
    const prev = state.overrides.filter((o) => o.taskId === id).reduce((a, o) => a + (o.override ?? 0), 0);
    state.overrides = [...state.overrides, kind === 'pin' ? { taskId: id, at: state.t, pinned: true } : { taskId: id, at: state.t, override: prev + (kind === 'up' ? 20 : -20) }];
    rerun();
    const after = byId.get(id)?.attempts?.[0];
    const title = byId.get(id).title;
    let what;
    if (!after) what = `${title} is still waiting.`;
    else if (before == null) what = `${title} now starts at ${clock(after.start)}.`;
    else if (after.start < before) what = `${title} now starts at ${clock(after.start)}, ${before - after.start} min earlier.`;
    else if (after.start > before) what = `${title} now starts at ${clock(after.start)}, ${after.start - before} min later.`;
    else what = `${title} still starts at ${clock(after.start)}: it was already next in line. Try a task further down.`;
    toast(`Replayed the day with your change. ${what}`);
  });
  $('#floor').addEventListener('click', (e) => {
    const b = e.target.closest('[data-staff]');
    if (!b) return;
    state.staffId = b.dataset.staff;
    renderFloor();
    renderPhone();
  });
  $('#tab-dm').addEventListener('click', () => { state.tab = 'dm'; renderPhone(); });
  $('#tab-home').addEventListener('click', () => { state.tab = 'home'; renderPhone(); });
  $('#phone-body').addEventListener('click', (e) => {
    if (e.target.closest('[data-action]')) { e.preventDefault(); toast('Try the buttons in the Slack cards section below; this phone replays the simulated day.'); }
  });

  const bind = (id, key, fmt, cast = Number) => {
    const input = $(`#${id}`);
    const out = $(`#${id}-out`);
    input.addEventListener('change', () => { state.rules = { ...state.rules, [key]: cast(input.value) }; out.textContent = fmt(input.value); rerun(); toast('Replayed both scenarios with your rules.'); });
    input.addEventListener('input', () => { out.textContent = fmt(input.value); });
  };
  bind('r-welfare', 'welfareMultiplier', (v) => v);
  bind('r-window', 'dueSoonWindow', (v) => `${v} min`);
  bind('r-overdue', 'overduePerMinute', (v) => v);
  $('#r-reset').addEventListener('click', () => {
    state.rules = { ...RULES };
    state.overrides = [];
    $('#r-welfare').value = RULES.welfareMultiplier; $('#r-welfare-out').textContent = RULES.welfareMultiplier;
    $('#r-window').value = RULES.dueSoonWindow; $('#r-window-out').textContent = `${RULES.dueSoonWindow} min`;
    $('#r-overdue').value = RULES.overduePerMinute; $('#r-overdue-out').textContent = RULES.overduePerMinute;
    rerun();
    toast('Back to the default rules.');
  });
}
