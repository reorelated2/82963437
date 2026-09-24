/* Operating Agent — brains. Deterministic first, generative second. Never invents. */
const ME = 'Kyle Kleinman';
const REDFIN_BLOCK = 'Needs Review: Redfin internal email detected. Do not send through this agent.';

/* ---------- HARD EMAIL RULE: applies everywhere, forever ---------- */
function redfinEmailBlock(text) {
  if (!text) return null;
  return /@redfin\.com/i.test(text) ? REDFIN_BLOCK : null;
}

function isAutomatedMail(email, subject, body) {
  const head = (subject || '') + '\n' + (body || '').slice(0, 900);
  if (/no-?reply|noreply|notifications?@|mailer-daemon|donotreply|do-not-reply|bounce/i.test(email || '')) return true;
  if (/\bunsubscribe\b|this (?:message|email) was sent automatically|do not reply to this/i.test(head)) return true;
  return false;
}

function isSharedSource(source, tags) {
  const blob = ((source || '') + ' ' + (Array.isArray(tags) ? tags.join(' ') : (tags || ''))).toLowerCase();
  return /team|shared|redfin|zillow|realtor|opcity|boldtrail|ylopo|kvcore|agent tools/.test(blob);
}

function firstName(name) {
  const n = (name || '').trim().split(/\s+/)[0];
  return n && !/^(unknown|missing|there)$/i.test(n) ? n : 'there';
}

function replySubject(subject) {
  if (!subject) return 'Following up';
  return 'Re: ' + String(subject).replace(/^(re:\s*)+/i, '').trim();
}

