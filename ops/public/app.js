const app = document.querySelector('#app');
const state = {
  authed: false,
  view: 'today',
  workspace: null,
  contact: null,
  review: null,
  results: [],
  query: '',
  notice: '',
  error: '',
  busy: false,
};

window.addEventListener('hashchange', () => {
  if (!state.authed) return;
  route();
});
boot();

async function boot() {
  const session = await fetch('/api/session').then((response) => response.json());
  state.authed = Boolean(session.ok);
  if (!state.authed) {
    state.view = 'login';
    render();
    return;
  }
  route();
}

function route() {
  const hash = location.hash || '#/today';
  const parts = hash.replace(/^#\//, '').split('/');
  state.view = parts[0] || 'today';
  if (state.view === 'contact' && parts[1]) return openContact(decodeURIComponent(parts[1]));
  if (state.view === 'review' && parts[1]) return openReview(decodeURIComponent(parts[1]));
  if (state.view === 'today') return loadToday();
  render();
}

async function loadToday() {
  try {
    state.workspace = await api('/api/workspace');
    state.view = 'today';
  } catch {
    state.error = 'The desk could not load. Leave this page open and refresh it.';
  }
  render();
}

async function openContact(id) {
  try {
    state.contact = await api(`/api/contacts/${id}`);
    state.view = 'contact';
  } catch {
    state.error = 'That client could not be opened.';
  }
  render();
}

async function openReview(id) {
  try {
    state.review = await api(`/api/reviews/${id}`);
    state.view = 'review';
  } catch {
    state.error = 'That review could not be opened.';
  }
  render();
}

function render() {
  app.replaceChildren(shell());
}

function shell() {
  const root = el('div', { class: 'app' });
  root.append(nav(), top(), main());
  return root;
}

function nav() {
  const bar = el('nav', { class: 'nav' });
  for (const item of [
    ['today', 'Today'],
    ['new', 'New lead'],
    ['search', 'Search'],
    ['queue', 'Queue'],
  ]) {
    const button = el('button', {
      type: 'button',
      class: state.view === item[0] ? 'active' : '',
      text: item[1],
      onclick: () => {
        state.notice = '';
        state.error = '';
        location.hash = `#/${item[0]}`;
      },
    });
    bar.append(button);
  }
  return bar;
}

function top() {
  const header = el('header', { class: 'top' });
  header.append(
    el('div', { class: 'brand' }, [
      el('h1', { text: 'KyleOS Command' }),
      el('p', { text: 'kleinman-lead-desk · Miami Dade and Broward' }),
    ]),
    el('p', { class: 'rule', text: 'Redfin Partner Tools stays the system of record. This desk prepares drafts and notes. It does not text, email, or update Redfin.' }),
  );
  return header;
}

function main() {
  const node = el('main', { class: 'main' });
  if (state.notice) node.append(el('div', { class: 'notice', id: 'notice', text: state.notice }));
  if (state.error) node.append(el('div', { class: 'error', id: 'error', text: state.error }));
  if (state.view === 'login') node.append(loginView());
  if (state.view === 'today') node.append(todayView());
  if (state.view === 'new') node.append(newLeadView());
  if (state.view === 'review') node.append(reviewView());
  if (state.view === 'contact') node.append(contactView());
  if (state.view === 'search' || state.view === 'queue') node.append(state.view === 'queue' ? queueView() : searchView());
  return node;
}

function todayView() {
  const data = state.workspace;
  const wrap = el('div', { class: 'stack' });
  if (!data) {
    wrap.append(el('p', { text: 'Loading the desk.' }));
    return wrap;
  }
  if (data.demoCount > 0) {
    wrap.append(el('p', { class: 'rule', text: 'Sample records are marked DEMO. They are not real clients.' }));
  }
  wrap.append(
    el('h2', { class: 'headline', id: 'attention-headline', text: data.headline }),
    el('p', { class: 'detail', id: 'attention-detail', text: data.detail }),
  );
  const controls = el('div', { class: 'actions' });
  controls.append(
    el('button', {
      class: 'secondary',
      id: 'pause-toggle',
      type: 'button',
      text: data.outboundPaused ? 'Outbound pause is on' : 'Outbound pause is off',
      onclick: togglePause,
    }),
    el('button', { class: 'quiet', id: 'seed-demo', type: 'button', text: 'Load sample day', onclick: () => post('/api/demo/seed').then(loadToday) }),
    el('button', { class: 'quiet', id: 'clear-demo', type: 'button', text: 'Remove sample records', onclick: () => post('/api/demo/clear').then(loadToday) }),
    el('button', { class: 'quiet', id: 'check-redfin', type: 'button', text: 'Check Redfin connection', onclick: checkRedfin }),
  );
  wrap.append(el('div', { class: 'card' }, [controls, el('p', { class: 'empty', text: `Paid services in use: none. Spending limit $${Number(data.spendLimitUsd || 0)}. Estimated monthly cost for this desk: $0.` })]));
  const sections = el('div', { class: 'sections' });
  sections.append(
    section('new-leads', 'New leads', data.newLeads, true),
    section('needs-reply', 'Needs a reply', data.needsReply),
    section('appointments-today', "Today's appointments", data.appointmentsToday),
    section('overdue', 'Overdue follow ups', data.overdueFollowUps),
    section('milestones', 'Upcoming milestones', data.milestones),
    section('drafts', 'Drafts waiting', data.drafts),
    section('failures', 'Failed automations', data.failedAutomations),
    section('no-next', 'No next action', data.noNextAction),
    section('replies-blocked', 'Recent replies', [data.replyConnector]),
    section('system-health', 'System health', data.systemHealth, true),
  );
  wrap.append(sections);
  return wrap;
}

function section(id, title, items, wide = false) {
  const card = el('section', { class: wide ? 'card wide' : 'card', id });
  card.append(el('h2', { text: title }));
  if (!items || items.length === 0) {
    card.append(el('p', { class: 'empty', text: 'Nothing waiting here.' }));
    return card;
  }
  for (const item of items) {
    const button = el('button', { class: 'item', type: 'button', onclick: () => openItem(item) });
    const titleRow = el('strong', { text: item.title });
    titleRow.append(document.createTextNode(' '), el('span', { class: 'pill', text: 'Act' }));
    if (item.isDemo) titleRow.append(document.createTextNode(' '), el('span', { class: 'pill demo', text: 'DEMO' }));
    button.append(titleRow, el('span', { text: `${item.reason} ${item.nextStep}` }));
    card.append(button);
  }
  return card;
}

function openItem(item) {
  if (item.kind === 'system_health' || item.kind === 'connector_blocked') {
    state.notice = `${item.title}. ${item.reason} ${item.nextStep} No message was sent.`;
    state.error = '';
    render();
    return;
  }
  if (item.kind === 'failed_job') {
    post(`/api/jobs/${item.id}/acknowledge`).then(loadToday);
    return;
  }
  if (item.kind === 'draft' && item.contactId) {
    location.hash = `#/contact/${item.contactId}`;
    return;
  }
  if (item.contactId && ['follow_up', 'reply', 'appointment', 'milestone'].includes(item.kind)) {
    location.hash = `#/contact/${item.contactId}`;
    return;
  }
  if (item.kind === 'intake' || item.kind === 'possible_duplicate' || item.kind === 'unreadable_screenshot' || item.kind === 'needs_identity') {
    location.hash = `#/review/${item.id}`;
    return;
  }
  if (item.contactId) location.hash = `#/contact/${item.contactId}`;
}

function newLeadView() {
  const card = el('section', { class: 'card stack' });
  card.append(el('h2', { text: 'New lead' }));
  const text = el('textarea', {
    id: 'lead-text',
    placeholder: 'Paste the lead, the text thread, or the details you can read from a screenshot.',
  });
  const file = el('input', { id: 'screenshot-input', type: 'file', accept: 'image/*' });
  card.append(
    el('label', { for: 'lead-text', text: 'Pasted lead' }),
    text,
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', id: 'intake-submit', type: 'button', text: state.busy ? 'Saving' : 'Add to review queue', disabled: state.busy, onclick: () => submitText(text) }),
    ]),
    el('label', { for: 'screenshot-input', text: 'Or upload a screenshot' }),
    file,
    el('div', { class: 'actions' }, [
      el('button', { class: 'secondary', id: 'screenshot-submit', type: 'button', text: 'Read screenshot', onclick: () => submitImage(file) }),
    ]),
    el('p', { class: 'empty', text: 'Missing facts stay marked Data needed. A requested showing is not treated as confirmed. Nothing is sent.' }),
  );
  return card;
}

