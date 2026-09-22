/* Operating Agent — side panel controller. Routes modes, renders, gates. Never acts. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let mode = 'auto';
  let lastRead = null;
  let pasteTarget = null;
  let inboxChannel = 'gmail';

  function supportedUrl(url) {
    return /redfin\.com\/tools/.test(url || '') || /mail\.google\.com/.test(url || '') || /followupboss\.com/.test(url || '');
  }

  function activeTab() {
    return chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]);
  }
  async function readPage() {
    const tab = await activeTab();
    if (!tab || !supportedUrl(tab.url || '')) return { pageType: 'off-domain' };
    try { return await chrome.tabs.sendMessage(tab.id, { cmd: 'READ' }); }
    catch (e) { return { pageType: 'no-reader', error: String(e) }; }
  }

  function setStatus(kind, text) {
    const el = $('status');
    el.className = 's-' + kind;
    el.innerHTML = '<span class="dot"></span><span>' + esc(text) + '</span>';
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1400);
  }
  function copyText(txt, btn) {
    navigator.clipboard.writeText(txt).then(() => {
      toast('Copied');
      if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = o, 1200); }
    }).catch(() => toast('Copy failed'));
  }
  function card(title, bodyHtml, copyPayload, cls) {
    const cp = copyPayload != null ? '<button class="cp">Copy</button>' : '';
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<div class="ch"><span class="t">' + esc(title) + '</span>' + cp + '</div>' +
      '<div class="bd ' + (cls || '') + '">' + bodyHtml + '</div>';
    if (copyPayload != null) el.querySelector('.cp').addEventListener('click', e => copyText(copyPayload, e.target));
    return el;
  }
  const kv = (k, v) => v ? '<div class="kv"><span class="k">' + esc(k) + '</span><span>' + esc(v) + '</span></div>' : '';
  function pill(pr) {
    const map = { High: 'p-high', Medium: 'p-med', Low: 'p-low', 'Needs Review': 'p-review' };
    return '<span class="pill ' + (map[pr] || 'p-med') + '">' + esc(pr) + '</span>';
  }
  function clearBody() { $('body').innerHTML = ''; }
  function message(msg) { clearBody(); $('body').appendChild(card('Agent', '<span class="empty">' + esc(msg) + '</span>')); }

  function hideExtraPaste() {
    if (!PASTE_MODES[mode]) $('pasteWrap').classList.add('hidden');
    if (pasteTarget === 'inbox') pasteTarget = null;
  }

  function showInboxPaste(channel) {
    inboxChannel = channel;
    pasteTarget = 'inbox';
    $('pasteWrap').classList.remove('hidden');
    $('pasteLabel').textContent = channel === 'fub'
      ? 'Paste one Follow Up Boss person if the page did not parse'
      : 'Paste one Gmail thread if the page did not parse';
    $('paste').placeholder = 'One contact only. From, subject, and the message. Do not paste a whole inbox.';
  }

  function formatPrefillResult(res) {
    if (!res) return '<span class="miss">No response from the page.</span>';
    let html = '';
    (res.blocked || []).forEach(b => html += '<span class="flag block">' + esc(b.reason || b.key) + '</span>');
    if (res.filled && res.filled.length) html += '<span class="flag ok">Prefilled: ' + esc(res.filled.join(', ')) + '. Nothing was sent, saved, or submitted.</span>';
    (res.already || []).forEach(k => html += '<span class="miss">Already in the field: ' + esc(k) + '</span>');
    (res.occupied || []).forEach(k => html += '<span class="miss">Left alone (already had text): ' + esc(k) + '</span>');
    (res.missed || []).forEach(m => html += '<span class="miss">' + esc((m && m.reason) || m) + '</span>');
    if (!html) html = '<span class="miss">Nothing to write.</span>';
    return html;
  }

  function renderPrefill(parent, plan, intro) {
    if (!plan) return;
    const gate = document.createElement('div');
    gate.className = 'gate';
    if (plan.blocked.length && !plan.fields.length) {
      gate.innerHTML = '<b>Prefill blocked</b>' + plan.blocked.map(b => '<span class="flag block">' + esc(b.reason) + '</span>').join('');
      parent.appendChild(gate);
      return;
    }
    if (!plan.fields.length) return;
    const names = plan.fields.map(f => esc(f.label)).join(', ');
    gate.innerHTML = '<b>Prefill approval</b><div>' + esc(intro || '') + 'Will write: ' + names + '. Nothing is submitted, sent, saved, or signed.</div>' +
      '<div class="opts"><button class="ok" data-a="prefill">Approve prefill</button><button class="dnc" data-a="skip">Do not prefill</button></div>' +
      '<div class="pkg"></div>';
    const pkg = gate.querySelector('.pkg');
    gate.querySelector('[data-a="prefill"]').addEventListener('click', async () => {
      const tab = await activeTab();
      if (!tab) { pkg.innerHTML = '<span class="miss">No active tab.</span>'; return; }
      let res;
      try { res = await chrome.tabs.sendMessage(tab.id, { cmd: 'PREFILL', fields: plan.fields.map(f => ({ key: f.key, value: f.value })) }); }
      catch (e) { pkg.innerHTML = '<span class="miss">Page reader is not loaded. Refresh the tab and Analyze again.</span>'; return; }
      pkg.innerHTML = formatPrefillResult(res);
      toast('Prefill finished. Nothing sent.');
    });
    gate.querySelector('[data-a="skip"]').addEventListener('click', () => {
      pkg.innerHTML = '<span class="empty">Prefill skipped. Nothing was written.</span>';
    });
    parent.appendChild(gate);
  }

  function renderLead(c) {
    hideExtraPaste();
    const d = leadDecide(c);
    const k = leadContent(c, d);
    clearBody();
    const rec = document.createElement('div');
    rec.className = 'rec';
    rec.innerHTML = '<div class="lbl">Recommended</div><div class="act">' + pill(d.priority) + esc(d.nextAction) + '</div>' +
      '<div>' + esc(d.recClick) + '</div>' +
      '<div class="gate" style="margin:8px 0 0"><b>Approval gate</b>Nothing is sent, completed, dismissed, or clicked by this agent. You do it, or it does not happen.</div>';
    $('body').appendChild(rec);
    $('body').appendChild(card('Lead summary', kv('Name', c.name) + kv('Status', c.status) + kv('Phone', c.phone) +
      kv('Lead source', c.leadSource) + kv('First tour', c.firstTour) + kv('Activity', c.activityRaw) +
      kv('Last met', c.lastMet) + kv('Assigned', c.assigned) + kv('Follow-up plan', c.followupPlan) +
      kv('Read from', c.source) + kv('Why it matters', d.reason)));
    if (d.flags.length || d.missing.length) {
      let f = '';
      d.flags.forEach(fl => f += '<span class="flag ' + (fl.type === 'rev' ? 'rev' : fl.type === 'block' ? 'block' : '') + '">' + esc(fl.text) + '</span>');
      d.missing.forEach(m => f += '<span class="miss">Missing: ' + esc(m) + '</span>');
      $('body').appendChild(card('Risk flags & missing info', f));
    }
    $('body').appendChild(card('Agent Tools note', esc(k.note), k.note, 'mono'));
    $('body').appendChild(card('Follow-up task', esc(k.task) + '\nDisposition: ' + esc(d.disposition) + ' · Reminder: ' + d.reminderDays + ' days', k.task, 'mono'));
    if (k.sms) $('body').appendChild(card('SMS draft', esc(k.sms), k.sms, 'mono'));
    else $('body').appendChild(card('SMS draft', '<span class="empty">Held. Resolve the review flag before contacting.</span>'));
    if (k.email) {
      const full = 'Subject: ' + k.email.subject + '\n\n' + k.email.body;
      $('body').appendChild(card('Email draft', esc(full), full, 'mono'));
    } else if (k.emailBlocked) {
      $('body').appendChild(card('Email draft', '<span class="flag block">' + esc(k.emailBlocked) + '</span>'));
    }
    $('body').appendChild(card('Call reason', esc(k.callReason)));
    if (!k.emailBlocked) {
      const plan = prefillPlan({ note: k.note, recipient: c.email || '' }, ['note']);
      renderPrefill($('body'), plan, 'Writes the note into an empty note field on this page. Existing text is left alone. ');
    }
    if (d.wrongAgent) setStatus('review', 'Needs Review — check assignment');
    else if (d.missing.length) setStatus('missing', 'Ready · ' + d.missing.length + ' field(s) missing');
    else setStatus('ready', 'Ready · ' + d.priority);
  }

  function renderCapture(read) {
    hideExtraPaste();
    clearBody();
    const ctr = read.counters || {};
    const ctrPills = [['Unclaimed offers for you', ctr.unclaimedOffersYou], ['Customer reminders for you', ctr.customerRemindersYou],
      ['Unclaimed offers for team', ctr.unclaimedOffersTeam], ['Unclaimed listings for you', ctr.unclaimedListingsYou],
      ['Unclaimed listings for team', ctr.unclaimedListingsTeam], ['New tours for team', ctr.newToursTeam]]
      .filter(([, v]) => v != null).map(([k, v]) => '<span class="pill ' + (v > 0 ? 'p-high' : 'p-low') + '">' + esc(k) + ': ' + v + '</span>').join('');
    if (ctrPills) {
      const c = document.createElement('div'); c.className = 'counters'; c.innerHTML = ctrPills;
      $('body').appendChild(c);
      const yours = (ctr.unclaimedOffersYou || 0) + (ctr.unclaimedListingsYou || 0) + (ctr.customerRemindersYou || 0);
      const guide = yours > 0 ? 'You have ' + yours + ' unclaimed item(s) with your name on them. Click those counters first, they are yours to take.'
        : 'Nothing unclaimed for you personally. Team queues below are capture-and-verify territory.';
      $('body').appendChild(card('Where to click next', esc(guide)));
    }
    const rows = read.rows || [];
    if (!rows.length) {
      $('body').appendChild(card('Capture', '<span class="empty">No parseable rows visible. Scroll the list into view, set the filter (Show All Active, New Tours, Unscheduled Tours, Scheduled: Upcoming, or Recently Completed Tours), then Analyze again.</span>'));
      setStatus('idle', 'No rows read');
      return;
    }
    setStatus('ready', rows.length + ' package(s) prepared · permission gated');
    rows.forEach((r, i) => {
      const p = buildCapture(r);
      const wrap = document.createElement('div');
      wrap.className = 'card';
      let head = '<div class="ch"><span class="t">' + (i + 1) + '. ' + esc(r.name || 'Unknown contact') + '</span>' +
        '<span class="pill ' + (p.ownership === 'kyle' ? 'p-low' : 'p-review') + '">' + esc(p.cls) + '</span></div>';
      let bd = '<div class="bd">';
      bd += kv('Main angle', p.cls) + kv('Appointment', r.apptType) + kv('When', r.datetime) + kv('Status', r.scheduled) +
        kv('Property', r.address) + kv('MLS', r.mls) + kv('Price', r.price) + kv('Phone', r.phone) +
        kv('Email', p.emailBlocked ? 'BLOCKED (internal)' : r.email) + kv('ID verification', r.idVerified) +
        kv('Preapproval', r.preapproved) + kv('Owner agent', r.assigned || 'not shown');
      p.flags.forEach(fl => bd += '<span class="flag ' + (fl.type === 'rev' ? 'rev' : 'block') + '">' + esc(fl.text) + '</span>');
      p.missing.forEach(m => bd += '<span class="miss">Missing info: ' + esc(m) + '</span>');
      bd += '<div class="kv"><span class="k">Next click</span><span>' + esc(p.nextClick) + '</span></div>';
      bd += '</div>';
      bd += '<div class="gate"><b>Permission Required</b>This contact came from a team/shared Agent Tools source. Confirm Kyle has permission to contact this person before any outreach.' +
        '<div class="opts"><button class="ok" data-a="approve">Approve outreach</button>' +
        '<button data-a="save">Save to database only</button>' +
        '<button data-a="review">Needs review</button>' +
        '<button class="dnc" data-a="dnc">Do not contact</button></div></div>';
      bd += '<div class="pkg"></div>';
      wrap.innerHTML = head + bd;
      const pkg = wrap.querySelector('.pkg');
      wrap.querySelectorAll('.gate .opts button').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = btn.getAttribute('data-a');
          pkg.innerHTML = '';
          if (a === 'approve') {
            if (p.emailBlocked) {
              pkg.appendChild(card('Outreach blocked', '<span class="flag block">Needs Review: Redfin internal email detected. Do not send through this agent.</span>'));
              toast('Redfin email blocked');
              return;
            }
            pkg.appendChild(card('FUB contact record', esc(p.fubText), p.fubText, 'mono'));
            pkg.appendChild(card('FUB note', esc(p.note), p.note, 'mono'));
            pkg.appendChild(card('Follow-up task', esc(p.task), p.task, 'mono'));
            pkg.appendChild(card('SMS draft', esc(p.sms), p.sms, 'mono'));
            const plan = prefillPlan({ note: p.note, task: p.task, recipient: r.email || '' }, ['note', 'task']);
            renderPrefill(pkg, plan, 'Writes into empty note or task fields. Does not save or send. ');
            toast('Outreach approved by Kyle');
          } else if (a === 'save') {
            pkg.appendChild(card('FUB contact record (database only)', esc(p.fubText), p.fubText, 'mono'));
            pkg.appendChild(card('FUB note', esc(p.note), p.note, 'mono'));
            pkg.appendChild(card('Outreach', '<span class="empty">Held per your choice. No call, text, or email action created.</span>'));
            const plan = prefillPlan({ note: p.note, recipient: r.email || '' }, ['note']);
            renderPrefill(pkg, plan, 'Writes the note only. Does not save or send. ');
            toast('Saved to database package only');
          } else if (a === 'review') {
            const list = ['Assigned agent', 'Owner agent', 'Lead ownership', 'Buyer/seller intent', 'Contact permission', 'Redfin policy concern', 'Missing phone/email']
              .map(x => '<span class="miss">Verify: ' + x + '</span>').join('');
            pkg.appendChild(card('Needs review before anything else', list));
            toast('Marked needs review');
          } else {
            pkg.appendChild(card('Do not contact', '<span class="flag block">Marked DNC by Kyle. No package, no outreach, no task.</span>'));
            toast('Marked do not contact');
          }
        });
      });
      $('body').appendChild(wrap);
    });
  }

  function mountInboundPackage(parent, c, d, read) {
    parent.appendChild(card('Agent note', esc(d.note), d.note, 'mono'));
    parent.appendChild(card('Follow-up task', esc(d.task), d.task, 'mono'));
    parent.appendChild(card('FUB contact record', esc(d.fubText), d.fubText, 'mono'));
    if (d.sms) parent.appendChild(card('SMS draft', esc(d.sms), d.sms, 'mono'));
    if (d.email) {
      const full = 'Subject: ' + d.email.subject + '\n\n' + d.email.body;
      parent.appendChild(card('Email draft', esc(full), full, 'mono'));
    }
    attachInboundPrefill(parent, c, d, read);
  }

  function attachInboundPrefill(parent, c, d, read) {
    if (d.blocked || d.automated || d.fromMe) return;
    const compose = read.compose || { open: false, subjectEmpty: false };
    if (c.channel === 'gmail' && !compose.open) {
      const gate = document.createElement('div');
      gate.className = 'gate';
      gate.innerHTML = '<b>Prefill</b>Click Reply so the compose box is open, then Analyze again. Approve prefill writes the draft into that box. You still send it yourself.';
      parent.appendChild(gate);
      return;
    }
    const allow = c.channel === 'gmail'
      ? ['emailBody'].concat(compose.subjectEmpty ? ['emailSubject'] : [])
      : ['note', 'task'];
    const plan = prefillPlan({
      note: d.note,
      task: d.task,
      sms: d.sms,
      emailSubject: d.email && d.email.subject,
      emailBody: d.email && d.email.body,
      recipient: c.email || ''
    }, allow);
    renderPrefill(parent, plan, c.channel === 'gmail'
      ? 'Writes into the open compose box only. '
      : 'Writes into empty note or task fields only. Existing text is left alone. ');
  }

  function renderInbound(read) {
    hideExtraPaste();
    const c = read.single;
    if (!c || (!c.name && !c.email && !c.body && !c.phone)) {
      const channel = (read.pageType || '').indexOf('fub') === 0 ? 'fub' : 'gmail';
      message(channel === 'gmail'
        ? 'No message text visible. Expand the thread, then Analyze. Or paste one thread below.'
        : 'No contact visible. Open one person, then Analyze. Or paste one person below.');
      showInboxPaste(channel);
      setStatus('missing', 'Nothing to read');
      return;
    }
    const d = inboundDecide(c);
    clearBody();
    const rec = document.createElement('div');
    rec.className = 'rec';
    rec.innerHTML = '<div class="lbl">Recommended · ' + esc(c.source || c.channel) + '</div><div class="act">' + pill(d.priority) + esc(d.nextAction) + '</div>' +
      '<div>' + esc(d.recClick) + '</div>';
    $('body').appendChild(rec);
    $('body').appendChild(card('Lead summary',
      kv('Name', c.name) + kv('Email', d.blocked ? 'BLOCKED (internal)' : c.email) + kv('Phone', c.phone) +
      kv('Subject', c.subject) + kv('Stage', c.stage) + kv('Source', c.leadSource) +
      kv('Assigned', c.assigned) + kv('Property', c.address) + kv('Read from', c.source) +
      kv('Intent', d.intent) + kv('Why it matters', d.reason)));
    if (d.flags.length || d.missing.length) {
      let f = '';
      d.flags.forEach(fl => f += '<span class="flag ' + (fl.type === 'rev' ? 'rev' : fl.type === 'block' ? 'block' : '') + '">' + esc(fl.text) + '</span>');
      d.missing.forEach(m => f += '<span class="miss">Missing: ' + esc(m) + '</span>');
      $('body').appendChild(card('Risk flags & missing info', f));
    }
    if (d.blocked || d.automated || d.fromMe) {
      $('body').appendChild(card('Outreach', '<span class="empty">Held. No text, email, or prefill for this page.</span>'));
      $('body').appendChild(card('Agent note', esc(d.note), d.note, 'mono'));
    } else if (d.teamGate) {
      const gate = document.createElement('div');
      gate.className = 'gate';
      gate.innerHTML = '<b>Permission Required</b>Team, shared, or unclear ownership. Confirm Kyle has permission to contact this person before any outreach.' +
        '<div class="opts"><button class="ok" data-a="approve">Approve outreach</button>' +
        '<button data-a="save">Save to database only</button>' +
        '<button data-a="review">Needs review</button>' +
        '<button class="dnc" data-a="dnc">Do not contact</button></div>';
      const pkg = document.createElement('div');
      pkg.className = 'pkg';
      gate.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = btn.getAttribute('data-a');
          pkg.innerHTML = '';
          if (a === 'approve') {
            mountInboundPackage(pkg, c, d, read);
            toast('Outreach approved by Kyle');
          } else if (a === 'save') {
            pkg.appendChild(card('FUB contact record (database only)', esc(d.fubText), d.fubText, 'mono'));
            pkg.appendChild(card('Agent note', esc(d.note), d.note, 'mono'));
            pkg.appendChild(card('Outreach', '<span class="empty">Held per your choice. No call, text, or email action created.</span>'));
            const plan = prefillPlan({ note: d.note, recipient: c.email || '' }, ['note']);
            renderPrefill(pkg, plan, 'Writes the note only. Does not save or send. ');
            toast('Saved to database package only');
          } else if (a === 'review') {
            pkg.appendChild(card('Needs review before anything else', '<span class="miss">Verify: Assigned agent</span><span class="miss">Verify: Contact permission</span><span class="miss">Verify: Buyer/seller intent</span>'));
            toast('Marked needs review');
          } else {
            pkg.appendChild(card('Do not contact', '<span class="flag block">Marked DNC by Kyle. No package, no outreach, no task.</span>'));
            toast('Marked do not contact');
          }
        });
      });
      $('body').appendChild(gate);
      $('body').appendChild(pkg);
    } else {
      mountInboundPackage($('body'), c, d, read);
    }
    if (d.blocked || d.wrongAgent) setStatus('review', 'Needs Review · permission gated');
    else if (d.teamGate) setStatus('ready', 'Ready · permission gated');
    else if (d.automated || d.fromMe) setStatus('idle', d.automated ? 'Automated mail · no reply' : 'Waiting on them');
    else if (d.missing.length) setStatus('missing', 'Ready · ' + d.missing.length + ' field(s) missing');
    else setStatus('ready', 'Ready · ' + d.priority);
  }

  function getKey() { return chrome.storage.local.get('anthropic_key').then(o => o.anthropic_key || ''); }
  async function runApiMode(m, text) {
    const key = await getKey();
    if (!key) { $('settings').classList.remove('hidden'); setStatus('missing', 'Add your Anthropic API key first'); return; }
    setStatus('reading', 'Analyzing…');
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          messages: [{ role: 'user', content: MODE_PROMPTS[m] + '\n\nINPUT:\n' + text.slice(0, 100000) }]
        })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error.message || 'API error');
      let out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      clearBody();
      const blk = redfinEmailBlock(out);
      if (blk && /To:|recipient|send to/i.test(out)) {
        $('body').appendChild(card('Blocked', '<span class="flag block">' + esc(blk) + '</span>'));
      }
      $('body').appendChild(card(m.toUpperCase() + ' analysis', esc(out), out, 'mono'));
      $('body').appendChild(card('Approval gate', 'Worksheet and drafts only. Nothing here is submitted, saved, or sent by this agent.'));
      setStatus('ready', 'Ready · ' + m.toUpperCase());
    } catch (e) {
      setStatus('missing', 'Failed: ' + (e.message || e));
    }
  }

  const PASTE_MODES = { mls: 'Paste the MLS listing, search results, or subject property text', cma: 'Paste subject property plus comps (active, pending, closed)', onehome: 'Paste OneHome page text or describe the contact/search/alert to prepare', contract: 'Paste approved deal data: parties, price, deposits, dates, property' };

  function setMode(m, fromUser) {
    mode = m;
    document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.getAttribute('data-mode') === m));
    if (PASTE_MODES[m]) {
      pasteTarget = 'api';
      $('pasteWrap').classList.remove('hidden');
      $('pasteLabel').textContent = PASTE_MODES[m];
      $('paste').placeholder = 'Select all on the MLS / OneHome / contract page, copy, paste here.';
      message('Paste the page text above and run. DOM reading for this surface gets wired once Kyle shows the agent a live page.');
      setStatus('idle', m.toUpperCase() + ' mode · paste powered');
    } else {
      pasteTarget = null;
      $('pasteWrap').classList.add('hidden');
      if (fromUser) analyze();
    }
  }

  async function analyze() {
    if (PASTE_MODES[mode]) return;
    setStatus('reading', 'Reading page…');
    const read = await readPage();
    lastRead = read;
    if (read.pageType === 'off-domain') {
      message('This tab is not a supported page. Lead and Capture read Agent Tools. Gmail and Follow Up Boss open in Auto or Lead. MLS, CMA, OneHome, and Contract work by paste anywhere.');
      setStatus('idle', 'Unsupported tab');
      return;
    }
    if (read.pageType === 'no-reader') {
      message('Reader not loaded on this tab. Refresh the page once, then Analyze.');
      setStatus('idle', 'Reader not loaded');
      return;
    }

    const autoMap = {
      'customer-detail': 'lead',
      'expanded-row': 'lead',
      'appointments': 'capture',
      'team-dashboard': 'capture',
      'gmail-thread': 'inbox',
      'fub-contact': 'inbox',
      'gmail-list': 'inbox-list',
      'fub-list': 'inbox-list'
    };
    let effective = mode === 'auto' ? (autoMap[read.pageType] || null) : mode;
    if (mode === 'lead' && (read.pageType === 'gmail-thread' || read.pageType === 'fub-contact')) effective = 'inbox';
    if (mode === 'lead' && (read.pageType === 'gmail-list' || read.pageType === 'fub-list')) effective = 'inbox-list';

    if (effective === 'inbox') { renderInbound(read); return; }
    if (effective === 'inbox-list') {
      const which = read.pageType === 'gmail-list' ? 'Gmail thread' : 'Follow Up Boss person';
      message('List view. I do not blend contacts. Open one ' + which + ', then Analyze. Or paste one contact below.');
      showInboxPaste(read.pageType === 'fub-list' ? 'fub' : 'gmail');
      setStatus('idle', 'Open one contact');
      return;
    }
    if (effective === 'lead') {
      if (read.single && read.single.name) renderLead(read.single);
      else if (['homepage', 'customer-list', 'appointments', 'team-dashboard'].includes(read.pageType)) {
        message('Mixed list page. I do not blend contacts together. Expand one follow-up row or open a customer for Lead Mode, or switch to Capture for team pages.');
        setStatus('idle', 'Select a customer');
      } else { message('No customer detected. Open a customer detail page or expand a follow-up row, then Analyze.'); setStatus('missing', 'Nothing to read'); }
    } else if (effective === 'capture') {
      if (['appointments', 'team-dashboard'].includes(read.pageType) || (read.rows && read.rows.length)) renderCapture(read);
      else { message('Capture works on Team Dashboard, Appointments, New Tours, Unclaimed Offers/Listings, Agent Requests, and shared queues. Open one of those, then Analyze.'); setStatus('idle', 'Not a team surface'); }
    } else if (effective == null) {
      if (read.pageType === 'homepage' || read.pageType === 'customer-list') {
        message('Broad list page. Auto mode does not blend contacts. Expand a follow-up row, open a customer, or switch to Capture on a team surface.');
        setStatus('idle', 'Broad page · pick a target');
      } else { message('Page unclear. Select the customer or property on screen, or pick a mode and Analyze manually.'); setStatus('idle', 'Unclear page'); }
    }
  }

  document.querySelectorAll('#modes button').forEach(b =>
    b.addEventListener('click', () => setMode(b.getAttribute('data-mode'), true)));
  $('analyze').addEventListener('click', () => { if (PASTE_MODES[mode]) runApiMode(mode, $('paste').value.trim()); else analyze(); });
  $('runPaste').addEventListener('click', () => {
    const t = $('paste').value.trim();
    if (t.length < 40) { toast('Paste more of the page'); return; }
    if (pasteTarget === 'inbox') {
      renderInbound({
        pageType: inboxChannel === 'fub' ? 'fub-contact' : 'gmail-thread',
        single: contactFromPaste(t, inboxChannel),
        compose: { open: false, subjectEmpty: false, bodyEmpty: true }
      });
      return;
    }
    runApiMode(mode, t);
  });
  $('settingsBtn').addEventListener('click', () => $('settings').classList.toggle('hidden'));
  $('saveKey').addEventListener('click', () => {
    const v = $('apiKey').value.trim();
    if (v.indexOf('sk-ant') !== 0) { toast('Not an Anthropic key'); return; }
    chrome.storage.local.set({ anthropic_key: v }).then(() => { toast('Key saved'); $('settings').classList.add('hidden'); });
  });
  getKey().then(k => { if (k) $('apiKey').value = k; });

  let lastSig = null;
  async function tick() {
    if (mode !== 'auto' && mode !== 'lead') return;
    const read = await readPage();
    const watch = ['customer-detail', 'expanded-row', 'gmail-thread', 'fub-contact'];
    if (!read || watch.indexOf(read.pageType) < 0) { lastSig = null; return; }
    if (read.pageType === 'gmail-thread' || read.pageType === 'fub-contact') {
      const who = read.single && (read.single.email || read.single.name || read.single.subject) || '';
      const sig = read.pageType + ':' + who;
      if (sig !== lastSig && read.single && (read.single.name || read.single.email || read.single.body)) {
        lastSig = sig;
        renderInbound(read);
      }
      return;
    }
    const sig = read.pageType + ':' + (read.single && read.single.name || read.url);
    if (sig !== lastSig) { lastSig = sig; if (read.single && read.single.name) renderLead(read.single); }
  }
  setInterval(tick, 1500);
  chrome.tabs.onActivated.addListener(() => setTimeout(analyze, 300));

  analyze();
})();