/* ---------- LEAD BRAIN (ported from validated engine) ---------- */
function leadDecide(c) {
  const missing = [];
  if (!c.name) missing.push('Customer name');
  if (!c.status) missing.push('Customer status');
  if (!c.phone) missing.push('Phone / contact');
  if (!c.assigned) missing.push('Assigned agent');
  if (c.followupPlan == null) missing.push('Follow-up plan');

  const flags = []; let wrongAgent = false;
  if (c.assigned && c.assigned.toLowerCase().split(' ')[0] !== ME.toLowerCase().split(' ')[0]) {
    wrongAgent = true;
    flags.push({ type: 'rev', text: 'Wrong agent? Assigned to "' + c.assigned + '", not ' + ME + '. Needs Review before you work it.' });
  }
  if (c.lastMet && /(\d+)\s+(day|week|month)/i.test(c.lastMet)) {
    const m = c.lastMet.match(/(\d+)\s+(day|week|month)/i); let d = +m[1];
    if (m[2].startsWith('week')) d *= 7; if (m[2].startsWith('month')) d *= 30;
    if (d >= 30) flags.push({ type: '', text: 'No contact in ~' + d + ' days (last met: ' + c.lastMet + ').' });
  }
  let hot = false;
  if (c.daysOn != null && c.windowDays && c.daysOn / c.windowDays >= 0.5) { hot = true; flags.push({ type: '', text: 'High activity: on Redfin ' + c.daysOn + '/' + c.windowDays + ' days.' }); }
  if (c.lastEvent && /hour|today|minute/i.test(c.lastEvent)) hot = true;
  if (c.noAgents) flags.push({ type: '', text: 'Never connected with anyone at Redfin. First human touch.' });
  if (c.emailsToYou === 0 && c.events > 0) flags.push({ type: '', text: 'Browsing but no replies to you yet (' + c.events + ' events, 0 emails to you).' });

  let s, pr, next, click, reason, dispo, remind = 3;
  const isNew = /new/i.test(c.status || ''), toured = !!c.firstTour;
  if (wrongAgent) { s = 'wrong-agent'; pr = 'Needs Review'; next = 'Confirm ownership before contacting.'; click = 'None yet. Resolve assignment first.'; reason = 'Card looks assigned to ' + c.assigned + '.'; dispo = 'Needs Review'; }
  else if (missing.includes('Phone / contact') && isNew) { s = 'incomplete'; pr = 'Medium'; next = 'Find the contact number before outreach.'; click = 'Open customer detail to capture contact info.'; reason = 'New lead, no usable phone visible.'; dispo = 'Pending info'; }
  else if (hot && c.lastEvent && /hour|today|minute/i.test(c.lastEvent)) { s = 'recent-event'; pr = 'High'; next = 'Call now while they are active. Reference their recent search.'; click = 'Click "Call". Set disposition after you connect.'; reason = 'Active right now (' + c.lastEvent + ').'; dispo = 'Attempted / Connected (set after call)'; }
  else if (isNew && toured) { s = 'toured-new'; pr = 'High'; next = 'Call to follow up on their ' + (c.firstTour !== 'date not shown' ? c.firstTour + ' ' : '') + 'tour.'; click = 'Click "Call". No answer, send the SMS, remind in 2 days.'; reason = 'Toured once, new, no next step. Fast follow-up converts.'; dispo = 'Attempted (set after call)'; remind = 2; }
  else if (toured) { s = 'toured-stale'; pr = 'Medium'; next = 'Light re-engage on the home they toured.'; click = 'Send the SMS or click "Call". No reply, remind in 3 days.'; reason = 'Toured once and went quiet.'; dispo = 'Attempted (set after outreach)'; }
  else if (isNew && hot) { s = 'new-active'; pr = 'High'; next = 'Intro call now. Short. Offer tours.'; click = 'Click "Call" or send the SMS.'; reason = 'New and already browsing hard.'; dispo = 'Attempted (set after outreach)'; remind = 2; }
  else if (isNew) { s = 'new-intro'; pr = 'Medium'; next = 'Short intro. Ask what they are looking for.'; click = 'Send the SMS or click "Call".'; reason = 'New lead, no signal yet.'; dispo = 'Attempted (set after outreach)'; }
  else if (hot) { s = 'active-no-tour'; pr = 'High'; next = 'Offer to set up tours. They are browsing a lot.'; click = 'Click "Call" or send the SMS.'; reason = 'Strong search activity, no tour yet.'; dispo = 'Attempted (set after outreach)'; }
  else if (!c.activityRaw && !c.lastEvent) { s = 'no-activity'; pr = 'Low'; next = 'Light touch or none. Set a reminder.'; click = 'Add a reminder. No hard outreach.'; reason = 'No recent activity to justify live outreach.'; dispo = 'No action needed'; remind = 7; }
  else { s = 'default'; pr = 'Medium'; next = 'Quick check-in to keep it warm.'; click = 'Send the SMS or click "Call".'; reason = 'Standard cadence.'; dispo = 'Attempted (set after outreach)'; }
  return { missing, flags, scenario: s, priority: pr, nextAction: next, recClick: click, reason, disposition: dispo, reminderDays: remind, wrongAgent, hot };
}

function leadContent(c, d) {
  const fn = (c.name || 'there').trim().split(/\s+/)[0];
  const note = ['Next: ' + d.nextAction.replace(/\.$/, '') + '.',
    (c.firstTour && c.firstTour !== 'date not shown') ? 'Toured ' + c.firstTour + '.' : '',
    c.lastMet ? 'Last met ' + c.lastMet + '.' : '',
    d.wrongAgent ? 'Check assignment: shows ' + c.assigned + '.' : ''].filter(Boolean).join(' ');
  const task = d.scenario === 'no-activity'
    ? 'Reminder: light check-in with ' + fn + ' in ' + d.reminderDays + ' days.'
    : 'Follow up with ' + fn + '. Set reminder ' + d.reminderDays + ' days out.';
  let sms = null;
  if (!d.wrongAgent) {
    if (d.scenario === 'toured-new' || d.scenario === 'toured-stale') sms = 'Hey ' + fn + ", it's Kyle w/ Redfin. What'd you think of the place you toured? Happy to line up a couple more if you want to keep looking.";
    else if (['recent-event', 'active-no-tour', 'new-active'].includes(d.scenario)) sms = 'Hey ' + fn + ", Kyle w/ Redfin. Saw you've been looking around. Want me to set up a few tours this week?";
    else if (d.scenario === 'new-intro') sms = 'Hey ' + fn + ", it's Kyle, your Redfin agent. What area and price range are you looking in? Happy to send options and set up tours.";
    else if (d.scenario === 'no-activity') sms = 'Hey ' + fn + ', Kyle w/ Redfin checking in. Still in the market, or should I give you some space for now?';
    else sms = 'Hey ' + fn + ", it's Kyle w/ Redfin. Anything I can help you look at?";
  }
  let email = null;
  if (!c.phone || ['no-activity', 'toured-stale', 'new-intro'].includes(d.scenario)) {
    const tl = (c.firstTour && c.firstTour !== 'date not shown') ? ' Following up on the home you toured on ' + c.firstTour + '.' : '';
    email = { subject: 'Quick follow-up, ' + fn, body: 'Hi ' + fn + ',\n\nKyle with Redfin here.' + tl + ' Wanted to see where your head is at.\n\nIf you want to keep looking, I can pull a few options that fit and get tours on the calendar. If now is not the time, just say so and I will check back later.\n\nKyle Kleinman' };
  }
  const block = redfinEmailBlock(c.email || '');
  if (block) email = null;
  const callReason = d.wrongAgent ? 'Do not call yet. Confirm assignment.'
    : c.firstTour ? 'Follow up on the tour and set next steps.'
    : c.lastEvent ? 'They were active (' + c.lastEvent + '). Reference their search, offer tours.'
    : 'Check in and gauge where they are.';
  return { note, task, sms, email, callReason, emailBlocked: block };
}

