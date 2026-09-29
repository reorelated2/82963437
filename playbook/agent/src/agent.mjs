import { cadBrief, listingDraft, packSlip, qcChecklist, researchPlan, slicerStart } from "./artifacts.mjs";
import { defaultAssumptions } from "./catalog.mjs";
import { decide, reorderSignal } from "./decisions.mjs";
import { economicsGate, evaluate, maxCpc, moldCrossover, reorderPoint } from "./economics.mjs";
import { banReason, scoreOpportunity } from "./scoring.mjs";

const LIVE_LIMIT = 1;

export function createAgent(store) {
  return {
    state() {
      const opportunities = store.list().sort((a, b) => b.score - a.score || a.product.localeCompare(b.product));
      return {
        setup: store.setting("setup", {}),
        opportunities,
        today: today(store, opportunities),
        events: store.events(),
        kpis: kpis(store),
      };
    },

    intake(input) {
      const product = String(input.product || "").trim();
      const problem = String(input.problem || "").trim();
      const phrase = String(input.phrase || product).trim();
      if (!product || !problem) throw new Error("Product and the buyer's problem are required.");
      const id = slug(input.id || product);
      if (store.get(id)) throw new Error(`An opportunity named ${id} already exists.`);
      const ban = banReason(`${product} ${problem} ${phrase}`);
      const opportunity = {
        id,
        product,
        problem,
        phrase,
        material: input.material || "PETG",
        grams: numberOr(input.grams, null),
        minutes: numberOr(input.minutes, null),
        price: numberOr(input.price, null),
        channel: input.channel || "fbm",
        verdict: ban ? "KILL" : "HOLD",
        score: 0,
        blocks: "",
        volume_note: "not verified",
        stage: ban ? "killed" : "discovered",
        brand: input.brand || "YOUR BRAND",
        version: "v01",
        banSentence: input.banSentence || "Not an OEM part. Not for a gas valve, food contact, a child product, or a safety interlock.",
        measurements: null,
        fit: null,
        economics: null,
        evidence: { amazon: [], ebaySold: [], threads: Number(input.threads || 0), patentNote: "", thinEvidence: false },
        artifacts: {},
        ownSales: false,
        donorInHand: false,
        hasMeasurableStandard: false,
        notes: ban || "",
        hardKill: ban,
      };
      store.save(opportunity);
      store.log(id, "intake", { ban });
      const ran = this.run(id);
      return ran;
    },

    evidence(id, input) {
      const opportunity = must(store, id);
      const amazon = Array.isArray(input.amazon) ? input.amazon.map(cleanComp) : opportunity.evidence.amazon;
      const ebaySold = Array.isArray(input.ebaySold) ? input.ebaySold.map(cleanSold) : opportunity.evidence.ebaySold;
      opportunity.evidence = {
        ...opportunity.evidence,
        amazon,
        ebaySold,
        threads: Number(input.threads ?? opportunity.evidence.threads ?? 0),
        patentNote: String(input.patentNote ?? opportunity.evidence.patentNote ?? ""),
        thinEvidence: Boolean(input.thinEvidence),
      };
      if (input.donorInHand != null) opportunity.donorInHand = Boolean(input.donorInHand);
      opportunity.volume_note = "not verified";
      store.log(id, "evidence", {
        amazon: amazon.length,
        ebaySold: ebaySold.length,
        medianEbay: median(ebaySold.map((row) => row.price)),
      });
      store.save(opportunity);
      return this.run(id);
    },

    measure(id, measurements) {
      const opportunity = must(store, id);
      const clean = {};
      for (const [key, value] of Object.entries(measurements || {})) {
        if (value != null && String(value).trim()) clean[key] = String(value).trim();
      }
      if (!clean.shaft && !clean.summary && Object.keys(clean).length === 0) {
        throw new Error("Write at least one caliper reading.");
      }
      opportunity.measurements = clean;
      if (measurements.models) opportunity.modelsVerified = String(measurements.models).trim();
      opportunity.donorInHand = true;
      store.log(id, "measure", clean);
      store.save(opportunity);
      return this.run(id);
    },

    fit(id, input) {
      const opportunity = must(store, id);
      const passed = Boolean(input.passed);
      const attempts = (opportunity.fit?.attempts || 0) + 1;
      opportunity.fit = { passed, attempts, notes: String(input.notes || ""), at: new Date().toISOString() };
      if (input.grams) opportunity.grams = Number(input.grams);
      if (input.minutes) opportunity.minutes = Number(input.minutes);
      store.log(id, "fit", opportunity.fit);
      store.save(opportunity);
      return this.run(id);
    },

    sale(id, input) {
      const opportunity = must(store, id);
      if (opportunity.verdict === "KILL" || opportunity.stage === "killed") {
        throw new Error("This SKU is killed. Do not ship it.");
      }
      if (!opportunity.artifacts?.listing) throw new Error("Generate the listing before recording a sale. Run the opportunity after a passed fit test.");
      const units = Number(input.units || 1);
      const revenue = Number(input.revenue ?? (opportunity.price || 0) * units);
      store.addSale({
        opportunity_id: id,
        units,
        revenue,
        fees: Number(input.fees || 0),
        postage: Number(input.postage || 0),
        refunded: Boolean(input.refunded),
        reason: String(input.reason || ""),
      });
      opportunity.ownSales = true;
      opportunity.stage = "feedback";
      store.log(id, "sale", { units, revenue, refunded: Boolean(input.refunded) });
      store.save(opportunity);
      return this.run(id);
    },

    weekly() {
      const cards = [];
      for (const opportunity of store.list()) {
        if (opportunity.verdict === "KILL" || opportunity.stage === "killed") continue;
        const sales = store.sales(opportunity.id);
        const decision = decide(snapshot(opportunity, sales));
        cards.push({ id: opportunity.id, product: opportunity.product, decision, reorder: reorderSignal(onHand(opportunity, sales), daily(sales)) });
        store.log(opportunity.id, "weekly", { decision });
      }
      const body = { at: new Date().toISOString(), kpis: kpis(store), cards };
      store.log(null, "weekly-review", body);
      return body;
    },

    run(id) {
      const opportunity = must(store, id);
      const log = [];
      const stop = (code, message) => {
        opportunity.artifacts.next = { code, message };
        opportunity.artifacts.researchPlan = researchPlan(opportunity);
        store.save(opportunity);
        store.log(id, "agent-stop", { code, message });
        return { opportunity: store.get(id), log, stopped: code, message };
      };
      const note = (code, message) => log.push({ code, message });

      const ban = banReason(`${opportunity.product} ${opportunity.problem} ${opportunity.phrase} ${opportunity.notes || ""}`);
      if (ban || opportunity.hardKill) {
        opportunity.verdict = "KILL";
        opportunity.stage = "killed";
        opportunity.hardKill = ban || opportunity.hardKill;
        note("KILL", opportunity.hardKill);
        return stop("killed", opportunity.hardKill);
      }

      const liveOthers = store.list().filter((row) => row.id !== id && row.stage === "listing" && row.verdict !== "KILL");
      const salesCount = soldUnits(store.sales(id));

      if (!evidenceReady(opportunity)) {
        opportunity.stage = "demand";
        note("NEED_EVIDENCE", "Sold listings are not recorded yet.");
        return stop("need-evidence", researchPlan(opportunity).searches.map((item) => item.action).join(" "));
      }

      const observed = median(opportunity.evidence.ebaySold.map((row) => row.price).filter((price) => price > 0));
      if (observed && observed < 18) {
        opportunity.verdict = "KILL";
        opportunity.stage = "killed";
        opportunity.hardKill = `Median eBay sold price is $${observed}, under $18.`;
        note("KILL", opportunity.hardKill);
        return stop("killed", opportunity.hardKill);
      }

      if (opportunity.grams && opportunity.minutes && opportunity.price) {
        opportunity.economics = priceIt(opportunity);
        opportunity.artifacts.slicer = slicerStart(opportunity.material);
        const gate = economicsGate(opportunity.economics);
        note("ECONOMICS", `${gate.band}: $${opportunity.economics.cash_profit_per_printer_hour} per printer hour. ${opportunity.economics.label}`);
        if (!gate.pass) {
          opportunity.verdict = "KILL";
          opportunity.stage = "killed";
          opportunity.hardKill = gate.reason;
          return stop("killed", gate.reason);
        }
      } else {
        opportunity.stage = "spec";
        applyScore(opportunity, salesCount);
        return stop("need-numbers", "Grams, minutes, and price are required before a prototype is allowed.");
      }

      if (!opportunity.evidence.patentNote) {
        opportunity.stage = "ip";
        applyScore(opportunity, salesCount);
        note("NEED_PATENT", "Patent search is not written down.");
        return stop("need-patent", `Open https://patents.google.com and search "${opportunity.phrase}". Paste the patent numbers and status. Do not write that it is probably expired.`);
      }
      opportunity.stage = "safety";

      applyScore(opportunity, salesCount);
      if (opportunity.verdict === "KILL") {
        opportunity.stage = "killed";
        return stop("killed", opportunity.hardKill || "The rubric killed this row.");
      }

      opportunity.artifacts.cadBrief = cadBrief(opportunity);
      if (!opportunity.measurements) {
        opportunity.stage = "spec";
        return stop("need-measurement", "Buy or borrow the donor. Measure the mating feature three times. A listing photo is not a dimension.");
      }
      opportunity.stage = "cad";
      note("CAD", "Brief written from the caliper readings.");

      if (!opportunity.fit) {
        opportunity.stage = "prototype";
        opportunity.artifacts.qc = qcChecklist(opportunity);
        return stop("need-fit", "Print one. Fit it to the donor three times. Record pass or fail. Three failures means hire a designer instead of a fourth improvisation.");
      }
      if (!opportunity.fit.passed) {
        opportunity.stage = "fit";
        if (opportunity.fit.attempts >= 3) {
          return stop("hire-designer", "Three fit attempts failed. Send the brief and the caliper photos to a designer. Do not freehand a fourth.");
        }
        return stop("refit", `Fit attempt ${opportunity.fit.attempts} failed. Change the mating feature by 0.1 mm and print the next version.`);
      }

      opportunity.stage = "economics";
      opportunity.artifacts.listing = listingDraft(opportunity, opportunity.economics);
      opportunity.artifacts.slip = packSlip(opportunity);
      opportunity.artifacts.qc = qcChecklist(opportunity);
      opportunity.artifacts.reorder = reorderPoint(Math.max(soldUnits(store.sales(id)) / 40, 0), 2);

      if (liveOthers.length >= LIVE_LIMIT && salesCount < 30 && opportunity.stage !== "listing") {
        return stop("one-sku", "Another SKU is already listed and does not have 30 sales. Leave this one in CAD. Do not open a second listing.");
      }

      opportunity.stage = "listing";
      opportunity.verdict = "TEST";
      note("LISTING", "Print to order. On-hand inventory is zero. Handling time is 2 business days.");
      const decision = decide(snapshot(opportunity, store.sales(id)));
      opportunity.artifacts.decision = decision;
      return stop(decision.verdict.toLowerCase(), `${decision.reason} Listing price $${opportunity.economics.price} on ${opportunity.channel}. Ship nothing until an order exists.`);
    },
  };
}

