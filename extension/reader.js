/* Operating Agent — reader (content script). Classifies the visible page, extracts, prefills on approval. Never sends. */
(function () {
  const PHONE = /\(\d{3}\)\s?\d{3}-\d{4}/;
  const PHONE_LOOSE = /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/;
  const MLS = /\b[A-Z]\d{8,9}\b/;
  const PRICE = /\$[\d,]{4,}/;
  const EMAIL = /[\w.+-]+@[\w.-]+\.\w+/;
  const ADDRESS = /\d{1,6}\s+(?:[NSEW]{1,2}\s+)?[\w\s.]+?(?:St|Ave|Blvd|Dr|Rd|Ct|Ter|Ln|Pl|Way|Cir|Hwy)\b[^\n]{0,40}/i;
  const APPT_TYPES = /(New Tour|Unscheduled Tour|Scheduled Tour|Video Buyer Consult|Phone Buyer Consult|Buyer Consult|Listing Consult|On Market Check In|Attended Showing|Closing|Offer|Agent Scheduled|Not Confirmed|First call, no contact|Requested recently|Tour)/i;
  const REDFIN_BLOCK = 'Needs Review: Redfin internal email detected. Do not send through this agent.';

  const g = (t, re) => { const m = (t || '').match(re); return m ? (m[1] || m[0]).trim() : null; };

  function redfinEmailBlock(text) {
    if (!text) return null;
    return /@redfin\.com/i.test(text) ? REDFIN_BLOCK : null;
  }

  /* ---------- classify ---------- */
  function classify() {
    const host = location.hostname;
    if (host === 'mail.google.com') return classifyGmail();
    if (/(^|\.)followupboss\.com$/.test(host)) return classifyFub();
    const url = location.href, body = document.body.innerText;
    if (/\/tools\/customers\/\d+/.test(url)) return 'customer-detail';
    if (expandedRow()) return 'expanded-row';
    if (/\/tools\/appointments/.test(url) || /Show Results For[\s\S]{0,200}(New Tours|Unscheduled Tours)/i.test(body)) return 'appointments';
    if (/\/tools\/team/.test(url) || /Team Dashboard/i.test(body)) return 'team-dashboard';
    if (/\/tools\/customers\/?(\?|$)/.test(url) || /Current customers/i.test(body)) return 'customer-list';
    if (/Priority follow-ups|Today's Call List|Pipeline mining/i.test(body)) return 'homepage';
    return 'unknown';
  }

  function classifyGmail() {
    if (document.querySelector('h2.hP')) return 'gmail-thread';
    const hash = location.hash || '';
    if (/#[^/]+\/[A-Za-z0-9]{12,}/.test(hash) && !document.querySelector('tr.zA')) return 'gmail-thread';
    return 'gmail-list';
  }

  function looksLikePerson(n) {
    return !!n && n.length <= 60 && /^[A-Z][a-z]+(?:\s+[A-Z][a-zA-Z'-]+)+$/.test(n.trim());
  }

  function classifyFub() {
    const p = location.pathname || '';
    if (/\/people\/(view|show)\/\d+/.test(p)) return 'fub-contact';
    const h1 = document.querySelector('h1');
    const person = looksLikePerson(h1 ? h1.textContent : '');
    const touches = document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]').length;
    if (person && touches > 0 && touches <= 4) return 'fub-contact';
    return 'fub-list';
  }

  /* ---------- single-customer readers (proven on live account) ---------- */
  function expandedRow() {
    const rows = [...document.querySelectorAll('.Row.QueueItem, [class*="QueueItem"]')];
    return rows.find(r => /childrenShowing/.test(r.className) && r.getBoundingClientRect().height > 90) ||
           rows.find(r => /Mark as completed/i.test(r.innerText) && r.getBoundingClientRect().height > 90) || null;
  }

  function readQueueRow() {
    const row = expandedRow(); if (!row) return null;
    const nameEl = row.querySelector('.customerName') || row.querySelector('[class*="customerName"]');
    const name = nameEl ? nameEl.textContent.trim() : null;
    const lines = row.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    let status = null;
    const sw = /^(New|Active|Inactive|Pending|Closed|Under Contract|Nurture|Cold|Hot|Warm|Client)\b/i;
    for (const l of lines.slice(0, 4)) if (sw.test(l) && l.length < 24) { status = l.replace(/\s*-\s*$/, '').trim(); break; }
    const t = row.innerText;
    const tour = t.match(/First tour(?: on (\d{1,2}\/\d{1,2}\/\d{2,4}))?/i);
    const act = lines.find(l => /been on Redfin/i.test(l)) || null;
    let daysOn = null, windowDays = null, lastEvent = null;
    if (act) {
      const m = act.match(/Redfin (\d+) of the last (\d+) days/i);
      if (m) { daysOn = +m[1]; windowDays = +m[2]; }
      const e = act.match(/last event with Redfin was (?:on )?(.+?)\.?$/i);
      if (e) lastEvent = e[1].trim();
    }
    const kv = lab => { const i = lines.findIndex(l => l.toLowerCase() === lab.toLowerCase());
      if (i >= 0 && lines[i + 1] && !/^(Add|Buyer category|Seller category|Tags|Notes|Follow-up plan)$/i.test(lines[i + 1])) return lines[i + 1]; return null; };
    let tags = []; const ti = lines.findIndex(l => /^Tags$/i.test(l));
    if (ti >= 0) for (let j = ti + 1; j < lines.length; j++) { if (/^(Since|Last met me|Last on Redfin|Notes|Less|Show All)/i.test(lines[j])) break; tags.push(lines[j]); }
    let notes = []; const ni = lines.findIndex(l => /^Notes$/i.test(l));
    if (ni >= 0) for (let j = ni + 1; j < lines.length; j++) { if (/^(Less|Show All|Add)$/i.test(lines[j])) break; notes.push(lines[j]); }
    const notesText = notes.join('\n') || null;
    const asg = (notesText || '').match(/assign(?:ing|ed)?\s+to\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i);
    return {
      source: 'Queue / Follow-up', name, status,
      phone: g(t, PHONE), firstTour: tour ? (tour[1] || 'date not shown') : null,
      activityRaw: act, daysOn, windowDays, lastEvent,
      lastMet: kv('Last met me'), lastOnRedfin: kv('Last on Redfin'),
      followupPlan: (() => { const i = lines.findIndex(l => /^Follow-up plan$/i.test(l)); return (i >= 0 && lines[i + 1] && !/^Add$/i.test(lines[i + 1])) ? lines[i + 1] : null; })(),
      tags, leadSource: tags[0] || null, notesText,
      assigned: asg ? asg[1].trim() : null,
      noAgents: /no agents|never connected with anyone/i.test(notesText || '')
    };
  }

  function readDetail() {
    const t = document.body.innerText;
    const nameEl = document.querySelector('a.name') || document.querySelector('[class*="name"]');
    const act = g(t, /(This customer is [^\n]+)/) || g(t, /(This customer has [^\n]+)/);
    const fp = g(t, /Follow-up plan\s*\n?\s*([^\n]+)/);
    const tags = g(t, /Tags\s*\n?\s*([^\n]+)/);
    return {
      source: 'Customer Details',
      name: nameEl ? nameEl.textContent.trim() : null,
      status: /new to Redfin/i.test(act || '') ? 'New' : null,
      phone: g(t, PHONE), email: g(t, EMAIL),
      firstTour: null, activityRaw: act,
      daysOn: (m => m ? +m : null)(g(t, /Days on Redfin\s*\n?\s*(\d+)/)),
      windowDays: /last 28 days/i.test(t) ? 28 : null,
      events: (m => m ? +m : null)(g(t, /Events\s*\n?\s*(\d+)/)),
      emailsToYou: (m => m ? +m : null)(g(t, /Emails to you\s*\n?\s*(\d+)/)),
      lastMet: g(t, /(\d+ days? ago)\s*\n?\s*Last Met/i),
      lastEvent: null, lastOnRedfin: g(t, /([A-Za-z]{3} \d{1,2})\s*\n?\s*Last on Redfin/),
      followupPlan: (fp && !/^Add$/i.test(fp)) ? fp : null,
      tags: tags ? [tags] : [], leadSource: tags,
      notesText: null,
      assigned: g(t, /Buy-side\s*\n?\s*([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/) || g(t, /Sell-side\s*\n?\s*([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/),
      noAgents: false
    };
  }

  /* ---------- team dashboard counters ---------- */
  function readCounters() {
    const t = document.body.innerText, out = {};
    [['unclaimedOffersYou', /Unclaimed offers for you\s*\n?\s*(\d+)/i],
     ['customerRemindersYou', /Customer reminders for you\s*\n?\s*(\d+)/i],
     ['unclaimedOffersTeam', /Unclaimed offers for team\s*\n?\s*(\d+)/i],
     ['unclaimedListingsYou', /Unclaimed listings for you\s*\n?\s*(\d+)/i],
     ['unclaimedListingsTeam', /Unclaimed listings for team\s*\n?\s*(\d+)/i],
     ['newToursTeam', /New tours for team\s*\n?\s*(\d+)/i]
    ].forEach(([k, re]) => { const m = t.match(re); if (m) out[k] = +m[1]; });
    return out;
  }

  /* ---------- team/appointments row capture: ONE package per row, never blended ---------- */
  function readRows() {
    const cands = [...document.querySelectorAll('.Row, tr, [class*="AppointmentRow"], [class*="appointment-row"]')];
    const seen = new Set(), out = [];
    for (const r of cands) {
      if (r.querySelector('.Row, tr')) continue;
      const t = (r.innerText || '').trim();
      if (t.length < 20 || t.length > 2500) continue;
      if (!APPT_TYPES.test(t) && !PHONE.test(t) && !MLS.test(t)) continue;
      const nameEl = r.querySelector('.customerName, [class*="customerName"], a[href*="/tools/customers/"]');
      const name = nameEl ? nameEl.textContent.trim() : (t.split('\n').map(s => s.trim())
        .find(l => /^[A-Z][a-z]+ [A-Z][a-zA-Z'-]+$/.test(l)) || null);
      const key = (name || '') + '|' + (g(t, MLS) || '') + '|' + t.slice(0, 40);
      if (seen.has(key)) continue; seen.add(key);
      out.push({
        rawText: t.slice(0, 1200),
        name,
        phone: g(t, PHONE), email: g(t, EMAIL),
        apptType: g(t, APPT_TYPES),
        address: g(t, ADDRESS),
        mls: g(t, MLS), price: g(t, PRICE),
        datetime: g(t, /((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+at)?\s*\d{1,2}:\d{2}\s?(?:AM|PM)?/i) || g(t, /\d{1,2}\/\d{1,2}\/\d{2,4}/),
        scheduled: /Not Confirmed/i.test(t) ? 'Not confirmed' : /Unscheduled/i.test(t) ? 'Unscheduled' : /Scheduled/i.test(t) ? 'Scheduled' : /Confirmed/i.test(t) ? 'Confirmed' : null,
        idVerified: /ID verif/i.test(t) ? (/not verif/i.test(t) ? 'Not verified' : 'Verified') : null,
        preapproved: /pre-?approv/i.test(t) ? (/not pre-?approv/i.test(t) ? 'Not preapproved' : 'Preapproved') : null,
        assigned: g(t, /(?:Assigned(?: to)?|Agent)[:\s]+([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/) ,
        team: g(t, /Team[:\s]+([^\n]{2,40})/i)
      });
      if (out.length >= 40) break;
    }
    return out;
  }

  /* ---------- Gmail ---------- */
  function isKyle(person) {
    const email = ((person && person.email) || '').toLowerCase();
    const name = ((person && person.name) || '').toLowerCase();
    if (/kleinman/.test(email)) return true;
    return /kyle/.test(name) && /kleinman/.test(name);
  }

  function cleanPersonName(n) {
    if (!n) return null;
    const s = String(n).replace(/\s+via\s+.*/i, '').replace(/<[^>]+>/g, '').trim();
    if (!s || /@/.test(s) || s.length > 80) return null;
    return s;
  }

  function readGmailThread() {
    const subjectEl = document.querySelector('h2.hP');
    const subject = subjectEl ? subjectEl.textContent.trim() : null;
    const blocks = [...document.querySelectorAll('div.adn')];
    const source = blocks.length ? blocks : [...document.querySelectorAll('.gs')];
    const messages = [];
    source.forEach(adn => {
      if (messages.length >= 8) return;
      const senderEl = adn.querySelector('span.gD, [email]');
      const email = senderEl ? senderEl.getAttribute('email') : null;
      const name = senderEl ? (senderEl.getAttribute('name') || senderEl.textContent || '').trim() : null;
      const bodyEl = adn.querySelector('div.a3s');
      const snippetEl = adn.querySelector('.y2');
      const body = (bodyEl ? bodyEl.innerText : (snippetEl ? snippetEl.innerText : '')).trim();
      const dateEl = adn.querySelector('span.g3');
      const date = dateEl ? (dateEl.getAttribute('title') || dateEl.textContent || '').trim() : null;
      if (!email && !name && !body) return;
      messages.push({ name: name || null, email: email || null, date: date || null, body: body.slice(0, 2500) });
    });
    let inbound = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!isKyle(messages[i])) { inbound = messages[i]; break; }
    }
    const fromMe = !inbound && messages.length > 0;
    if (!inbound) inbound = messages[messages.length - 1] || null;
    const blob = messages.map(m => m.body).join('\n').slice(0, 8000);
    const phone = g(blob, PHONE) || g(blob, PHONE_LOOSE);
    const assigned = (blob.match(/assign(?:ing|ed)?\s+to\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/) || [])[1] || null;
    return {
      channel: 'gmail',
      source: 'Gmail',
      leadSource: null,
      name: cleanPersonName(inbound && inbound.name),
      email: inbound && inbound.email ? inbound.email : null,
      phone: phone,
      subject: subject,
      body: inbound ? inbound.body : '',
      date: inbound ? inbound.date : null,
      stage: null,
      assigned: assigned ? assigned.trim() : null,
      tags: [],
      address: g(blob, ADDRESS),
      mls: g(blob, MLS),
      price: g(blob, PRICE),
      fromMe: fromMe,
      messageCount: messages.length
    };
  }

  /* ---------- Follow Up Boss ---------- */
  function labelAfter(lines, labels) {
    for (let i = 0; i < lines.length; i++) {
      const key = lines[i].replace(/:$/, '');
      if (labels.some(lb => lb.toLowerCase() === key.toLowerCase()) && lines[i + 1] && lines[i + 1].length < 100) return lines[i + 1];
    }
    return null;
  }

  function pickEmail(text) {
    const links = [...document.querySelectorAll('a[href^="mailto:"]')].map(a => {
      try { return decodeURIComponent((a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]).trim(); }
      catch (e) { return ''; }
    }).filter(Boolean);
    const candidates = links.filter(e => !/no-?reply|noreply/i.test(e));
    const external = candidates.find(e => !/@redfin\.com$/i.test(e) && !/kleinman/i.test(e));
    if (external) return external;
    if (candidates[0]) return candidates[0];
    return g(text, EMAIL);
  }

  function readFubContact() {
    const t = document.body ? document.body.innerText : '';
    const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
    const h1 = document.querySelector('h1');
    let name = h1 ? h1.textContent.trim() : null;
    if (!looksLikePerson(name || '')) {
      name = lines.find(l => looksLikePerson(l)) || null;
    }
    const telEl = document.querySelector('a[href^="tel:"]');
    const phone = telEl ? (telEl.textContent.trim() || (telEl.getAttribute('href') || '').replace(/^tel:/i, '')) : (g(t, PHONE) || g(t, PHONE_LOOSE));
    const tagsLine = labelAfter(lines, ['Tags']);
    const assigned = labelAfter(lines, ['Assigned', 'Assigned To', 'Agent']) || g(t, /Assigned(?: to)?\s+([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/);
    return {
      channel: 'fub',
      source: 'Follow Up Boss',
      leadSource: labelAfter(lines, ['Source', 'Lead Source']),
      name: name,
      email: pickEmail(t),
      phone: phone || null,
      subject: null,
      body: labelAfter(lines, ['Background', 'Notes', 'Description']) || '',
      date: labelAfter(lines, ['Last Activity', 'Last Communication', 'Updated']),
      stage: labelAfter(lines, ['Stage', 'Pipeline', 'Status']),
      assigned: assigned ? assigned.trim() : null,
      tags: tagsLine ? tagsLine.split(/[,|]/).map(s => s.trim()).filter(Boolean) : [],
      address: g(t, ADDRESS),
      mls: g(t, MLS),
      price: g(t, PRICE),
      fromMe: false
    };
  }

  function readCompose() {
    const body = document.querySelector('div[aria-label="Message Body"], div[g_editable="true"]');
    const subject = document.querySelector('input[name="subjectbox"]');
    return {
      open: !!(body || subject),
      subjectEmpty: subject ? !String(subject.value || '').trim() : false,
      bodyEmpty: body ? !(body.innerText || '').trim() : false
    };
  }

  /* ---------- approval-gated prefill. Value writes only. Never clicks, submits, or sends. ---------- */
  function fieldBlob(el) {
    let label = '';
    if (el.id) {
      const esc = window.CSS && CSS.escape ? CSS.escape(el.id) : el.id.replace(/[^a-zA-Z0-9_-]/g, '');
      const l = esc ? document.querySelector('label[for="' + esc + '"]') : null;
      if (l) label = l.innerText || '';
    }
    const parentLabel = el.closest ? el.closest('label') : null;
    return [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id, label, parentLabel ? (parentLabel.innerText || '').slice(0, 80) : ''].filter(Boolean).join(' | ');
  }

  function skipField(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'password', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset'].indexOf(type) >= 0) return true;
    if (el.disabled) return true;
    return false;
  }

  function byHint(res) {
    if (!res || !res.length) return null;
    const nodes = document.querySelectorAll('input, textarea, [contenteditable="true"]');
    for (const el of nodes) {
      if (skipField(el)) continue;
      const blob = fieldBlob(el);
      if (/search mail|search people|^search\b/i.test(blob)) continue;
      if (res.some(r => r.test(blob))) return el;
    }
    return null;
  }

  function locate(key) {
    if (key === 'emailSubject') return document.querySelector('input[name="subjectbox"]') || byHint([/^subject$/i]);
    if (key === 'emailBody') return document.querySelector('div[aria-label="Message Body"]') || document.querySelector('[g_editable="true"]') || byHint([/message body/i]);
    if (key === 'recipient') return document.querySelector('input[aria-label^="To"]') || document.querySelector('textarea[name="to"]');
    const hints = {
      note: [/\bnotes?\b/i, /add a note/i, /\bcomment\b/i],
      sms: [/\bsms\b/i, /text message/i],
      task: [/^task$/i, /task name/i, /task description/i],
      phone: [/^phone$/i, /\bmobile\b/i, /\bcell\b/i],
      email: [/^e-?mail$/i],
      name: [/^full name$/i, /^name$/i]
    };
    return byHint(hints[key] || []);
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function writeField(el, key, value) {
    const editable = el.getAttribute('contenteditable') === 'true' || el.isContentEditable;
    const isField = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
    if (!editable && !isField) return 'miss';
    if (editable) {
      const current = el.innerText || '';
      if (key === 'emailBody') {
        if (value && current.indexOf(value.slice(0, Math.min(40, value.length))) !== -1) return 'already';
        el.focus();
        try {
          const sel = window.getSelection();
          if (sel && document.createRange) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (e) { /* caret placement is best effort */ }
        const block = value + '\n\n';
        const inserted = document.execCommand && document.execCommand('insertText', false, block);
        if (!inserted) {
          el.innerText = block + current;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return 'filled';
      }
      if (current.trim()) return 'occupied';
      el.focus();
      const inserted = document.execCommand && document.execCommand('insertText', false, value);
      if (!inserted) {
        el.innerText = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return 'filled';
    }
    if (el.value && String(el.value).trim()) return 'occupied';
    setNativeValue(el, value);
    return 'filled';
  }

  function applyPrefill(fields) {
    const out = { filled: [], missed: [], blocked: [], occupied: [], already: [] };
    (fields || []).forEach(f => {
      if (!f || !f.key) return;
      const value = f.value == null ? '' : String(f.value);
      if (!value.trim()) {
        out.missed.push({ key: f.key, reason: 'Nothing to write for ' + f.key });
        return;
      }
      const emailish = f.key === 'recipient' || f.key === 'email' || f.key === 'emailBody' || f.key === 'emailSubject' || f.key === 'sms';
      if (emailish && redfinEmailBlock(value)) {
        out.blocked.push({ key: f.key, reason: REDFIN_BLOCK });
        return;
      }
      const el = locate(f.key);
      if (!el) {
        out.missed.push({ key: f.key, reason: 'No ' + f.key + ' field on this page. Open it, then Approve prefill again.' });
        return;
      }
      const status = writeField(el, f.key, value);
      if (status === 'filled') out.filled.push(f.key);
      else if (status === 'occupied') out.occupied.push(f.key);
      else if (status === 'already') out.already.push(f.key);
      else out.missed.push({ key: f.key, reason: 'Could not write ' + f.key });
    });
    return out;
  }

  function buildRead() {
    const pageType = classify();
    const payload = {
      pageType: pageType,
      url: location.href,
      counters: {},
      single: null,
      rows: [],
      compose: { open: false, subjectEmpty: false, bodyEmpty: false },
      noteVisible: false
    };
    try {
      if (pageType === 'customer-detail') payload.single = readDetail();
      else if (pageType === 'expanded-row') payload.single = readQueueRow();
      else if (pageType === 'appointments' || pageType === 'team-dashboard') {
        payload.counters = readCounters();
        payload.rows = readRows();
      } else if (pageType === 'gmail-thread') {
        payload.single = readGmailThread();
        payload.compose = readCompose();
      } else if (pageType === 'fub-contact') payload.single = readFubContact();
      else if (pageType === 'gmail-list') payload.listCount = document.querySelectorAll('tr.zA').length;
      payload.noteVisible = !!locate('note');
    } catch (e) { payload.error = String(e && e.message || e); }
    return payload;
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (!msg || (msg.cmd !== 'READ' && msg.cmd !== 'PREFILL')) return;
    try {
      if (msg.cmd === 'READ') send(buildRead());
      else send(applyPrefill(msg.fields || []));
    } catch (e) {
      send({ error: String(e && e.message || e), pageType: 'unknown', filled: [], missed: [], blocked: [], occupied: [], already: [] });
    }
    return true;
  });
})();