async function submitText(text) {
  state.busy = true;
  render();
  const result = await api('/api/intake', { method: 'POST', body: JSON.stringify({ text: text.value }) });
  showResult(result);
}

async function submitImage(file) {
  const chosen = file.files && file.files[0];
  if (!chosen) {
    state.error = 'Choose a screenshot first.';
    render();
    return;
  }
  const imageBase64 = await fileToDataUrl(chosen);
  const result = await api('/api/intake/screenshot', { method: 'POST', body: JSON.stringify({ imageBase64 }) });
  showResult(result);
}

function showResult(result) {
  state.busy = false;
  state.notice = result.message || 'Saved.';
  state.error = '';
  if (result.reviewId) {
    location.hash = `#/review/${result.reviewId}`;
    return;
  }
  state.view = 'new';
  render();
}

function reviewView() {
  const review = state.review;
  const wrap = el('div', { class: 'stack' });
  if (!review) {
    wrap.append(el('p', { text: 'Loading review.' }));
    return wrap;
  }
  const payload = review.payload || {};
  wrap.append(el('h2', { class: 'headline', text: review.title || 'Review' }));
  if (review.isDemo) wrap.append(el('span', { class: 'pill demo', text: 'DEMO' }));
  wrap.append(el('p', { class: 'detail', text: payload.summary || payload.reason || '' }));
  if (payload.internalNote) wrap.append(el('section', { class: 'card' }, [el('h2', { text: 'Internal note' }), el('p', { text: payload.internalNote })]));
  const draftBody = (review.draft && review.draft.body) || payload.draftBody;
  if (payload.fields) {
    const facts = el('section', { class: 'card', id: 'fact-basis' });
    facts.append(el('h2', { text: 'Said, confirmed, inferred, missing' }));
    for (const fact of payload.fields) {
      const row = el('div', { class: 'fact' });
      row.append(el('b', { text: fact.label }), el('span', { class: 'pill', text: basisLabel(fact) }));
      const value = fact.status === 'known' ? fact.value : fact.status === 'unclear' ? 'Unclear, not saved as fact' : 'Missing';
      row.append(el('span', { class: fact.status === 'known' ? '' : 'needed', text: value }));
      facts.append(row);
    }
    wrap.append(facts);
  }
  if (draftBody) {
    wrap.append(el('section', { class: 'card' }, [
      el('h2', { text: 'SEND' }),
      el('p', { class: 'message', id: 'draft-body', text: draftBody }),
      el('p', { class: 'empty', text: `To ${payload.recipient || (review.draft && review.draft.recipient) || 'Data needed'} by ${payload.channel || (review.draft && review.draft.channel) || 'text'}. Suggested time, not a scheduled send: ${(payload.followUp && payload.followUp.display) || 'not set'}.` }),
    ]));
  }
  if (payload.crmNote) {
    wrap.append(el('section', { class: 'card' }, [el('h2', { text: 'NOTE' }), el('pre', { class: 'note', id: 'crm-note', text: payload.crmNote })]));
  }
  if (payload.followUp) {
    wrap.append(el('section', { class: 'card', id: 'next-action' }, [
      el('h2', { text: 'NEXT' }),
      el('p', { text: payload.followUp.action }),
      el('p', { class: 'empty', text: `${payload.followUp.display}. ${payload.followUp.reason}` }),
    ]));
  }
  if (payload.warnings && payload.warnings.length) {
    wrap.append(el('section', { class: 'card' }, [el('h2', { text: 'Needs a look' }), ...payload.warnings.map((warning) => el('p', { text: warning }))]));
  }
  if (payload.conflicts && payload.conflicts.length) {
    wrap.append(el('section', { class: 'card' }, [
      el('h2', { text: 'Conflicts kept' }),
      ...payload.conflicts.map((conflict) => el('p', { text: `${conflict.field}: kept ${conflict.existing}. Incoming ${conflict.incoming} was not overwritten.` })),
    ]));
  }
  const actions = el('div', { class: 'actions' });
  if (review.kind === 'possible_duplicate') {
    const candidates = payload.candidates || [];
    for (const candidate of candidates) {
      actions.append(el('button', {
        class: 'primary',
        type: 'button',
        text: `Attach to ${candidate.name}`,
        onclick: () => resolveReview('attach', candidate.id),
      }));
    }
    actions.append(el('button', { class: 'secondary', type: 'button', text: 'Keep as a separate contact', onclick: () => resolveReview('separate') }));
  } else if (review.kind === 'intake' && review.status === 'pending') {
    actions.append(el('button', { class: 'primary', id: 'approve-review', type: 'button', text: 'Save note and follow up', onclick: approve }));
  }
  if (review.status === 'pending') {
    actions.append(el('button', { class: 'quiet', id: 'dismiss-review', type: 'button', text: 'Dismiss', onclick: dismiss }));
  }
  if (review.draft) {
    actions.append(el('button', { class: 'secondary', type: 'button', text: 'Copy message', onclick: () => copyText(review.draft.body) }));
    actions.append(el('button', { class: 'secondary', id: 'send-draft', type: 'button', text: 'Try to send', onclick: () => sendDraft(review.draft.id) }));
  }
  if (review.contactId) {
    actions.append(el('button', { class: 'quiet', type: 'button', text: 'Open client', onclick: () => { location.hash = `#/contact/${review.contactId}`; } }));
  }
  wrap.append(actions);
  return wrap;
}

