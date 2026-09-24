const app = document.querySelector("#app");

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const when = (iso) => {
  if (!iso) return "No time set";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
};

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The desk could not finish that.");
  return body;
}

function shell(title, body) {
  const route = location.hash || "#/";
  const tab = (href, label) => `<a href="${href}" class="${route === href || (href !== "#/" && route.startsWith(href)) ? "active" : ""}">${label}</a>`;
  app.innerHTML = `
    <div class="app">
      <header class="top">
        <div>
          <div class="brand">Kleinman Desk</div>
          <div class="sub">Miami-Dade and Broward</div>
        </div>
      </header>
      <input class="search" id="search" placeholder="Search a client, phone, or property" aria-label="Search" />
      <div id="search-results"></div>
      <nav class="nav">
        ${tab("#/", "Today")}
        ${tab("#/intake", "New lead")}
        ${tab("#/settings", "Settings")}
      </nav>
      <main class="stack">${body}</main>
    </div>
  `;
  document.querySelector("#search").addEventListener("input", async (event) => {
    const q = event.target.value.trim();
    const slot = document.querySelector("#search-results");
    if (q.length < 2) {
      slot.innerHTML = "";
      return;
    }
    const data = await api(`/api/os/search?q=${encodeURIComponent(q)}`);
    slot.innerHTML = data.results.length
      ? `<div class="card">${data.results
          .map((person) => `<div class="item"><a href="#/contact/${person.id}">${esc(person.name)}</a> ${person.demo ? '<span class="badge">DEMO</span>' : ""}<div class="muted">${esc(person.phone || "No phone")}</div></div>`)
          .join("")}</div>`
      : `<div class="card empty">No client matches that.</div>`;
  });
}

function banner(data) {
  const bits = [];
  if (data.demoOnDesk) bits.push(`<div class="alert warn">Demo records are on this desk. They are not real clients.</div>`);
  if (data.outboundPaused) bits.push(`<div class="alert good">Outbound automations are paused. Drafts stay here until you send them yourself.</div>`);
  for (const alert of data.alerts) bits.push(`<div class="alert ${alert.level}">${esc(alert.title)}. ${esc(alert.detail)}</div>`);
  return bits.join("");
}

async function showToday() {
  const data = await api("/api/os/workspace");
  const hero = data.hero
    ? `<section class="card hero">
        <div class="kicker">Who needs you</div>
        <h1>${esc(data.hero.title)}</h1>
        <p>${esc(data.hero.why)}</p>
        <p><strong>Do this:</strong> ${esc(data.hero.action)}</p>
        <p><a href="${esc(data.hero.href)}">Open it</a></p>
      </section>`
    : `<section class="card"><h1>Nothing is waiting.</h1><p>Paste a new lead when you have one.</p></section>`;
  const sections = data.sections
    .map((section) => {
      const items = section.items.length
        ? section.items
            .map(
              (item) => `<div class="item">
                <div class="row"><strong>${esc(item.title)}</strong> ${item.demo ? '<span class="badge">DEMO</span>' : ""}</div>
                <div>${esc(item.reason)}</div>
                <div class="muted">${esc(item.action)}</div>
                <div><a href="${esc(item.href)}">Open</a></div>
              </div>`,
            )
            .join("")
        : `<div class="empty">${esc(section.empty)}</div>`;
      return `<section class="card"><h2>${esc(section.title)}</h2>${items}</section>`;
    })
    .join("");
  shell("Today", `${banner(data)}${hero}${sections}`);
}

async function showIntake(message = "") {
  shell(
    "New lead",
    `${message}
    <section class="card">
      <h1>New lead</h1>
      <p class="muted">Paste the lead, a text thread, or a note. You can also upload a screenshot. This prepares a draft. It does not text anyone.</p>
      <textarea id="lead-text" placeholder="Paste the lead here"></textarea>
      <input class="file" id="shot" type="file" accept="image/*" />
      <div class="actions">
        <button class="btn" id="prepare" type="button">Prepare follow up</button>
      </div>
    </section>`,
  );
  document.querySelector("#prepare").addEventListener("click", submitLead);
}