function priceIt(opportunity) {
  const assumptions = defaultAssumptions(opportunity.material);
  const result = evaluate({
    name: opportunity.product,
    price: opportunity.price,
    grams: opportunity.grams,
    print_minutes: opportunity.minutes,
    filament_per_kg: assumptions.filament_per_kg,
    fail_rate: assumptions.fail_rate,
    ship_weight_oz: opportunity.shipWeightOz || Math.max(2, Math.ceil((opportunity.grams + 20) / 28.35)),
    channel: opportunity.channel || "fbm",
    tacoss: 0,
    return_rate: 0.1,
    labor_minutes: 10,
    packaging: 0.65,
    postage: opportunity.postage ?? 4.25,
  });
  result.max_cpc_at_8pct_assumption = maxCpc(0.08, result.pre_ad_cash);
  result.mold_watch = moldCrossover(4000, result.cash_cogs, 0.4);
  return result;
}

function applyScore(opportunity, salesCount) {
  const scored = scoreOpportunity({
    product: opportunity.product,
    problem: opportunity.problem,
    phrase: opportunity.phrase,
    amazonCount: opportunity.evidence.amazon.length,
    ebaySoldCount: opportunity.evidence.ebaySold.length,
    threadCount: opportunity.evidence.threads,
    observedPrice: median(opportunity.evidence.ebaySold.map((row) => row.price)) || opportunity.price,
    price: opportunity.price,
    economics: opportunity.economics,
    patentCleared: /none found|no active patent|cleared/i.test(opportunity.evidence.patentNote || ""),
    failureMode: "inconvenience",
    grams: opportunity.grams,
    minutes: opportunity.minutes,
    material: opportunity.material,
    donorInHand: opportunity.donorInHand,
    hasMeasurableStandard: opportunity.hasMeasurableStandard,
    measuredDimensions: opportunity.measurements ? Math.min(2, Object.keys(opportunity.measurements).length) : 0,
    ownSales: salesCount > 0,
    snapOrSpline: /spline/i.test(JSON.stringify(opportunity.measurements || {})),
  });
  opportunity.score = scored.total;
  opportunity.blocks = `${scored.demand} / ${scored.economics} / ${scored.ip} / ${scored.manufacturing} / ${scored.returns}`;
  opportunity.volume_note = scored.volume_note;
  if (scored.hardKill) {
    opportunity.verdict = "KILL";
    opportunity.hardKill = scored.hardKill;
  } else if (opportunity.verdict !== "LIVE") {
    opportunity.verdict = scored.verdict;
  }
}

