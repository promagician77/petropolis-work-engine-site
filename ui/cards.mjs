// Asset 2: the Slack cards. Real Block Kit JSON from the engine, rendered and clickable,
// with Slack's limits checked live.

import { simulateDay } from '../engine/sim.mjs';
import { STAFF } from '../engine/day.mjs';
import { taskCard, cantCompleteModal, photoModal, refusalsModal, helpAlert, homeTab, validateSurface, LIMITS } from '../engine/slack.mjs';
import { clock } from '../engine/util.mjs';
import { renderMessage, renderModal, renderHome, renderBlocks } from './blockkit.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let day;
let view = null; // { kind, surface, task, state, staff, from }
const maya = STAFF[0];
const offlineUrl = 'https://example.com/offline/app?s=s1';

function pick() {
  const t = day.tasks;
  const feeding = [...t.filter((x) => x.type === 'feeding' && x.perPetOutcome)].sort((a, b) => b.petNames.length - a.petNames.length)[0];
  return {
    meds: t.find((x) => x.type === 'meds' && x.reason),
    feeding,
    potty: t.find((x) => x.type === 'potty' && x.bigdog && x.reason),
    lobby: t.find((x) => x.type === 'lobby' && x.subtype === 'out' && x.reason),
    clean: t.find((x) => x.type === 'cleaning' && x.subtype === 'checkout' && x.reason),
  };
}

let T;
const msg = (task, state, extra = {}) => ({ kind: 'message', task, state, surface: taskCard(task, { now: task.assignedAt ?? task.dueAt, state, reason: task.reason, whyYou: task.whyYou, staffName: 'Maya', ...extra }) });
const LIST = () => [
  { grp: 'Direct messages', label: 'Meds: just assigned', make: () => msg(T.meds, 'assigned') },
  { label: 'Meds: in progress', make: () => msg(T.meds, 'started') },
  { label: `Breakfast round: ${T.feeding.petNames.length} dogs`, make: () => msg(T.feeding, 'started') },
  { label: 'Large-dog potty walk', make: () => msg(T.potty, 'started') },
  { label: 'Check-out lobby run', make: () => msg(T.lobby, 'assigned') },
  { label: 'Deep clean, photo required', make: () => msg(T.clean, 'started') },
  { grp: 'Modals', label: "Can't complete", make: () => ({ kind: 'modal', task: T.meds, surface: cantCompleteModal(T.meds), from: 'list' }) },
  { label: 'Add photo', make: () => ({ kind: 'modal', task: T.clean, surface: photoModal(T.clean), from: 'list' }) },
  { label: 'Who did not eat?', make: () => ({ kind: 'modal', task: T.feeding, surface: refusalsModal(T.feeding), from: 'list' }) },
  { grp: 'Home tab', label: 'Not clocked in', make: () => home({ onShift: false }) },
  { label: 'On shift', make: () => home({ onShift: true, current: T.meds }) },
  { label: 'On break', make: () => home({ onShift: true, onBreak: 630 }) },
  { grp: '#floor-leads channel', label: 'Need help alert', make: () => ({ kind: 'channel', task: T.potty, surface: helpAlert(T.potty, 'Maya', 662) }) },
];
const home = (o) => ({ kind: 'home', surface: homeTab(maya, { now: 600, shiftStart: 360, doneToday: 11, offlineUrl, onBreak: null, ...o }), homeState: o });