async function submitLead() {
  const text = document.querySelector("#lead-text").value;
  const file = document.querySelector("#shot").files[0];
  try {
    let result;
    if (file) {
      const dataBase64 = await fileToBase64(file);
      result = await api("/api/os/intake/screenshot", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, dataBase64, ocrText: text || undefined, isDemo: false }),
      });
    } else {
      result = await api("/api/os/intake", { method: "POST", body: JSON.stringify({ text, isDemo: false }) });
    }
    location.hash = `#/contact/${result.contactId}`;
    sessionStorage.setItem("lastIntake", JSON.stringify(result));
  } catch (error) {
    showIntake(`<div class="alert bad">${esc(error.message)}</div>`);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

async function showContact(id) {
  const file = await api(`/api/os/contacts/${id}`);
  const last = JSON.parse(sessionStorage.getItem("lastIntake") || "null");
  const fresh = last && last.contactId === id ? last : null;
  const draft = file.messages[0];
  const note = file.notes[0];
  const state = fresh?.duplicateEvent
    ? `<div class="alert warn">This exact lead was already here. No second contact, note, or follow up was created.</div>`
    : fresh?.unclear
      ? `<div class="alert bad">${esc(fresh.failure || "Screenshot text is unclear.")}</div>`
      : fresh?.conflicts?.length
        ? `<div class="alert warn">Conflicting facts were kept. The original record was not overwritten.</div>`
        : "";
  const labels = {
    name: "Name", phone: "Phone", email: "Email", leadSource: "Source", assignedAgent: "Assigned agent",
    address: "Property", mls: "MLS", areas: "Areas", budget: "Budget", propertyUse: "Use", financing: "Financing",
    timeline: "Timeline", motivation: "Motivation", mustHaves: "Must haves", dealBreakers: "Deal breakers",
    requestedShowing: "Requested showing", availableShowing: "Available time", confirmedShowing: "Confirmed showing",
  };
  const known = file.facts.filter((fact) => fact.status === "stated" && fact.value);
  const needed = file.facts.filter((fact) => fact.status === "data_needed").map((fact) => labels[fact.field] || fact.field);
  const showing = file.showings[0];
  const nextTask = file.tasks.find((task) => task.status === "open");
  const shortNote = file.activity.map((item) => {
    try { return JSON.parse(item.payload).internalNote; } catch { return ""; }
  }).find(Boolean);
  shell(
    file.contact.name,
    `${state}
    <section class="card">
      <div class="row"><h1>${esc(file.contact.name)}</h1>${file.contact.demo ? '<span class="badge">DEMO</span>' : ""}</div>
      <p class="muted">${esc(file.contact.phone || "Phone: Data needed.")} · ${esc(file.contact.stage)}</p>
      ${showing ? `<p>Requested: ${esc(showing.requestedTime || "Data needed.")}<br>Available: ${esc(showing.availableTime || "Data needed.")}<br>Confirmed: ${esc(showing.confirmedTime || "no")}</p>` : "<p>No showing time is on file.</p>"}
      <p><strong>Next:</strong> ${esc(nextTask ? `${nextTask.title}. ${nextTask.detail || ""}` : "Nothing is scheduled.")}</p>
      ${shortNote ? `<p>${esc(shortNote)}</p>` : ""}
    </section>
    <section class="card">
      <h2>Next text</h2>
      ${
        draft
          ? `<div class="message">${esc(draft.body)}</div>
             <dl>
               <dt>Recipient</dt><dd>${esc(draft.recipient || "Phone number needed")}</dd>
               <dt>Channel</dt><dd>Text draft</dd>
               <dt>Why this text</dt><dd>${esc(draft.purpose)}</dd>
               <dt>Context</dt><dd>${esc(draft.context)}</dd>
               <dt>Reminder</dt><dd>${when(draft.scheduledFor)}. This is not an automatic send.</dd>
               <dt>Status</dt><dd>${esc(draft.status)}${draft.sentAt ? "" : ". Nothing has been sent."}</dd>
             </dl>
             <div class="actions">
               <button class="btn" id="approve" type="button">I will send this myself</button>
               <button class="btn-quiet" id="copy-text" type="button">Copy text</button>
             </div>`
          : `<div class="alert bad">No client text is ready. The source was unclear or incomplete.</div>`
      }
    </section>
    <section class="card">
      <h2>CRM note</h2>
      <p class="muted">Copy this into Redfin. This desk does not write to Redfin.</p>
      <div class="message" id="note">${esc(note?.body || "No note yet.")}</div>
      <div class="actions"><button class="btn-quiet" id="copy-note" type="button">Copy note</button></div>
    </section>
    <section class="card">
      <h2>Known</h2>
      ${known.map((fact) => `<div class="item"><strong>${esc(labels[fact.field] || fact.field)}</strong><div>${esc(fact.value)}</div></div>`).join("") || "<div class='empty'>No stated facts yet.</div>"}
      <h2>Data needed</h2>
      ${needed.length ? `<ul class="list">${needed.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<div class='empty'>Nothing else was marked missing on the last paste.</div>"}
    </section>
    ${
      file.facts.some((fact) => fact.status === "unclear" || fact.status === "conflict")
        ? `<section class="card"><h2>Check these</h2>${file.facts
            .filter((fact) => fact.status === "unclear" || fact.status === "conflict")
            .map((fact) => `<div class="item"><strong>${esc(labels[fact.field] || fact.field)}</strong> · ${esc(fact.status)}<div>${esc(fact.value || "Data needed.")}</div></div>`)
            .join("")}</section>`
        : ""
    }
    <section class="card">
      <h2>Follow ups</h2>
      ${file.tasks.map((task) => `<div class="item"><strong>${esc(task.title)}</strong><div>${esc(task.detail || "")}</div><div class="muted">${when(task.dueAt)} · ${esc(task.status)}</div>${task.status === "open" ? `<button class="btn-quiet" data-task="${esc(task.id)}" type="button">Mark done</button>` : ""}</div>`).join("") || "<div class='empty'>No follow ups.</div>"}
    </section>`,
  );
  document.querySelector("#approve")?.addEventListener("click", async () => {
    const result = await api(`/api/os/drafts/${draft.id}/approve`, { method: "POST", body: "{}" });
    alert(result.sent ? "Sent." : "Saved. Nothing was sent.");
    showContact(id);
  });
  document.querySelector("#copy-text")?.addEventListener("click", () => copyText(draft.body));
  document.querySelector("#copy-note")?.addEventListener("click", () => copyText(note?.body || ""));
  document.querySelectorAll("[data-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/os/tasks/${button.dataset.task}/done`, { method: "POST", body: "{}" });
      showContact(id);
    });
  });
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