function contactView() {
  const contact = state.contact;
  const wrap = el('div', { class: 'stack' });
  if (!contact) {
    wrap.append(el('p', { text: 'Loading client.' }));
    return wrap;
  }
  const title = el('h2', { class: 'headline', id: 'client-name', text: contact.displayName });
  wrap.append(title);
  if (contact.isDemo) wrap.append(el('span', { class: 'pill demo', text: 'DEMO' }));
  wrap.append(el('p', { class: 'detail', text: contact.nextAction }));
  const facts = el('section', { class: 'card' });
  facts.append(el('h2', { text: 'What we know' }));
  for (const fact of contact.facts) {
    const row = el('div', { class: 'fact' });
    row.append(el('b', { text: fact.label }));
    const value = fact.status === 'known' ? fact.value : fact.status === 'unclear' ? 'Unclear, kept for review' : 'Missing';
    row.append(el('span', { class: 'pill', text: basisLabel(fact) }));
    row.append(el('span', { class: fact.status === 'known' ? '' : 'needed', text: value }));
    facts.append(row);
  }
  wrap.append(facts);
  if (contact.conflicts.length) {
    wrap.append(el('section', { class: 'card' }, [
      el('h2', { text: 'Conflicts' }),
      ...contact.conflicts.map((conflict) => el('p', { text: `${conflict.fieldKey}: kept ${conflict.existingValue}. Incoming ${conflict.incomingValue}.` })),
    ]));
  }
  if (contact.drafts.length) {
    wrap.append(el('section', { class: 'card' }, [
      el('h2', { text: 'Drafts' }),
      ...contact.drafts.map((draft) => el('p', { class: 'message', text: draft.body })),
    ]));
  }
  if (contact.notes.length) {
    wrap.append(el('section', { class: 'card' }, [
      el('h2', { text: 'Notes' }),
      ...contact.notes.map((note) => el('pre', { class: 'note', text: note.body })),
    ]));
  }
  if (contact.tasks.length) {
    wrap.append(el('section', { class: 'card' }, [
      el('h2', { text: 'Tasks' }),
      ...contact.tasks.map((task) => el('p', { text: `${task.status}: ${task.detail || task.title}` })),
    ]));
  }
  if (contact.appointments.length) {
    wrap.append(el('section', { class: 'card' }, [
      el('h2', { text: 'Showings' }),
      ...contact.appointments.map((item) => el('p', { text: `${item.timeRole}: ${item.title}` })),
    ]));
  }
  if (contact.activities.length) {
    wrap.append(el('section', { class: 'card' }, [
      el('h2', { text: 'History' }),
      ...contact.activities.map((item) => el('p', { text: item.summary })),
    ]));
  }
  return wrap;
}

