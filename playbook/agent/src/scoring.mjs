/** Rubric from playbook/02-ingredients-and-first-recipe.md Step 5. */

const BANS = [
  [/baby|toddler|\bchild\b|crib|baby-gate|baby gate/i, "Children's product or a falling gate."],
  [/food[- ]contact|food[- ]container|meal[- ]prep|water[- ]filter|filter bypass/i, "Food contact or drinking water."],
  [/gas valve|controls a flame|\bflame\b|burner knob/i, "Controls a flame."],
  [/\bbrake\b|steering|airbag|fuel line|fuel hose/i, "Vehicle safety or fuel."],
  [/deadman|\bbail\b/i, "Safety interlock or deadman control."],
  [/garage[- ]door sensor|safety sensor bracket/i, "Could misaim a safety sensor."],
  [/packout|airtag|air tag|gopro|action[- ]camera mount/i, "Branded system clone."],
  [/medical device|cpap|inhaler/i, "Medical device."],
];

export function banReason(text) {
  const blob = text || "";
  for (const [pattern, reason] of BANS) {
    if (pattern.test(blob)) return reason;
  }
  return null;
}

export function scoreOpportunity(input) {
  const ban = banReason(`${input.product || ""} ${input.problem || ""} ${input.phrase || ""} ${input.notes || ""}`);
  if (ban) {
    return {
      demand: 0,
      economics: 0,
      ip: 0,
      manufacturing: 0,
      returns: 0,
      total: 0,
      hardKill: ban,
      verdict: "KILL",
      volume_note: "not verified",
    };
  }

  const demand = demandPoints(input);
  const economics = economicsPoints(input.economics);
  const ip = ipPoints(input);
  const manufacturing = manufacturingPoints(input);
  const returns = returnPoints(input);
  const total = demand + economics + ip + manufacturing + returns;
  const hardKill = hardKillReason(input, economics, ip);
  let verdict = "HOLD";
  if (hardKill) verdict = "KILL";
  else if (input.live) verdict = "LIVE";
  else if (total >= 70 && economics >= 18 && ip >= 10) verdict = "TEST";
  else if (economics >= 10) verdict = "HOLD";

  return {
    demand,
    economics,
    ip,
    manufacturing,
    returns,
    total,
    hardKill,
    verdict,
    volume_note: input.ownSales ? "own orders" : "not verified",
  };
}

function demandPoints(input) {
  if (input.ownSales) return 25;
  const amazon = Number(input.amazonCount || 0);
  const ebay = Number(input.ebaySoldCount || 0);
  const threads = Number(input.threadCount || 0);
  const price = Number(input.observedPrice || input.price || 0);
  if (amazon > 0 && ebay > 0 && price >= 18) return 20;
  if (amazon > 0 && ebay > 0) return 15;
  if (threads > 0 || amazon > 0 || ebay > 0) return 10;
  return 0;
}

function economicsPoints(economics) {
  if (!economics) return 0;
  const cash = economics.cash_contribution;
  const hour = economics.cash_profit_per_printer_hour;
  const after = economics.contribution_after_owner_labor;
  if (cash == null || cash <= 0 || after == null || after < 0) return 0;
  if (hour >= 25 && after > 0) return 25;
  if (hour >= 15) return 18;
  if (hour > 0) return 10;
  return 0;
}

function ipPoints(input) {
  if (input.safetyCritical || input.brandedClone || input.foodContact) return 0;
  if (input.patentCleared && input.failureMode === "inconvenience") return 20;
  return 10;
}

function manufacturingPoints(input) {
  const grams = Number(input.grams || 0);
  const minutes = Number(input.minutes || input.print_minutes || 0);
  if (!grams || !minutes) return 0;
  let points = 0;
  if (grams <= 40 && minutes <= 45 && String(input.material).toUpperCase() === "PETG" && !input.supports && Number(input.clearanceMm || 0.5) > 0.4) {
    points = 15;
  } else if (grams <= 40 && minutes <= 45) {
    points = 10;
  } else {
    points = 5;
  }
  if (String(input.material).toUpperCase() === "ASA" || String(input.material).toUpperCase() === "ABS") points -= 5;
  if (input.snapOrSpline) points -= 5;
  if (input.supports) points -= 5;
  return Math.max(0, points);
}

function returnPoints(input) {
  if (input.fitClaim === "universal" && !input.donorInHand) return 0;
  if (input.donorInHand) return 8;
  if (input.measuredDimensions >= 1 && input.measuredDimensions <= 2) return 15;
  return 0;
}

function hardKillReason(input, economicsBlock, ipBlock) {
  if (economicsBlock < 10 && input.economics) return "Economics block is under 10.";
  if (ipBlock < 10) return "IP and safety block is under 10.";
  const minutes = Number(input.minutes || input.print_minutes || 0);
  if (minutes > 90) return "Print is over 90 minutes.";
  const price = Number(input.price || input.observedPrice || 0);
  if (price > 0 && price < 18) return "Price is under $18.";
  if (input.donorUnobtainable && !input.hasMeasurableStandard) return "No way to obtain a donor or a measurable standard.";
  return null;
}
