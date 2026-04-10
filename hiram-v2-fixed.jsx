import { useEffect, useState } from "react";

const DEAL_TYPES = [
  {
    id: "cashflow",
    tag: "NW 60TH CLONE",
    emoji: "🏘️",
    color: "#22c55e",
    accent: "#16a34a",
    priority: "HIGH PRIORITY",
    prompt: `You are a sharp Miami real estate investment analyst advising a Redfin agent sourcing off-market-style deals for a cash investor. Generate ONE realistic duplex/small multifamily opportunity in Miami zip codes 33142 or 33127, including edges of Allapattah and Little Haiti.

BUY BOX:

- Duplex or triplex, priced $350K–$550K
- Rentable but dated — value-add, not turnkey
- 1–2 blocks OFF main roads (quieter streets)
- Signals: high days on market (60+), bad listing photos, price reductions, estate sale, or motivated seller language
- Must pencil: rents should cover PITI on a hypothetical refi at 7%

WHY THE INVESTOR BUYS THIS:

- Rent immediately day 1
- Renovate units one at a time
- Refi or sell in 2–3 years at higher basis

Generate a REALISTIC scenario based on actual market conditions in these zip codes. Use specific street names that exist in these areas. Be precise with numbers.

Respond ONLY in this exact JSON format, no markdown, no backticks, no extra text:
{"address":"[real street name in 33142/33127]","price":"$XXX,XXX","type":"Duplex","beds_baths":"X/X per unit","sqft":"X,XXX","lot_size":"X,XXX sqft","year_built":"19XX","days_on_market":"XX","price_reductions":"[e.g. Reduced $20K from $XXX,XXX]","why_undervalued":"[2-3 sentences: what signals make this below market — DOM, photos, condition, seller situation]","gross_rent":"$X,XXX/mo total","estimated_piti":"$X,XXX/mo at 7% rate","monthly_cashflow":"+$XXX/mo","cap_rate":"X.X%","renovation_cost":"$XX,XXX–$XX,XXX estimate","after_repair_value":"$XXX,XXX","exit_strategy":"Rent now, renovate 1 unit at a time, refi in 24 months at higher basis","risk":"[1 sentence — honest risk factor]","nearest_comp":"[address] sold for $XXX,XXX [timeframe]"}`,
  },
  {
    id: "teardown",
    tag: "TEARDOWN / LOT PLAY",
    emoji: "🏗️",
    color: "#f59e0b",
    accent: "#d97706",
    priority: "THIS IS WHERE HE GETS RICH",
    prompt: `You are a sharp Miami real estate investment analyst. Generate ONE realistic teardown or vacant lot opportunity in Miami zip codes 33142 or 33127 (Allapattah, Liberty City, Brownsville, edges of Little Haiti).

BUY BOX:

- Old house in terrible condition OR vacant land
- Priced at or near land value (under $300K for land, under $400K for teardown)
- CORNER LOT = jackpot. Oversized lots (5,000+ sqft) preferred
- Zoning: T3, T4, T5, or anything allowing duplex+ density
- Near recent new construction or active building permits

THE PITCH: “This isn’t about the house — it’s about what you can build here.”

Generate a REALISTIC scenario. Use real street names in these zip codes. Be precise.

Respond ONLY in this exact JSON format, no markdown, no backticks:
{"address":"[real street in 33142/33127]","price":"$XXX,XXX","type":"Teardown/Vacant Lot","lot_size":"X,XXX sqft","corner_lot":"Yes/No","zoning":"[T3/T4/T5/etc]","current_structure":"[describe what’s there now — or ‘Vacant’]","why_undervalued":"[2-3 sentences: what makes this priced below potential — condition, seller situation, market blindspot]","build_potential":"[what could be built: duplex, triplex, townhomes, etc.]","estimated_build_cost":"$XXX,XXX–$XXX,XXX","after_build_value":"$XXX,XXX–$XXX,XXX","margin":"$XXX,XXX estimated spread","exit_strategy":"Demo, build [X], sell or hold at $XXX,XXX+","risk":"[1 honest sentence]","nearest_new_construction":"[address] — [X] units, sold/listed at $XXX,XXX"}`,
  },
  {
    id: "corridor",
    tag: "836 CORRIDOR PLAY",
    emoji: "🛣️",
    color: "#818cf8",
    accent: "#6366f1",
    priority: "YOUR EDGE",
    prompt: `You are a sharp Miami real estate investment analyst. Generate ONE realistic long-term appreciation play along the 836 (Dolphin Expressway) corridor in Miami.

TARGET STREETS:

- NW 7th Ave to NW 10th Ave
- NW 14th St corridor
- Edge of 33127 / 33142 overlap
- Near Allapattah Metrorail, Health District expansion, or any planned infrastructure

BUY BOX:

- Any property type: SFH, multi, mixed-use
- Under $500K
- The thesis is INFRASTRUCTURE = VALUE SHIFT
- Most investors don’t see this yet — that’s the edge
- Must have a clear catalyst: transit project, rezoning, institutional development nearby

Generate a REALISTIC scenario. Use real street names. Be precise.

Respond ONLY in this exact JSON format, no markdown, no backticks:
{"address":"[real street near 836 corridor]","price":"$XXX,XXX","type":"[SFH/Duplex/Mixed-Use]","sqft":"X,XXX","lot_size":"X,XXX sqft","proximity":"[nearest infrastructure catalyst — name the project, distance]","why_undervalued":"[2-3 sentences: what infrastructure/development catalyst most people are missing]","current_use":"[what it does now — rented, vacant, owner-occupied]","current_rent":"$X,XXX/mo if rented","five_year_thesis":"[2-3 sentences: why this appreciates 30-50% in 5 years — be specific about the catalyst]","exit_strategy":"Hold 3-5 years, collect rent, sell into the wave at $XXX,XXX+","risk":"[1 honest sentence]","price_trajectory":"[nearest recent sale showing the direction — address, price, date]"}`,
  },
];