function loginView() {
  const card = el('section', { class: 'card stack' });
  const input = el('input', { id: 'login-password', type: 'password', placeholder: 'Local password' });
  card.append(
    el('h2', { text: 'Sign in' }),
    el('p', { class: 'empty', text: 'Kyle only. The local password is in the setup guide. Live sending stays off.' }),
    el('label', { for: 'login-password', text: 'Password' }),
    input,
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', id: 'login-submit', type: 'button', text: 'Open the board', onclick: () => signIn(input) }),
    ]),
  );
  return card;
}

async function signIn(input) {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: input.value }),
  });
  if (!response.ok) {
    state.error = 'That password did not match.';
    render();
    return;
  }
  state.authed = true;
  state.error = '';
  location.hash = '#/today';
  await loadToday();
}

function basisLabel(fact) {
  if (fact.status === 'unclear') return 'Unclear';
  if (fact.basis === 'confirmed') return 'Confirmed';
  if (fact.basis === 'inferred') return 'Inferred';
  if (fact.basis === 'stale') return 'Stale';
  if (fact.basis === 'said') return 'Said';
  return 'Missing';
}

function searchView() {
  const card = el('section', { class: 'card' });
  card.append(el('h2', { text: 'Search' }));
  const input = el('input', { id: 'search-input', type: 'search', placeholder: 'Name, phone, email, or property', value: state.query });
  input.addEventListener('input', () => {
    state.query = input.value;
    search(input.value, card);
  });
  card.append(input, el('div', { class: 'search-results', id: 'search-results' }));
  return card;
}

