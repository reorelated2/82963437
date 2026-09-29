const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'brains.js'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(code + `
this.api = {
  redfinEmailBlock, leadDecide, leadContent, buildCapture,
  inboundDecide, prefillPlan, isSharedSource, isAutomatedMail,
  contactFromPaste, MODE_PROMPTS, REDFIN_BLOCK
};
`, sandbox);
const api = sandbox.api;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  }
}

const BLOCK = 'Needs Review: Redfin internal email detected. Do not send through this agent.';

assert(api.redfinEmailBlock('agent@redfin.com') === BLOCK, 'blocks redfin email');
assert(api.redfinEmailBlock('Agent@Redfin.com') === BLOCK, 'blocks redfin email any case');
assert(api.redfinEmailBlock('jane@gmail.com') === null, 'allows other email');
assert(api.redfinEmailBlock('') === null, 'empty is not a block');

const wrong = api.leadDecide({
  name: 'Ana Ruiz', status: 'New', phone: '(305) 555-0100',
  assigned: 'Sam Rivera', followupPlan: 'Weekly'
});
assert(wrong.wrongAgent === true, 'wrong agent flag');
assert(wrong.priority === 'Needs Review', 'wrong agent priority');
const wrongCopy = api.leadContent({
  name: 'Ana Ruiz', phone: '(305) 555-0100', assigned: 'Sam Rivera', email: 'ana@gmail.com'
}, wrong);
assert(wrongCopy.sms === null, 'no sms for wrong agent');

const blockedLead = api.leadContent({
  name: 'Pat Lee', status: 'New', phone: '(305) 555-0101',
  assigned: 'Kyle Kleinman', followupPlan: 'None', email: 'pat@redfin.com'
}, api.leadDecide({
  name: 'Pat Lee', status: 'New', phone: '(305) 555-0101',
  assigned: 'Kyle Kleinman', followupPlan: 'None'
}));
assert(blockedLead.email === null, 'lead email nulled for redfin');
assert(blockedLead.emailBlocked === BLOCK, 'lead block message');

const tour = api.inboundDecide({
  channel: 'gmail', source: 'Gmail', leadSource: null,
  name: 'Jane Doe', email: 'jane@gmail.com', phone: '(305) 555-1212',
  subject: 'Tour this week', body: 'Can we tour 10 Main St today?',
  stage: null, assigned: null, tags: [], address: '10 Main St', fromMe: false
});
assert(tour.priority === 'High', 'tour is high');
assert(tour.blocked === false, 'tour not blocked');
assert(tour.teamGate === false, 'direct gmail has no team gate');
assert(tour.sms && tour.sms.indexOf('Jane') === 0 || tour.sms.indexOf('Hey Jane') === 0, 'sms uses first name');
assert(tour.email && tour.email.body.indexOf('Kyle Kleinman') > 0, 'email signed');
assert(!/-/.test(tour.sms), 'sms has no hyphen');
assert(!/-/.test(tour.email.body), 'email body has no hyphen');
assert(tour.email.subject === 'Re: Tour this week', 'reply subject');

const internal = api.inboundDecide({
  channel: 'gmail', source: 'Gmail', name: 'Office', email: 'desk@redfin.com',
  phone: '(305) 555-0199', subject: 'Lead', body: 'Please call them.',
  tags: [], fromMe: false
});
assert(internal.blocked === true, 'gmail redfin blocked');
assert(internal.email === null && internal.sms === null, 'no outreach drafts to redfin');
assert(internal.flags.some(f => f.text === BLOCK), 'exact block copy');
assert(internal.priority === 'Needs Review', 'redfin priority');

const auto = api.inboundDecide({
  channel: 'gmail', source: 'Gmail', name: 'Zillow', email: 'noreply@zillow.com',
  subject: 'New lead', body: 'Unsubscribe from these alerts.',
  tags: [], fromMe: false
});
assert(auto.automated === true, 'noreply is automated');
assert(auto.sms === null && auto.email === null, 'no reply to automated');
assert(auto.priority === 'Low', 'automated is low');

const shared = api.inboundDecide({
  channel: 'fub', source: 'Follow Up Boss', leadSource: 'Redfin Agent Tools',
  name: 'Luis Ortega', email: 'luis@gmail.com', phone: '(786) 555-0144',
  stage: 'New', assigned: 'Kyle Kleinman', tags: ['team-lead'],
  body: 'Looking for a 3 bedroom in Miami.', fromMe: false
});
assert(shared.teamGate === true, 'shared fub source is gated');
assert(shared.sms && shared.email, 'drafts exist but stay behind the gate');
assert(api.isSharedSource('Personal referral', []) === false, 'personal source is not shared');
assert(api.isSharedSource('', ['Zillow']) === true, 'zillow tag is shared');