function DealCard({ deal, type, isLoading }) {
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div
        style={{
          background: "#111827",
          border: `1px solid ${type.color}20`,
          borderRadius: 14,
          padding: 32,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 36, animation: "bob 2s ease-in-out infinite" }}>{type.emoji}</div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: 2,
            color: type.color,
            textTransform: "uppercase",
          }}
        >
          Sourcing {type.tag}…
        </div>
        <div style={{ width: 100, height: 2, background: `${type.color}20`, borderRadius: 2, overflow: "hidden" }}>
          <div
            style={{ width: "50%", height: "100%", background: type.color, animation: "sweep 1.2s ease-in-out infinite" }}
          />
        </div>
      </div>
    );
  }

  if (!deal) return null;

  const allFields = Object.entries(deal).filter(([k]) => !["address", "price", "type", "why_undervalued"].includes(k));
  const money = allFields.filter(([k]) => /rent|cashflow|piti|cost|value|margin|price|cap_rate|gross/.test(k));
  const details = allFields.filter(([k]) => !money.some(([mk]) => mk === k));

  return (
    <div
      onClick={() => setOpen(!open)}
      style={{
        background: "#111827",
        border: `1px solid ${open ? `${type.color}40` : `${type.color}15`}`,
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        transition: "all 0.3s ease",
      }}
    >
      <div style={{ height: 3, background: `linear-gradient(90deg, ${type.color}, transparent)` }} />
      <div style={{ padding: "22px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>{type.emoji}</span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 9,
                  letterSpacing: 2,
                  color: type.color,
                  background: `${type.color}12`,
                  padding: "2px 8px",
                  borderRadius: 3,
                }}
              >
                {type.tag}
              </span>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#f1f5f9", letterSpacing: -0.3 }}>{deal.address}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#64748b", marginTop: 2 }}>
              {deal.type} · {deal.lot_size || deal.sqft || ""}
            </div>
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 24, fontWeight: 700, color: type.color, letterSpacing: -1 }}>
            {deal.price}
          </div>
        </div>

        <div style={{ background: "#0a0e17", borderRadius: 10, padding: 14, borderLeft: `3px solid ${type.color}55` }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 2, color: type.color, marginBottom: 5 }}>
            WHY IT'S A DEAL
          </div>
          <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.65 }}>{deal.why_undervalued}</div>
        </div>

        {open && (
          <div style={{ marginTop: 14, animation: "fadeUp 0.25s ease" }}>
            {money.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${Math.min(money.length, 3)}, 1fr)`,
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                {money.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      background: `${type.color}08`,
                      border: `1px solid ${type.color}15`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 8,
                        letterSpacing: 1.5,
                        color: "#64748b",
                        marginBottom: 3,
                        textTransform: "uppercase",
                      }}
                    >
                      {k.replace(/_/g, " ")}
                    </div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 700, color: type.color }}>{v}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {details.map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 12, padding: "8px 12px", background: "#0a0e17", borderRadius: 8 }}>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 9,
                      letterSpacing: 1,
                      color: "#475569",
                      textTransform: "uppercase",
                      minWidth: 120,
                      paddingTop: 2,
                    }}
                  >
                    {k.replace(/_/g, " ")}
                  </div>
                  <div style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.5, flex: 1 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 10, fontFamily: "var(--mono)", fontSize: 9, color: "#374151", letterSpacing: 1.5 }}>
          {open ? "▲ COLLAPSE" : "▼ FULL BREAKDOWN"}
        </div>
      </div>
    </div>
  );
}

function MessageComposer({ deals }) {
  const [copied, setCopied] = useState(false);
  const lines = ["Hey Hiram — put together a few opportunities that match what you were describing:", ""];

  if (deals.cashflow) {
    lines.push(
      `1. Duplex in 33142 — ${deals.cashflow.address}. ${deals.cashflow.type}, listed at ${deals.cashflow.price}. Needs work but rents immediately. ${deals.cashflow.gross_rent || deals.cashflow.current_rent || ""} potential.`,
    );
  }

  if (deals.teardown) {
    lines.push(
      `\n2. ${deals.teardown.corner_lot === "Yes" ? "Corner lot " : ""}Teardown — ${deals.teardown.address}. ${deals.teardown.price}. This isn't about the house — it's about what you can build here. ${deals.teardown.build_potential}.`,
    );
  }

  if (deals.corridor) {
    lines.push(
      `\n3. 836 corridor play — ${deals.corridor.address}. ${deals.corridor.price}. Long-term upside based on ${deals.corridor.proximity}. Most people don't see this yet.`,
    );
  }

  lines.push("\nLet me know which direction you want to lean and I’ll tighten the focus from there.");

  const msg = lines.join("\n");

  const copy = () => {
    navigator.clipboard.writeText(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, overflow: "hidden" }}>
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>📩</span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: 2,
              color: "#94a3b8",
              textTransform: "uppercase",
            }}
          >
            Message to Hiram
          </span>
        </div>
        <button
          onClick={copy}
          style={{
            background: copied ? "#22c55e" : "#6366f1",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "6px 14px",
            cursor: "pointer",
            letterSpacing: 1,
            transition: "all 0.2s",
          }}
        >
          {copied ? "✓ COPIED" : "COPY"}
        </button>
      </div>
      <div
        style={{
          padding: 20,
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 14,
          color: "#cbd5e1",
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
        }}
      >
        {msg}
      </div>
    </div>
  );
}