function queueView() {
  const data = state.workspace;
  const wrap = el('div', { class: 'stack' });
  wrap.append(el('h2', { class: 'headline', text: 'Review queue' }));
  if (!data) {
    wrap.append(el('p', { text: 'Open Today once so the queue can load.' }));
    loadToday();
    return wrap;
  }
  wrap.append(section('queue-leads', 'Waiting on you', [...data.newLeads, ...data.drafts, ...data.failedAutomations], true));
  return wrap;
}

async function search(query, card) {
  const data = await api(`/api/contacts?q=${encodeURIComponent(query)}`);
  const box = card.querySelector('#search-results');
  box.replaceChildren();
  for (const contact of data.contacts || []) {
    const button = el('button', {
      class: 'item',
      type: 'button',
      onclick: () => { location.hash = `#/contact/${contact.id}`; },
    });
    button.append(el('strong', { text: contact.displayName }));
    if (contact.isDemo) button.append(el('span', { class: 'pill demo', text: 'DEMO' }));
    box.append(button);
  }
  if ((data.contacts || []).length === 0) box.append(el('p', { class: 'empty', text: 'No matching client.' }));
}

async function approve() {
  const result = await api(`/api/reviews/${state.review.id}/approve`, { method: 'POST', body: '{}' });
  state.notice = result.message;
  if (state.review.contactId) location.hash = `#/contact/${state.review.contactId}`;
  else render();
}

async function dismiss() {
  const result = await api(`/api/reviews/${state.review.id}/dismiss`, { method: 'POST', body: '{}' });
  state.notice = result.message;
  location.hash = '#/today';
}

async function resolveReview(decision, contactId) {
  const result = await api(`/api/reviews/${state.review.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision, contactId }),
  });
  state.notice = result.message;
  if (result.reviewId) location.hash = `#/review/${result.reviewId}`;
  else render();
}

async function sendDraft(id) {
  const result = await api(`/api/drafts/${id}/send`, { method: 'POST', body: '{}' });
  state.error = result.reason || 'Nothing was sent.';
  state.notice = '';
  render();
}

async function togglePause() {
  const next = !state.workspace.outboundPaused;
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ outboundPaused: next }) });
  await loadToday();
  state.notice = next
    ? 'Outbound pause is on. Drafts stay here.'
    : 'Pause is off. Sends are still blocked until you authorize a specific workflow.';
  render();
}

async function checkRedfin() {
  const result = await api('/api/integrations/redfin/check', { method: 'POST', body: '{}' });
  state.notice = result.message;
  await loadToday();
}

async function post(path) {
  return api(path, { method: 'POST', body: '{}' });
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    state.notice = 'Message copied. Paste it into your texting app yourself.';
  } catch {
    state.error = 'Copy failed. Select the message and copy it manually.';
  }
  render();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'disabled') node.disabled = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}