/* ---------- CAPTURE BRAIN: one FUB package per row, permission gated ---------- */
function classifyRow(r) {
  const t = (r.rawText || '') + ' ' + (r.apptType || '');
  if (/Listing Consult/i.test(t)) return 'Seller listing consult';
  if (/Buyer Consult/i.test(t)) return 'Buyer consult';
  if (/Closing/i.test(t)) return 'Closing related';
  if (/Offer/i.test(t)) return 'Buyer tour';
  if (/Tour/i.test(t)) return 'Buyer tour';
  if (/rent|lease|tenant/i.test(t)) return 'Rental opportunity';
  if (/invest/i.test(t)) return 'Investor opportunity';
  return 'Unknown';
}

function buildCapture(r) {
  const cls = classifyRow(r);
  const missing = [];
  if (!r.name) missing.push('Customer name');
  if (!r.phone && !r.email) missing.push('Phone/email not visible from list view. Open appointment/customer detail to capture contact info.');
  if (!r.apptType) missing.push('Appointment type');
  if (cls === 'Unknown') missing.push('Buyer/seller intent unclear. Confirm with Kyle.');

  const flags = [];
  let ownership = 'unclear';
  if (r.assigned) {
    if (r.assigned.toLowerCase().split(' ')[0] === ME.toLowerCase().split(' ')[0]) ownership = 'kyle';
    else { ownership = 'other'; flags.push({ type: 'rev', text: 'Needs Review: Lead ownership unclear. Assigned shows "' + r.assigned + '". Do not contact until Kyle confirms permission.' }); }
  } else {
    flags.push({ type: 'rev', text: 'Needs Review: Lead ownership unclear. No assigned agent visible. Do not contact until Kyle confirms permission.' });
  }
  const eb = redfinEmailBlock(r.email || '');
  if (eb) flags.push({ type: 'block', text: eb });

  const fub = {
    'FUB name': r.name || 'MISSING',
    'FUB phone': r.phone || 'MISSING',
    'FUB email': eb ? 'BLOCKED (internal)' : (r.email || 'MISSING'),
    'Lead type': cls,
    'Lead source': 'Redfin Agent Tools (team/shared queue)',
    'Pipeline stage': /Consult/i.test(cls) ? 'Consult scheduled' : /tour/i.test(cls) ? 'Touring' : 'New',
    'Assigned agent': ME,
    'Tags': ['agent-tools-capture', (r.apptType || '').toLowerCase().replace(/\s+/g, '-'), (r.mls ? 'mls-' + r.mls : '')].filter(Boolean).join(', '),
    'Property address': r.address || null,
    'MLS number': r.mls || null,
    'Budget / price point': r.price || null,
    'Timeline': r.datetime || null,
    'Status': r.scheduled || null,
    'ID verification': r.idVerified || null,
    'Preapproval': r.preapproved || null,
    'Last activity': r.datetime || null
  };
  const fubText = Object.entries(fub).filter(([, v]) => v).map(([k, v]) => k + ': ' + v).join('\n');
  const fn = (r.name || 'there').split(/\s+/)[0];
  const note = [cls + '.', r.apptType ? r.apptType + (r.datetime ? ' on ' + r.datetime : '') + '.' : '',
    r.address ? 'Property: ' + r.address + (r.mls ? ' (MLS ' + r.mls + ')' : '') + (r.price ? ', ' + r.price : '') + '.' : '',
    'Source: team/shared Agent Tools queue. Owner: ' + (r.assigned || 'not shown') + '.'].filter(Boolean).join(' ');
  const task = 'Verify ownership/permission, then first touch with ' + fn + '. Reminder 2 days out.';
  const sms = 'Hey ' + fn + ", it's Kyle w/ Redfin. I saw your " + (r.apptType ? r.apptType.toLowerCase() : 'request') + (r.address ? ' for ' + r.address : '') + '. Want me to get that locked in for you?';
  const nextClick = !r.phone && !r.email ? 'Open appointment row, then open customer detail to capture contact info.'
    : ownership !== 'kyle' ? 'Open appointment details to confirm owner agent before anything else.'
    : 'Open customer detail and confirm the ' + (r.apptType || 'appointment') + ' is set.';

  return { cls, missing, flags, ownership, fub, fubText, note, task, sms, nextClick, emailBlocked: !!eb };
}