function evidenceReady(opportunity) {
  const ebay = opportunity.evidence?.ebaySold?.length || 0;
  const amazon = opportunity.evidence?.amazon?.length || 0;
  return ebay >= 10 || (opportunity.evidence?.thinEvidence === true && amazon >= 3);
}

function snapshot(opportunity, sales) {
  const units = soldUnits(sales);
  const refunds = sales.filter((row) => row.refunded).reduce((sum, row) => sum + row.units, 0);
  const recentFit = sales.filter((row) => row.refunded && /fit/i.test(row.reason || ""));
  return {
    units,
    returnRate: units ? refunds / units : 0,
    fitComplaints14d: recentFit.length,
    hour: opportunity.economics?.cash_profit_per_printer_hour ?? null,
    afterLabor: opportunity.economics?.contribution_after_owner_labor ?? null,
    material: opportunity.material,
    unitsThisMonth: units,
    adsOn: false,
  };
}

function today(store, opportunities) {
  const setup = store.setting("setup", {});
  const items = [];
  if (!setup.calipersOrdered) items.push("Order digital calipers, about $20–$35. Do not order a printer yet.");
  const killed = opportunities.filter((row) => row.verdict === "KILL").length;
  items.push(`${killed} catalog rows are already killed. Leave them killed.`);
  const active = opportunities.find((row) => row.artifacts?.next)
    || opportunities.find((row) => row.id === "cycle-knob");
  if (active?.artifacts?.next) items.push(`${active.product}: ${active.artifacts.next.message}`);
  else items.push("Open the cycle knob and run it. The agent will stop at the eBay sold sheet on purpose.");
  if (!setup.llcFiled) items.push("File the LLC and get the EIN before a functional part ships.");
  if (!setup.insuranceBound) items.push("Get the insurance quote before that shipment. The premium is the quote.");
  return items;
}