export default function HiramV2() {
  const [deals, setDeals] = useState({});
  const [loading, setLoading] = useState({});
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(null);
  const [week, setWeek] = useState("");

  useEffect(() => {
    const d = new Date();
    const s = new Date(d.getFullYear(), 0, 1);
    const wk = Math.ceil(((d - s) / 86400000 + s.getDay() + 1) / 7);
    setWeek(`WK${wk} · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
  }, []);

  const run = async () => {
    setStarted(true);
    setError(null);
    setDeals({});

    for (const t of DEAL_TYPES) {
      setLoading((p) => ({ ...p, [t.id]: true }));
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            messages: [{ role: "user", content: t.prompt }],
          }),
        });

        const data = await r.json();
        const raw = data.content?.map((b) => b.text || "").join("") || "";
        const parsed = JSON.parse(raw.replace(/`json|`/g, "").trim());
        setDeals((p) => ({ ...p, [t.id]: parsed }));
      } catch {
        setError(`Failed on ${t.tag}. Tap regenerate.`);
      }
      setLoading((p) => ({ ...p, [t.id]: false }));
    }
  };

  const allDone = Object.keys(deals).length === 3 && !Object.values(loading).some(Boolean);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0e17",
        color: "#f1f5f9",
        fontFamily: "'Space Grotesk', sans-serif",
        "--mono": "'JetBrains Mono', monospace",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        @keyframes sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        @keyframes fadeUp { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }
      `}</style>

      <div style={{ maxWidth: 660, margin: "0 auto", padding: "36px 18px" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 3, color: "#6366f1", marginBottom: 6 }}>
            HIRAM'S PIPELINE · {week}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5, color: "#f1f5f9" }}>Weekly Deal Flow</h1>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#475569", marginTop: 6 }}>
            33142 · 33127 · Allapattah · Little Haiti · Cash Investor
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {DEAL_TYPES.map((t) => (
              <span
                key={t.id}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 9,
                  color: t.color,
                  background: `${t.color}10`,
                  padding: "3px 8px",
                  borderRadius: 4,
                  letterSpacing: 1,
                }}
              >
                {t.emoji} {t.tag}
              </span>
            ))}
          </div>
        </div>

        {!started ? (
          <button
            onClick={run}
            style={{
              width: "100%",
              padding: "16px 0",
              background: "linear-gradient(135deg, #6366f1, #818cf8)",
              border: "none",
              borderRadius: 12,
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
              marginBottom: 28,
              letterSpacing: 0.5,
              boxShadow: "0 4px 20px rgba(99,102,241,0.25)",
            }}
          >
            Source This Week's Deals →
          </button>
        ) : allDone ? (
          <button
            onClick={run}
            style={{
              width: "100%",
              padding: "12px 0",
              background: "transparent",
              border: "1px solid #6366f130",
              borderRadius: 10,
              color: "#6366f1",
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: 2,
              cursor: "pointer",
              marginBottom: 28,
            }}
          >
            ↻ REGENERATE
          </button>
        ) : null}

        {error && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "#ef4444",
              background: "#ef444410",
              padding: 10,
              borderRadius: 8,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {started && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {DEAL_TYPES.map((t) => (
              <DealCard key={t.id} deal={deals[t.id]} type={t} isLoading={loading[t.id]} />
            ))}
          </div>
        )}

        {allDone && (
          <div style={{ marginTop: 24 }}>
            <MessageComposer deals={deals} />
          </div>
        )}

        {allDone && (
          <div style={{ textAlign: "center", marginTop: 24, fontFamily: "var(--mono)", fontSize: 9, color: "#1e293b", letterSpacing: 2 }}>
            KYLE · REDFIN LEAD AGENT · FEW + STRONG
          </div>
        )}
      </div>
    </div>
  );
}