/* ---------- GMAIL / FUB LEAD PARSER ---------- */
function contactFromPaste(text, channel) {
  const raw = String(text || '');
  const from = raw.match(/^From:\s*(.+)$/im);
  let name = from ? from[1].replace(/<[^>]+>/g, '').trim() : null;
  if (name && /@/.test(name)) name = null;
  const emailMatch = raw.match(/[\w.+-]+@[\w.-]+\.\w+/);
  const email = emailMatch ? emailMatch[0] : null;
  const phoneMatch = raw.match(/\(\d{3}\)\s?\d{3}-\d{4}/) || raw.match(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/);
  const subject = (raw.match(/^Subject:\s*(.+)$/im) || [])[1] || null;
  const leadSource = (raw.match(/^Source:\s*(.+)$/im) || [])[1] || null;
  const assigned = (raw.match(/^Assigned(?:\s+to)?:\s*(.+)$/im) || [])[1] || null;
  const stage = (raw.match(/^Stage:\s*(.+)$/im) || [])[1] || null;
  const ch = channel === 'fub' ? 'fub' : 'gmail';
  return {
    channel: ch,
    source: 'Paste',
    leadSource: leadSource ? leadSource.trim() : null,
    name: name,
    email: email,
    phone: phoneMatch ? phoneMatch[0] : null,
    subject: subject ? subject.trim() : null,
    body: raw.slice(0, 4000),
    date: null,
    stage: stage ? stage.trim() : null,
    assigned: assigned ? assigned.trim() : null,
    tags: [],
    address: null,
    mls: null,
    price: null,
    fromMe: false
  };
}