function kpis(store) {
  const sales = store.sales();
  const units = sales.reduce((sum, row) => sum + (row.refunded ? 0 : row.units), 0);
  const refunds = sales.filter((row) => row.refunded).reduce((sum, row) => sum + row.units, 0);
  const revenue = sales.reduce((sum, row) => sum + (row.refunded ? 0 : row.revenue), 0);
  const shipped = units + refunds;
  return {
    revenue: round2(revenue),
    units,
    refunds,
    return_rate: shipped ? round2(refunds / shipped) : null,
    average_selling_price: units ? round2(revenue / units) : null,
    volume_note: units ? "own orders" : "not verified",
  };
}

function soldUnits(sales) {
  return sales.reduce((sum, row) => sum + row.units, 0);
}

function onHand(opportunity, sales) {
  const produced = opportunity.produced || 0;
  return Math.max(0, produced - soldUnits(sales));
}

function daily(sales) {
  if (!sales.length) return 0;
  return soldUnits(sales) / 40;
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function cleanComp(row) {
  return { price: Number(row.price) || 0, reviews: Number(row.reviews) || 0, stars: Number(row.stars) || 0, seller: String(row.seller || "") };
}

function cleanSold(row) {
  return { price: Number(row.price) || 0, title: String(row.title || ""), shaftVisible: Boolean(row.shaftVisible) };
}

function must(store, id) {
  const opportunity = store.get(id);
  if (!opportunity) throw new Error(`No opportunity ${id}`);
  return opportunity;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function numberOr(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