function render() {
  const s = view.surface;
  const phone = $('#card-phone');
  $('#card-surface').textContent = { message: 'Messages', modal: 'Modal', home: 'Home tab', channel: '#floor-leads' }[view.kind];
  if (view.kind === 'message') phone.innerHTML = renderMessage(s, clock(view.task.assignedAt ?? view.task.dueAt), 'cd');
  if (view.kind === 'modal') phone.innerHTML = renderModal(s, 'cd');
  if (view.kind === 'home') phone.innerHTML = renderHome(s, 'cd');
  if (view.kind === 'channel') phone.innerHTML = `<div class="sk-channel"># floor-leads</div>${renderMessage(s, clock(662), 'cd')}`;
  const kind = view.kind === 'channel' ? 'message' : view.kind;
  const v = validateSurface(s, kind);
  const n = s.blocks.length;
  $('#card-checks').innerHTML = [
    `<li class="${n <= LIMITS.blocks[kind] ? 'ok' : 'bad'}">${n} of ${LIMITS.blocks[kind]} blocks</li>`,
    `<li class="${v.ok ? 'ok' : 'bad'}">${v.checked} limit checks ${v.ok ? 'passed' : 'run'}</li>`,
    ...v.errors.map((e) => `<li class="bad">${esc(e)}</li>`),
  ].join('');
  $('#card-json').textContent = JSON.stringify(s, null, 2);
}

function sends(html) { $('#card-sends').innerHTML = html; }
const val = (v) => `<code>${esc(v.length > 60 ? `${v.slice(0, 60)}…` : v)}</code>`;

function onAction(id, value, select) {
  const ingressQueued = 'The ingress Lambda checks the signature, queues it, and answers 200 well inside Slack’s 3 seconds.';
  const ingressModal = 'The ingress Lambda opens this modal itself, because a trigger_id expires 3 seconds after Slack sends it.';
  if (id === 'task_start') { view = msg(view.task, 'started'); sends(`Slack sends <code>block_actions</code>, action ${val(id)}, value ${val(value)}. ${ingressQueued}`); }
  else if (id === 'task_done' || id === 'task_done_outcome') {
    const o = id === 'task_done_outcome' ? JSON.parse(select).o : (JSON.parse(value).o ?? 'Done');
    view = msg(view.task, 'done', { outcome: o, doneAt: (view.task.assignedAt ?? view.task.dueAt) + view.task.estMinutes });
    sends(`Slack sends ${val(id)}${id === 'task_done_outcome' ? ` with ${val(select)}` : ''}. The worker records who and when, updates this card, and sends Maya her next task.`);
  } else if (id === 'task_cant' || id === 'task_refused') { view = { kind: 'modal', task: view.task, surface: cantCompleteModal(view.task), from: 'message' }; sends(`Slack sends ${val(id)}. ${ingressModal}`); }
  else if (id === 'task_photo') { view = { kind: 'modal', task: view.task, surface: photoModal(view.task), from: 'message' }; sends(`Slack sends ${val(id)}. ${ingressModal}`); }
  else if (id === 'task_refusals') { view = { kind: 'modal', task: view.task, surface: refusalsModal(view.task), from: 'message' }; sends(`Slack sends ${val(id)}. ${ingressModal}`); }
  else if (id === 'task_help') { view = { kind: 'channel', task: view.task, surface: helpAlert(view.task, 'Maya', view.task.assignedAt ?? 662) }; sends(`Slack sends ${val(id)}. The worker posts this to #floor-leads and queues an Assist task for the nearest qualified person.`); }
  else if (id === 'help_accept') {
    view = { ...view, surface: { ...view.surface, blocks: [view.surface.blocks[0], { type: 'context', elements: [{ type: 'mrkdwn', text: '✓ Leo is on the way (tapped at the same minute)' }] }] } };
    sends(`Slack sends ${val(id)}. The Assist task is claimed with a conditional write, so only the first person to tap gets it.`);
  } else if (['clock_in', 'break_end'].includes(id)) { view = home({ onShift: true, current: T.meds }); sends(`Slack sends ${val(id)}. The worker writes a shift event with the time and sends the first task.`); }
  else if (id === 'break_start') { view = home({ onShift: true, onBreak: 630 }); sends(`Slack sends ${val(id)}. Any task in hand goes back in the queue for someone else.`); }
  else if (id === 'clock_out') { view = home({ onShift: false }); sends(`Slack asks “Clock out?” first (a confirm dialog on the button), then sends ${val(id)}.`); }
  else sends(`Slack sends ${val(id)}.`);
  render();
}

