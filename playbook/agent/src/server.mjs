import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "./agent.mjs";
import { openStore } from "./store.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(root, "public", "index.html"));

export function start(options = {}) {
  const file = options.file || process.env.PARTS_DB || join(root, "..", "data", "agent.sqlite");
  const store = options.store || openStore(file);
  const agent = createAgent(store);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, page, "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, product: "parts-agent" });
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, agent.state());
      if (req.method === "POST" && url.pathname === "/api/weekly") return json(res, 200, agent.weekly());
      if (req.method === "POST" && url.pathname === "/api/intake") return json(res, 200, agent.intake(await body(req)));
      if (req.method === "POST" && url.pathname === "/api/setup") {
        const next = { ...store.setting("setup", {}), ...(await body(req)) };
        store.setSetting("setup", next);
        return json(res, 200, agent.state());
      }
      const match = url.pathname.match(/^\/api\/opportunities\/([^/]+)\/(run|evidence|measure|fit|sale)$/);
      if (req.method === "POST" && match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        const payload = action === "run" ? null : await body(req);
        const result = action === "run" ? agent.run(id) : agent[action](id, payload);
        return json(res, 200, result);
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });
  return { server, agent, store };
}

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Body must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function send(res, status, payload, type) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(payload);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8091);
  const { server } = start();
  server.listen(port, "127.0.0.1", () => {
    console.log(`parts agent http://127.0.0.1:${port}`);
  });
}
