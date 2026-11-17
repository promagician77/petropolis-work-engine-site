// Asset 3: the failure lab. Each experiment runs the kit's real modules in the browser.

import { createMemoryStore } from '../engine/store.mjs';
import { createOfflineQueue, applyOfflineBatch } from '../engine/offline.mjs';
import { createBook, applyGooseRecord, tasksForChange, pollOnce } from '../engine/goose.mjs';
import { buildDay } from '../engine/sim.mjs';
import { sampleGooseFeed, STAFF } from '../engine/day.mjs';
import { verifySlackRequest, SLACK_EXAMPLE } from '../engine/signature.mjs';
import { clock } from '../engine/util.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pause = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
const line = (tag, kind, text) => `<li><span class="tag ${kind}">${esc(tag)}</span><span>${text}</span></li>`;

const EXPERIMENTS = [
  {
    id: 'offline',
    title: 'Weak signal in the back kennels',
    q: 'Maya’s phone loses signal. She keeps working. What happens to her taps, their times, and work the engine handed to someone else meanwhile?',
    async run(log) {
      const store = createMemoryStore();
      await store.putTasks([
        { id: 'meds', title: 'Apoquel 16 mg for Biscuit', status: 'assigned', staffId: 's1' },
        { id: 'water', title: 'Water check: Row A', status: 'assigned', staffId: 's1' },
        { id: 'play', title: 'Play session: Otis', status: 'assigned', staffId: 's1' },
      ]);
      const storage = new Map();
      const phone = createOfflineQueue({ deviceId: 'maya-phone', storage });
      await log(line('8:01', 'warn', 'Signal drops. The offline list keeps working from the copy on her phone.'));
      phone.add({ type: 'done', taskId: 'meds', staffId: 's1', outcome: 'Given' }, 483);
      await log(line('8:03', 'info', 'Taps Done on <strong>Apoquel for Biscuit</strong>. Saved on the phone with the time 8:03.'));
      await store.transition('water', { from: ['assigned'] }, { staffId: 's5', assignedAt: 492 });
      await log(line('8:12', 'info', 'No word from Maya, so the engine hands <strong>Water check: Row A</strong> to Leo.'));
      phone.add({ type: 'done', taskId: 'water', staffId: 's1' }, 493);
      await log(line('8:13', 'info', 'Maya finishes the water check anyway and taps Done. Saved on the phone.'));
      await store.transition('play', { from: ['assigned'] }, { status: 'cancelled', reason: 'Pet checked out' });
      await log(line('8:15', 'info', 'Otis is checked out at the desk; Goose cancels his play session.'));
      phone.add({ type: 'done', taskId: 'play', staffId: 's1' }, 496);
      await log(line('8:16', 'info', `Maya taps Done on the play session. ${phone.pending().length} taps are waiting on her phone.`));
      const sent = phone.pending();
      const results = await phone.flush((batch) => applyOfflineBatch(store, batch, 500));
      await log(line('8:20', 'ok', 'Signal is back. The phone sends all three taps in one batch.'));
      const name = { meds: 'Biscuit’s meds', water: 'The water check', play: 'The play session' };
      for (const r of results) {
        const a = sent.find((x) => x.id === r.id);
        const t = await store.getTask(a.taskId);
        if (r.result === 'applied') await log(line('applied', 'ok', `${name[a.taskId]}: recorded as done at <strong>${clock(t.doneAt)}</strong>, the moment she tapped, not when it synced.`));
        if (r.result === 'applied_late') await log(line('applied', 'ok', `${name[a.taskId]}: done by Maya at ${clock(t.doneAt)}. Leo gets a DM to skip it.`));
        if (r.result === 'conflict') await log(line('conflict', 'warn', `${name[a.taskId]}: was cancelled before her tap arrived. Kept for the manager, nothing overwritten.`));
      }
      const again = await applyOfflineBatch(store, sent, 501);
      await log(line('retry', 'info', `The phone never got the reply and sends the same batch again: ${again.filter((x) => x.result === 'duplicate').length} of ${again.length} ignored as duplicates.`));
    },
  },
  {
    id: 'race',
    title: 'Ten phones tap the same task',
    q: 'A lobby run pops up and ten people tap it within the same instant. Who gets it?',
    async run(log) {
      const store = createMemoryStore({ latency: true });
      await store.putTasks([{ id: 'lobby', title: 'Check-out: bring Daisy to the lobby', status: 'queued' }]);
      const names = [...STAFF.map((s) => s.name), 'Kim', 'Ana'];
      const results = await Promise.all(names.map((n, i) => store.claim('lobby', `p${i}`, 600).then((r) => ({ n, ...r }))));
      const won = results.filter((r) => r.ok);
      await log(`<li class="phones-row" style="display:block"><div class="phones">${results.map((r) => `<span class="${r.ok ? 'won' : 'lost'}">${esc(r.n)}</span>`).join('')}</div></li>`);
      await log(line(`${won.length} winner`, won.length === 1 ? 'ok' : 'bad', `<strong>${esc(won[0].n)}</strong> gets the lobby run. The claim is one conditional write: it only succeeds while the task is still waiting.`));
      await log(line(`${results.length - won.length} told`, 'info', `The other ${results.length - won.length} get “already taken” and their next task, never a duplicate.`));
    },
  },
  {
    id: 'goose',
    title: 'Goose misses a webhook, then sends it late',
    q: 'A same-day booking comes in at 10:12 but the webhook never arrives. Then it turns up late, and an older update arrives out of order.',
    async run(log) {
      const { tasks, book } = buildDay();
      const { sameDayBooking } = sampleGooseFeed();
      const raw = sameDayBooking.record;
      const before = tasks.length;
      await log(line('10:12', 'warn', `Ziggy is booked for today. The webhook is lost on the way. Tasks in the plan: ${before}.`));
      const results = await pollOnce(book, tasks, async () => [raw], 614);
      await log(line('10:14', 'ok', `The 2-minute poll asks Goose what changed since the last cursor and finds the booking: <strong>${results[0].added} tasks added</strong>${results[0].updated ? `, ${results[0].updated} feeding round updated` : ''}. Tasks: ${tasks.length}.`));
      const late = applyGooseRecord(book, raw);
      const s1 = tasksForChange(tasks, late, 615);
      await log(line('10:15', 'info', `The delayed webhook finally arrives: “${late.change}”, ${s1.added.length} added. Tasks still ${tasks.length}.`));
      const older = applyGooseRecord(book, { ...raw, updated_at: '2026-11-18T09:58:00-06:00', medications: [] });
      const s2 = tasksForChange(tasks, older, 616);
      await log(line('10:16', 'info', `An older version (from 9:58) shows up out of order: “${older.change}”, ${s2.cancelled.length} cancelled. Ziggy’s 5:00 PM meds stay on the list.`));
    },
  },
  {
    id: 'sig',
    title: 'Forged and replayed Slack requests',
    q: 'Anyone can post to a public URL. Does the endpoint only trust Slack, and only fresh requests?',
    async run(log) {
      const now = Number(SLACK_EXAMPLE.timestamp) + 20;
      const ok = await verifySlackRequest({ ...SLACK_EXAMPLE, nowSec: now });
      await log(line(ok.ok ? 'accepted' : 'refused', ok.ok ? 'ok' : 'bad', 'Slack’s own published example request: signature recomputed and it matches.'));
      const forged = await verifySlackRequest({ ...SLACK_EXAMPLE, rawBody: SLACK_EXAMPLE.rawBody.replace('roadrunner', 'roadrunnes'), nowSec: now });
      await log(line(forged.ok ? 'accepted' : 'refused', forged.ok ? 'bad' : 'ok', `Same request with one letter changed in the body: <code>${forged.reason}</code>.`));
      const replay = await verifySlackRequest({ ...SLACK_EXAMPLE, nowSec: Number(SLACK_EXAMPLE.timestamp) + 6 * 60 });
      await log(line(replay.ok ? 'accepted' : 'refused', replay.ok ? 'bad' : 'ok', `The genuine request replayed 6 minutes later: <code>${replay.reason}</code> (Slack’s 5-minute window).`));
      const none = await verifySlackRequest({ ...SLACK_EXAMPLE, signature: '', nowSec: now });
      await log(line(none.ok ? 'accepted' : 'refused', none.ok ? 'bad' : 'ok', `No signature header at all: <code>${none.reason}</code>.`));
    },
  },
];

export function initLab() {
  const grid = document.querySelector('#lab-grid');
  grid.innerHTML = EXPERIMENTS.map((x) => `<article class="panel exp" id="exp-${x.id}">
    <div class="exp-head"><h3>${esc(x.title)}</h3><button type="button" class="btn" data-run="${x.id}">Run</button></div>
    <p class="q">${esc(x.q)}</p>
    <ol class="log" aria-live="polite"><li class="idle">Press Run.</li></ol>
  </article>`).join('');
  grid.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-run]');
    if (!b || b.disabled) return;
    const x = EXPERIMENTS.find((y) => y.id === b.dataset.run);
    const ol = b.closest('.exp').querySelector('.log');
    ol.innerHTML = '';
    b.disabled = true;
    b.textContent = 'Running';
    try {
      await x.run(async (html) => { ol.insertAdjacentHTML('beforeend', html); await pause(380); });
    } catch (err) {
      ol.insertAdjacentHTML('beforeend', line('error', 'bad', esc(err.message)));
    }
    b.disabled = false;
    b.textContent = 'Run again';
  });
}