function onModal(kind) {
  if (kind === 'close') { view = view.from === 'message' || view.from === 'list' ? msg(view.task, 'started') : view; sends('Modal closed. Nothing is sent.'); render(); return; }
  const cb = view.surface.callback_id;
  if (cb === 'cant_complete') {
    const reason = document.querySelector('#card-phone .sk-radio input:checked')?.nextElementSibling?.textContent ?? 'Something else';
    view = msg(view.task, 'done', { outcome: `Can't complete: ${reason}` });
    sends(`Slack sends <code>view_submission</code>, callback ${val(cb)}, reason ${val(reason)}. The task goes back in the queue in 30 minutes and #floor-leads is told why.`);
  } else if (cb === 'task_photo') {
    view = msg(view.task, 'started');
    sends(`Slack sends <code>view_submission</code> with the file ids. The worker copies each photo to the S3 bucket under the task, so it outlives Slack’s free-plan history.`);
  } else if (cb === 'feeding_refusals') {
    const pets = [...document.querySelectorAll('#card-phone .sk-checks input:checked')].map((i) => i.value);
    view = msg(view.task, 'done', { outcome: pets.length ? `Did not eat: ${pets.join(', ')}` : 'All ate' });
    sends(`Slack sends <code>view_submission</code> with ${pets.length ? val(pets.join(', ')) : 'no pets ticked'}. ${pets.length ? `Each gets a re-offer task in 45 minutes.` : ''}`);
  }
  render();
}

export function initCards() {
  day = simulateDay({ scenario: 'normal' });
  T = pick();
  const items = LIST();
  const ul = $('#card-list');
  ul.innerHTML = items.map((it, i) => `${it.grp ? `<li class="grp" aria-hidden="true">${esc(it.grp)}</li>` : ''}<li><button type="button" data-card="${i}" aria-current="${i === 0}">${esc(it.label)}</button></li>`).join('');
  view = items[0].make();
  render();
  ul.addEventListener('click', (e) => {
    const b = e.target.closest('[data-card]');
    if (!b) return;
    ul.querySelectorAll('[data-card]').forEach((x) => x.setAttribute('aria-current', String(x === b)));
    view = items[Number(b.dataset.card)].make();
    sends('Tap a button to see what Slack sends to AWS.');
    render();
  });
  const phone = $('#card-phone');
  phone.addEventListener('click', (e) => {
    const link = e.target.closest('[data-url]');
    if (link) { e.preventDefault(); sends(`This opens ${val(link.getAttribute('href'))} in the browser. In the pilot it points at your own SOP page or training video.`); return; }
    const m = e.target.closest('[data-modal]');
    if (m) { onModal(m.dataset.modal); return; }
    const a = e.target.closest('button[data-action]');
    if (a) onAction(a.dataset.action, a.dataset.value);
  });
  phone.addEventListener('change', (e) => {
    const s = e.target.closest('select[data-action]');
    if (s && s.value) onAction(s.dataset.action, '', s.value);
    const c = e.target.closest('input[type=checkbox][data-action]');
    if (c) sends(`Ticking a step sends ${val(c.dataset.action)}. Steps are optional; Done is what counts.`);
  });
  $('#copy-json').addEventListener('click', async () => {
    const text = JSON.stringify(view.surface, null, 2);
    try {
      await Promise.race([navigator.clipboard.writeText(text), new Promise((_, no) => setTimeout(() => no(new Error('clipboard timeout')), 800))]);
      sends('Copied. Paste it into Slack’s Block Kit Builder.');
    } catch {
      const r = document.createRange(); r.selectNodeContents($('#card-json')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      sends('Selected. Press Ctrl+C or Cmd+C to copy.');
    }
  });
}

export { renderBlocks };