async function showSettings(message = "") {
  const data = await api("/api/os/settings");
  const settings = data.settings;
  const integrations = data.integrations
    .map(
      (row) => `<div class="item"><strong>${esc(row.name)}</strong> · ${esc(row.status.replaceAll("_", " "))}<div>${esc(row.detail)}</div><div class="muted">Checked ${esc(row.checkedOn)}${row.source ? ` · ${esc(row.source)}` : ""}</div></div>`,
    )
    .join("");
  shell(
    "Settings",
    `${message}
    <section class="card">
      <h1>Controls</h1>
      <p>Release 1 estimated cost: $0. No paid service is called.</p>
      <label><input id="paused" type="checkbox" ${settings.outboundPaused ? "checked" : ""}/> Pause outbound automations</label>
      <p class="muted">Spending limit: $${esc(settings.spendingLimitUsd)}. Recorded this month: $${esc(settings.spendMonthUsd)}.</p>
      <label>Spending limit in dollars <input id="limit" type="number" min="0" step="1" value="${esc(settings.spendingLimitUsd)}" /></label>
      <div class="actions">
        <button class="btn" id="save-settings" type="button">Save controls</button>
        <button class="btn-quiet" id="backup" type="button">Back up this desk</button>
        <a class="btn-quiet" href="/api/os/export">Export records</a>
      </div>
    </section>
    <section class="card">
      <h2>Practice data</h2>
      <p class="muted">Demo people are fake. Use them to learn the screen, then remove them before real leads.</p>
      <div class="actions">
        <button class="btn" id="demo" type="button">Add demo examples</button>
        <button class="btn-quiet" id="clear-demo" type="button">Remove demo records</button>
      </div>
    </section>
    <section class="card">
      <h2>Connections</h2>
      ${integrations}
    </section>`,
  );
  document.querySelector("#save-settings").addEventListener("click", async () => {
    await api("/api/os/settings", {
      method: "POST",
      body: JSON.stringify({
        outboundPaused: document.querySelector("#paused").checked,
        spendingLimitUsd: Number(document.querySelector("#limit").value),
      }),
    });
    showSettings(`<div class="alert good">Saved. Nothing was sent.</div>`);
  });
  document.querySelector("#backup").addEventListener("click", async () => {
    const result = await api("/api/os/backup", { method: "POST", body: "{}" });
    showSettings(`<div class="alert good">Backup saved as ${esc(result.file)}.</div>`);
  });
  document.querySelector("#demo").addEventListener("click", async () => {
    await api("/api/os/demo", { method: "POST", body: "{}" });
    location.hash = "#/";
  });
  document.querySelector("#clear-demo").addEventListener("click", async () => {
    await api("/api/os/demo", { method: "DELETE" });
    showSettings(`<div class="alert good">Demo records removed.</div>`);
  });
}

async function render() {
  const hash = location.hash || "#/";
  try {
    if (hash.startsWith("#/contact/")) return showContact(hash.split("/")[2]);
    if (hash.startsWith("#/intake")) return showIntake();
    if (hash.startsWith("#/settings")) return showSettings();
    return showToday();
  } catch (error) {
    app.innerHTML = `<div class="app"><div class="alert bad">${esc(error.message)} Refresh the page. If this keeps happening, the desk is not running.</div></div>`;
  }
}

window.addEventListener("hashchange", render);
render();
