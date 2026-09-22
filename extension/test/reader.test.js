const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const readerSrc = fs.readFileSync(path.join(__dirname, '..', 'reader.js'), 'utf8');

function boot(url, html) {
  const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>', { url, runScripts: 'dangerously' });
  const BLOCK = { DIV: 1, P: 1, H1: 1, H2: 1, TR: 1, LI: 1, TABLE: 1, SECTION: 1, BR: 1, TEXTAREA: 1 };
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() {
      let out = '';
      const walk = node => {
        if (node.nodeType === 3) { out += node.nodeValue; return; }
        if (node.nodeType !== 1) return;
        const block = BLOCK[node.tagName];
        if (node.tagName === 'BR') { out += '\n'; return; }
        if (block) out += '\n';
        node.childNodes.forEach(walk);
        if (block) out += '\n';
      };
      this.childNodes.forEach(walk);
      return out;
    },
    set(v) {
      this.textContent = v == null ? '' : String(v);
    }
  });
  const listeners = [];
  let clicks = 0;
  dom.window.__chrome = {
    runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } }
  };
  const origClick = dom.window.HTMLElement.prototype.click;
  dom.window.HTMLElement.prototype.click = function () { clicks += 1; return origClick.apply(this, arguments); };
  vm.runInContext('var chrome = window.__chrome;\n' + readerSrc, dom.getInternalVMContext());
  function send(msg) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ret = listeners[0](msg, {}, payload => { settled = true; resolve(payload); });
      if (!settled && ret !== true) reject(new Error('listener did not answer'));
    });
  }
  return { dom, send, clicks: () => clicks };
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  }
}