function inboundDecide(c) {
  const missing = [];
  if (!c.name) missing.push('Customer name');
  if (!c.phone && !c.email) missing.push('Phone or email');
  if (c.channel === 'gmail' && !c.subject) missing.push('Subject');
  if (c.channel === 'fub' && !c.stage) missing.push('Pipeline stage');

  const flags = [];
  const block = redfinEmailBlock(c.email || '');
  if (block) flags.push({ type: 'block', text: block });

  const automated = !block && isAutomatedMail(c.email, c.subject, c.body);
  if (automated) flags.push({ type: '', text: 'Looks automated (noreply or unsubscribe). Not a live lead.' });

  let wrongAgent = false;
  if (!block && !automated && c.assigned) {
    const first = c.assigned.toLowerCase().split(/\s+/)[0];
    if (first !== 'kyle') {
      wrongAgent = true;
      flags.push({ type: 'rev', text: 'Needs Review: Lead ownership unclear. Assigned shows "' + c.assigned + '". Do not contact until Kyle confirms permission.' });
    }
  } else if (!block && !automated && c.channel === 'fub' && !c.assigned) {
    flags.push({ type: 'rev', text: 'Needs Review: Lead ownership unclear. No assigned agent visible. Do not contact until Kyle confirms permission.' });
  }

  const fromMe = !!c.fromMe && !block;
  if (fromMe) flags.push({ type: '', text: 'Latest visible message is from Kyle. Wait for their reply.' });

  const text = [(c.subject || ''), (c.body || ''), (c.stage || ''), (c.leadSource || '')].join('\n');
  const seller = /sell(?:ing)? (?:my|our|the) (?:house|home)|listing consult|what(?:'s| is) my home worth|list my (?:house|home)|seller/i.test(text);
  const tour = /\btour\b|\bshowing\b|see the (?:home|house|property)|schedule a visit/i.test(text);
  const buyer = /pre-?approv|buying|looking (?:for|to buy)|bedroom|\bbudget\b|\$[\d,]{4,}/i.test(text);
  let intent = 'unclear';
  if (seller && buyer) intent = 'both';
  else if (seller) intent = 'seller';
  else if (tour || buyer) intent = 'buyer';
  if (intent === 'unclear' && !automated && !block && !fromMe) missing.push('Buyer/seller intent unclear. Confirm with Kyle.');

  const shared = isSharedSource(c.leadSource, c.tags);
  const neverOutreach = !!block || automated || fromMe;
  const teamGate = !neverOutreach && (wrongAgent || shared || (c.channel === 'fub' && !c.assigned));

  const urgent = /today|asap|this week|ready to (?:make an offer|write|tour)/i.test(text);
  let priority = 'Medium';
  let next = 'Read it and decide the next touch.';
  let click = 'Review the draft. Nothing is sent until you send it.';
  let reason = c.channel === 'gmail' ? 'Inbound Gmail.' : 'Follow Up Boss contact.';

  if (block) {
    priority = 'Needs Review';
    next = 'Do not email this address.';
    click = 'Stop. Redfin internal email is blocked in every mode.';
    reason = 'Contact email is an @redfin.com address.';
  } else if (automated) {
    priority = 'Low';
    next = 'No reply. Archive or ignore.';
    click = 'No click. This is not a person waiting on you.';
    reason = 'Automated sender.';
  } else if (fromMe) {
    priority = 'Low';
    next = 'Wait for their reply.';
    click = 'No outreach. The last visible message is yours.';
    reason = 'Thread is waiting on them.';
  } else if (wrongAgent || (c.channel === 'fub' && !c.assigned)) {
    priority = 'Needs Review';
    next = 'Confirm ownership before contacting.';
    click = 'Use the permission gate. Nothing goes out until you approve this contact.';
    reason = c.assigned ? 'Assigned to ' + c.assigned + '.' : 'No assigned agent visible.';
  } else if (c.channel === 'fub' && shared) {
    priority = urgent || tour ? 'High' : 'Medium';
    next = 'Team or shared source. Approve this contact before any outreach.';
    click = 'Use the permission gate. Approve outreach, save only, review, or do not contact.';
    reason = 'Source looks shared (' + (c.leadSource || 'tags') + ').';
  } else if (tour || urgent) {
    priority = 'High';
    next = seller && !tour ? 'Reply today about selling.' : 'Reply now and offer a tour time.';
    click = c.channel === 'gmail' ? 'Click Reply. Then Approve prefill. You send it.' : 'Call or text. Approve prefill only writes the note.';
    reason = urgent ? 'They used urgent timing.' : 'They asked about a tour or showing.';
  } else if (seller) {
    priority = 'High';
    next = 'Reply with a short offer to price the home and walk it.';
    click = c.channel === 'gmail' ? 'Click Reply. Then Approve prefill. You send it.' : 'Open the note, then Approve prefill if you want it written in.';
    reason = 'Seller intent.';
  } else if (buyer) {
    priority = 'Medium';
    next = 'Reply. Ask area, budget, and timing. Offer tours.';
    click = c.channel === 'gmail' ? 'Click Reply. Then Approve prefill. You send it.' : 'Approve prefill to write the note. You save it.';
    reason = 'Buyer intent.';
  } else {
    next = 'Short reply asking what they need.';
    click = c.channel === 'gmail' ? 'Click Reply. Then Approve prefill. You send it.' : 'Approve prefill to write the note. You save it.';
    reason = 'Real person, intent not clear yet.';
  }

  const fn = firstName(c.name);
  const note = [
    c.channel === 'gmail' ? 'Gmail.' : 'Follow Up Boss.',
    c.subject ? 'Subject: ' + c.subject + '.' : '',
    intent !== 'unclear' ? 'Intent: ' + intent + '.' : 'Intent unclear.',
    c.address ? 'Property: ' + c.address + '.' : '',
    c.leadSource ? 'Source: ' + c.leadSource + '.' : '',
    'Next: ' + next.replace(/\.$/, '') + '.'
  ].filter(Boolean).join(' ');
  const task = neverOutreach
    ? 'Review only. Do not contact ' + fn + ' until this is cleared.'
    : 'Follow up with ' + fn + '. Set reminder 2 days out.';

  let sms = null;
  let email = null;
  if (!neverOutreach) {
    if (tour) sms = "Hey " + fn + ", it's Kyle w/ Redfin. Got your note. Want me to set up a tour this week?";
    else if (seller) sms = "Hey " + fn + ", it's Kyle w/ Redfin. I can take a look and talk through pricing. Want to set a time?";
    else sms = "Hey " + fn + ", it's Kyle w/ Redfin. What are you looking to do? I can help with tours or a pricing talk.";
    const prop = c.address ? ' about ' + c.address : '';
    let body;
    if (tour) body = 'Hi ' + fn + ',\n\nKyle with Redfin. I got your note' + prop + '.\n\nI can set up a tour this week and send a couple other options if you want them. What time works?\n\nKyle Kleinman';
    else if (seller) body = 'Hi ' + fn + ',\n\nKyle with Redfin. I can pull a pricing range and walk the house with you.\n\nWant me to set a time for a quick look?\n\nKyle Kleinman';
    else body = 'Hi ' + fn + ',\n\nKyle with Redfin. I got your message' + prop + '.\n\nTell me the area, the budget, and whether you are buying, selling, or both. I will take it from there.\n\nKyle Kleinman';
    email = { subject: replySubject(c.subject), body: body };
  }

  const fub = {
    'FUB name': c.name || 'MISSING',
    'FUB phone': c.phone || 'MISSING',
    'FUB email': block ? 'BLOCKED (internal)' : (c.email || 'MISSING'),
    'Lead type': intent === 'seller' ? 'Seller' : intent === 'buyer' ? 'Buyer' : intent === 'both' ? 'Buyer and seller' : 'Unknown',
    'Lead source': c.channel === 'gmail' ? (c.leadSource || 'Gmail') : (c.leadSource || 'Follow Up Boss'),
    'Pipeline stage': c.stage || (tour ? 'Tour requested' : 'New'),
    'Assigned agent': ME,
    'Property address': c.address || null,
    'MLS number': c.mls || null,
    'Budget / price point': c.price || null,
    'Last activity': c.date || null
  };
  const fubText = Object.entries(fub).filter(([, v]) => v).map(([k, v]) => k + ': ' + v).join('\n');

  return {
    missing, flags, priority, nextAction: next, recClick: click, reason, intent,
    sms, email, note, task, fubText, teamGate, blocked: !!block, automated, fromMe, wrongAgent
  };
}

/* Fields the page writer is allowed to touch. Recipient is off unless explicitly included, and @redfin.com is never written. */
function prefillPlan(drafts, allow) {
  const allowed = new Set(allow || ['note', 'task', 'sms', 'emailSubject', 'emailBody']);
  const fields = [];
  const blocked = [];
  const recipient = drafts.recipient || '';
  const recipientBlocked = !!redfinEmailBlock(recipient);
  const catalog = [
    ['note', 'Note', drafts.note],
    ['task', 'Task', drafts.task],
    ['sms', 'Text message', drafts.sms],
    ['emailSubject', 'Email subject', drafts.emailSubject],
    ['emailBody', 'Email body', drafts.emailBody],
    ['recipient', 'To', drafts.includeRecipient ? recipient : ''],
    ['name', 'Name', drafts.name],
    ['phone', 'Phone', drafts.phone],
    ['email', 'Email', drafts.contactEmail]
  ];
  catalog.forEach(function (row) {
    const key = row[0], label = row[1], value = row[2];
    if (!allowed.has(key) || !value) return;
    const emailish = key === 'recipient' || key === 'email' || key === 'emailBody' || key === 'emailSubject' || key === 'sms';
    if ((recipientBlocked && emailish) || ((key === 'recipient' || key === 'email') && redfinEmailBlock(value)) || (emailish && redfinEmailBlock(value))) {
      blocked.push({ key: key, reason: REDFIN_BLOCK });
      return;
    }
    fields.push({ key: key, label: label, value: value });
  });
  return { fields: fields, blocked: blocked };
}

/* ---------- API MODE PROMPTS (deterministic frames, generative fill) ---------- */
const STYLE = 'Voice: Kyle Kleinman, Miami Redfin lead agent, license SL3227593. Short. Human. Direct. No AI voice, no fluff, no corporate language, no dashes or hyphens in client-facing copy. Everything paste-ready. Never invent data not in the input; write MISSING where absent. Never draft anything addressed to an @redfin.com email; if one appears, output exactly: Needs Review: Redfin internal email detected. Do not send through this agent.';

const MODE_PROMPTS = {
  mls: STYLE + '\nYou are reading pasted MLS listing or search text. Extract: address, MLS number, status, list price, sold price, beds, baths, living area, lot size, year built, DOM/CDOM, HOA/maintenance, taxes, property type, subdivision, waterfront, parking, pets, rental restrictions, association approval, remarks, broker remarks, showing instructions, price history, listing agent, listing office. Then output sections titled exactly: MLS SUMMARY, CLIENT TAKE, AGENT TAKE, PROS, CONS, RED FLAGS, QUESTIONS FOR LISTING AGENT, SHOWING PREP, VALUE OPINION, OFFER RANGE, COMPS SUPPORT, INVESTOR/RENTAL NOTES, CLIENT TEXT, CLIENT EMAIL, AGENT NOTE, CONFIDENCE LEVEL, MISSING INFO.',
  cma: STYLE + '\nYou are reading pasted comp data (active, pending, closed, expired, withdrawn). Compare price, price per sq ft, DOM, close date, list to sale ratio, condition, building, floor, view, parking, HOA, upgrades, lot size, concessions. Weight most recent sales highest, same building first, same subdivision second, same zip third. Output sections: BEST COMPS (with why each matters), WEAK COMPS (why not), OUTLIERS, VALUE RANGE, SELLER PRICING STRATEGY (suggested list, likely range, aggressive, safe, pricing risk), BUYER OFFER STRATEGY, SELLER TALKING POINTS, MISSING INFO.',
  onehome: STYLE + '\nYou are helping Kyle work OneHome. From the pasted text or request, prepare: CONTACT FIELDS (ready to type into OneHome contact creation), SEARCH CRITERIA (cleaned filters), SAVED SEARCH SETUP, LISTING ALERT SETUP, LISTING COLLECTION (which properties to send, which to skip, why), PORTAL NOTE (client-facing), CLICK GUIDE (exact steps in order). End with: APPROVAL REQUIRED before anything is created or saved in OneHome.',
  contract: STYLE + '\nYou are preparing a Florida AS IS Residential Contract worksheet from pasted deal data. This is a worksheet, not legal advice. Output sections: PARTIES (buyer names, seller names), PROPERTY (address, legal description), TERMS (purchase price, initial deposit, additional deposit, escrow agent, financing terms, loan type, inspection period, closing date, occupancy), CHECKLISTS (addendum, condo rider, HOA rider, lead based paint if pre-1978, seller disclosure), FLAGS (HOA/condo application, appraisal, special assessment, short sale/REO, foreign buyer SB-264, FIRPTA if seller may be foreign), TITLE/CLOSING AGENT, DEADLINE SUMMARY, NEGOTIATION STRATEGY, DOCUSIGN PREP CHECKLIST, MISSING INFO, PASTE READY LANGUAGE. Mark every field not present in the input as MISSING.'
};