const otherOwner = api.inboundDecide({
  channel: 'fub', source: 'Follow Up Boss', leadSource: 'Website',
  name: 'Mia Chen', email: 'mia@gmail.com', phone: '(305) 555-0177',
  stage: 'New', assigned: 'Sam Rivera', tags: [], body: 'Buyer.', fromMe: false
});
assert(otherOwner.teamGate === true, 'other owner gated');
assert(otherOwner.wrongAgent === true, 'other owner flagged');
assert(otherOwner.flags.some(f => /Do not contact until Kyle confirms permission/.test(f.text)), 'ownership copy');

const unassigned = api.inboundDecide({
  channel: 'fub', source: 'Follow Up Boss', leadSource: 'Website',
  name: 'Mia Chen', email: 'mia@gmail.com', stage: 'New', assigned: null, tags: [],
  body: 'Hello', fromMe: false
});
assert(unassigned.teamGate === true, 'unassigned fub gated');

const mine = api.inboundDecide({
  channel: 'fub', source: 'Follow Up Boss', leadSource: 'Personal referral',
  name: 'Mia Chen', email: 'mia@gmail.com', phone: '(305) 555-0177',
  stage: 'New', assigned: 'Kyle Kleinman', tags: [], body: 'Want to sell my house.', fromMe: false
});
assert(mine.teamGate === false, 'kyle personal lead is not gated');
assert(mine.intent === 'seller', 'seller intent');
assert(mine.email && /pricing range/.test(mine.email.body), 'seller draft');

const pasted = api.contactFromPaste('From: Jane Doe <jane@gmail.com>\nSubject: Tour\nSource: Zillow\n\nCan we tour this week? Call (305) 555-1212.', 'gmail');
assert(pasted.name === 'Jane Doe', 'paste name');
assert(pasted.email === 'jane@gmail.com', 'paste email');
assert(pasted.phone === '(305) 555-1212', 'paste phone');
assert(pasted.leadSource === 'Zillow', 'paste source');
const pastedDecision = api.inboundDecide(pasted);
assert(pastedDecision.teamGate === true, 'pasted zillow source is gated');

const planOk = api.prefillPlan({
  note: 'Call Jane.',
  emailBody: 'Hi Jane',
  emailSubject: 'Re: Tour',
  sms: 'Hey Jane',
  recipient: 'jane@gmail.com'
}, ['note', 'emailBody']);
assert(planOk.fields.map(f => f.key).join(',') === 'note,emailBody', 'allow list limits fields');
assert(planOk.blocked.length === 0, 'clean plan has no blocks');
assert(!planOk.fields.some(f => f.key === 'recipient'), 'recipient is not prefilled by default');

const planBlock = api.prefillPlan({
  note: 'Do not email them.',
  emailBody: 'Hi',
  sms: 'Hey',
  recipient: 'desk@redfin.com',
  includeRecipient: true
}, ['note', 'emailBody', 'sms', 'recipient']);
assert(planBlock.fields.length === 1 && planBlock.fields[0].key === 'note', 'note still allowed');
assert(planBlock.blocked.some(b => b.key === 'emailBody' && b.reason === BLOCK), 'body blocked for redfin recipient');
assert(planBlock.blocked.some(b => b.key === 'recipient'), 'recipient blocked');
assert(planBlock.blocked.some(b => b.key === 'sms'), 'sms blocked when recipient is redfin');

assert(/not legal advice/.test(api.MODE_PROMPTS.contract), 'contract stays a worksheet');
assert(/@redfin\.com/.test(api.MODE_PROMPTS.mls), 'mls prompt keeps the email ban');

const cap = api.buildCapture({
  name: 'Jane Doe', phone: '(305) 555-1212', email: 'jane@redfin.com',
  apptType: 'Buyer Consult', assigned: 'Kyle Kleinman', rawText: 'Buyer Consult'
});
assert(cap.emailBlocked === true, 'capture blocks redfin email');
assert(/BLOCKED/.test(cap.fubText), 'fub record marks the email blocked');

if (failed) {
  console.error(failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('brains.test.js ok');
