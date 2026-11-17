// A small Block Kit renderer for the blocks this app uses. It draws the real JSON;
// it does not re-describe it, so what you see here is what the engine sends.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mrkdwn(text) {
  return esc(text)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
}
const txt = (t) => (!t ? '' : t.type === 'mrkdwn' ? mrkdwn(t.text) : esc(t.text));

function element(el, ctx) {
  const id = `${ctx.prefix}-${ctx.n++}`;
  if (el.type === 'button') {
    const cls = `sk-btn${el.style ? ` ${el.style}` : ''}`;
    if (el.url) return `<a class="${cls}" href="${esc(el.url)}" target="_blank" rel="noopener" data-url="1">${txt(el.text)}</a>`;
    return `<button type="button" class="${cls}" data-action="${esc(el.action_id)}" data-value="${esc(el.value ?? '')}">${txt(el.text)}</button>`;
  }
  if (el.type === 'checkboxes') {
    return `<div class="sk-checks" role="group" aria-label="Steps">${el.options.map((o, i) => `<label><input type="checkbox" id="${id}-${i}" data-action="${esc(el.action_id)}" value="${esc(o.value)}"><span>${txt(o.text)}</span></label>`).join('')}</div>`;
  }
  if (el.type === 'radio_buttons') {
    return `<div class="sk-radio" role="radiogroup">${el.options.map((o, i) => `<label><input type="radio" name="${id}" value="${esc(o.value)}" ${i === 0 ? 'checked' : ''}><span>${txt(o.text)}</span></label>`).join('')}</div>`;
  }
  if (el.type === 'static_select') {
    return `<select class="sk-select" data-action="${esc(el.action_id)}" aria-label="${esc(el.placeholder?.text ?? 'Choose')}"><option value="">${esc(el.placeholder?.text ?? 'Choose')}</option>${el.options.map((o) => `<option value="${esc(o.value)}">${txt(o.text)}</option>`).join('')}</select>`;
  }
  if (el.type === 'plain_text_input') return `<textarea id="${id}" aria-label="Note" maxlength="${el.max_length ?? 3000}"></textarea>`;
  if (el.type === 'file_input') return `<div class="sk-drop">Drag a photo here or tap to choose<br><small>${esc((el.filetypes ?? []).join(', '))} · up to ${el.max_files ?? 10} files</small></div>`;
  return `<span class="sk-context">[${esc(el.type)}]</span>`;
}

function block(b, ctx) {
  switch (b.type) {
    case 'header': return `<div class="sk-header">${txt(b.text)}</div>`;
    case 'divider': return '<hr class="sk-divider">';
    case 'context': return `<div class="sk-context">${b.elements.map(txt).join(' ')}</div>`;
    case 'actions': return `<div class="sk-actions">${b.elements.map((e) => element(e, ctx)).join('')}</div>`;
    case 'section': {
      const body = [b.text ? `<div>${txt(b.text)}</div>` : '', b.fields ? `<div class="sk-fields">${b.fields.map((f) => `<div>${txt(f)}</div>`).join('')}</div>` : ''].join('');
      return b.accessory ? `<div class="sk-section"><div>${body}</div>${element(b.accessory, ctx)}</div>` : body;
    }
    case 'input': return `<div class="sk-input"><label class="lab">${txt(b.label)}${b.optional ? ' <small>(optional)</small>' : ''}</label>${element(b.element, ctx)}</div>`;
    default: return '';
  }
}

export function renderBlocks(blocks, prefix = 'bk') {
  const ctx = { n: 0, prefix };
  return `<div class="sk-blocks">${blocks.map((b) => block(b, ctx)).join('')}</div>`;
}

/** A DM message from the app, as it appears in the Slack mobile client (look-alike, not Slack's UI). */
export function renderMessage(msg, timeLabel, prefix) {
  return `<div class="sk-msg"><div class="sk-av" aria-hidden="true">WE</div><div><div class="sk-name">Work Engine<span class="sk-apptag">App</span><time>${esc(timeLabel)}</time></div>${renderBlocks(msg.blocks, prefix)}</div></div>`;
}

export function renderModal(view, prefix) {
  return `<div class="sk-modal" role="dialog" aria-label="${esc(view.title.text)}"><div class="sk-modal-head"><span>${esc(view.title.text)}</span><span aria-hidden="true">✕</span></div><div class="sk-modal-body">${renderBlocks(view.blocks, prefix)}</div><div class="sk-modal-foot">${view.close ? `<button type="button" class="sk-btn" data-modal="close">${esc(view.close.text)}</button>` : ''}${view.submit ? `<button type="button" class="sk-btn primary" data-modal="submit">${esc(view.submit.text)}</button>` : ''}</div></div>`;
}

export function renderHome(view, prefix) {
  return `<div class="sk-home-head">Work Engine · Home</div>${renderBlocks(view.blocks, prefix)}`;
}