(async () => {
  const gmail = boot('https://mail.google.com/mail/u/0/#inbox/FMfcgzQxVk1234567890abc', `
    <h2 class="hP">Tour this week</h2>
    <div class="adn">
      <span class="gD" email="jane@gmail.com" name="Jane Doe via Zillow">Jane Doe via Zillow</span>
      <span class="g3" title="Tue, Sep 22, 2026, 9:00 AM"></span>
      <div class="a3s">Can we tour 10 Main St today? My number is (305) 555-1212.</div>
    </div>
    <div contenteditable="true" aria-label="Message Body"></div>
    <button id="send">Send</button>
  `);
  const read = await gmail.send({ cmd: 'READ' });
  assert(read.pageType === 'gmail-thread', 'gmail thread classified');
  assert(read.single.name === 'Jane Doe', 'via suffix stripped');
  assert(read.single.email === 'jane@gmail.com', 'sender email');
  assert(read.single.phone === '(305) 555-1212', 'phone from body');
  assert(read.single.subject === 'Tour this week', 'subject');
  assert(read.compose.open === true, 'compose detected');
  assert(gmail.clicks() === 0, 'read does not click');

  const list = boot('https://mail.google.com/mail/u/0/#inbox', `
    <table><tr class="zA"><td>One</td></tr><tr class="zA"><td>Two</td></tr></table>
  `);
  const listRead = await list.send({ cmd: 'READ' });
  assert(listRead.pageType === 'gmail-list', 'inbox list is not one lead');
  assert(listRead.single === null, 'list has no blended contact');
  assert(listRead.listCount === 2, 'list count');

  const mine = boot('https://mail.google.com/mail/u/0/#inbox/FMfcgzQxVk1234567890abc', `
    <h2 class="hP">Re: Tour</h2>
    <div class="adn">
      <span class="gD" email="kyle.kleinman@gmail.com" name="Kyle Kleinman">Kyle Kleinman</span>
      <div class="a3s">I can tour Thursday.</div>
    </div>
  `);
  const mineRead = await mine.send({ cmd: 'READ' });
  assert(mineRead.single.fromMe === true, 'latest message from Kyle is fromMe');

  const fub = boot('https://app.followupboss.com/2/people/view/42', `
    <h1>Luis Ortega</h1>
    <a href="mailto:luis@gmail.com">luis@gmail.com</a>
    <a href="tel:+13055550144">(305) 555-0144</a>
    <div>Stage</div><div>New</div>
    <div>Source</div><div>Redfin</div>
    <div>Assigned</div><div>Kyle Kleinman</div>
    <textarea aria-label="Add a note"></textarea>
    <button type="submit">Save</button>
  `);
  const fubRead = await fub.send({ cmd: 'READ' });
  assert(fubRead.pageType === 'fub-contact', 'fub person classified');
  assert(fubRead.single.name === 'Luis Ortega', 'fub name');
  assert(fubRead.single.email === 'luis@gmail.com', 'fub email');
  assert(fubRead.single.stage === 'New', 'fub stage');
  assert(fubRead.single.leadSource === 'Redfin', 'fub source');
  assert(fubRead.single.assigned === 'Kyle Kleinman', 'fub assigned');
  assert(fubRead.noteVisible === true, 'note field visible');

  const people = boot('https://app.followupboss.com/2/people', `
    <h1>People</h1>
    <a href="mailto:a@gmail.com">a</a>
    <a href="mailto:b@gmail.com">b</a>
    <a href="mailto:c@gmail.com">c</a>
    <a href="mailto:d@gmail.com">d</a>
    <a href="mailto:e@gmail.com">e</a>
  `);
  const peopleRead = await people.send({ cmd: 'READ' });
  assert(peopleRead.pageType === 'fub-list', 'fub people list is not one contact');

  const redfin = boot('https://www.redfin.com/tools/customers/99', `
    <a class="name">Ana Ruiz</a>
    <div>This customer is new to Redfin and browsing homes.</div>
  `);
  const redfinRead = await redfin.send({ cmd: 'READ' });
  assert(redfinRead.pageType === 'customer-detail', 'agent tools detail still classifies');
  assert(redfinRead.single.name === 'Ana Ruiz', 'detail name');
  assert(redfinRead.single.status === 'New', 'new status');

  const pre = await gmail.send({
    cmd: 'PREFILL',
    fields: [
      { key: 'emailBody', value: 'Hi Jane,\n\nKyle with Redfin.' },
      { key: 'recipient', value: 'desk@redfin.com' },
      { key: 'note', value: 'Call Jane.' }
    ]
  });
  const body = gmail.dom.window.document.querySelector('[aria-label="Message Body"]');
  assert(pre.filled.indexOf('emailBody') >= 0, 'compose body prefilled');
  assert(body.innerText.indexOf('Hi Jane') >= 0, 'draft text landed');
  assert(pre.blocked.some(b => b.key === 'recipient'), 'redfin recipient blocked in the page');
  assert(pre.missed.some(m => m.key === 'note'), 'missing note reported');
  assert(gmail.clicks() === 0, 'prefill never clicks Send');

  const occupied = boot('https://app.followupboss.com/2/people/view/7', `
    <h1>Ana Ruiz</h1>
    <a href="mailto:ana@gmail.com">ana@gmail.com</a>
    <textarea aria-label="Notes">Already written</textarea>
    <input name="subjectbox" value="">
    <button>Send</button>
  `);
  const occ = await occupied.send({
    cmd: 'PREFILL',
    fields: [
      { key: 'note', value: 'New note' },
      { key: 'emailSubject', value: 'Following up' },
      { key: 'emailBody', value: 'Hi Ana,\n\nPlease email sam@redfin.com' }
    ]
  });
  const note = occupied.dom.window.document.querySelector('textarea');
  const subject = occupied.dom.window.document.querySelector('input[name="subjectbox"]');
  assert(occ.occupied.indexOf('note') >= 0, 'existing note left alone');
  assert(note.value === 'Already written', 'note value unchanged');
  assert(occ.filled.indexOf('emailSubject') >= 0, 'empty subject written');
  assert(subject.value === 'Following up', 'subject value set');
  assert(occ.blocked.some(b => b.key === 'emailBody'), 'body containing redfin is blocked');
  assert(occupied.clicks() === 0, 'occupied prefill never clicks');

  if (failed) {
    console.error(failed + ' assertion(s) failed');
    process.exit(1);
  }
  console.log('reader.test.js ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
