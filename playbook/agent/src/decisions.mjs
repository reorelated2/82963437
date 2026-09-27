/** First matching rule from playbook/05-decisions-roadmap-automation.md. */

export function decide(snapshot) {
  const s = snapshot || {};
  if (s.safetyRisk || s.ipComplaint) {
    return stop("Stop the SKU. Do not relist with a tweaked title. Read the complaint or the hazard before anything else.");
  }
  if (s.returnRate > 0.15 || s.fitComplaints14d >= 3) {
    return action("KILL", "Returns are over 15%, or 3 fit complaints landed in 14 days. Stop this version. Pull stock.");
  }
  if (s.units >= 20 && s.returnRate > 0.08) {
    return action("IMPROVE", "Returns are over 8% after 20 units. Stop the batch and read every reason.");
  }
  if (s.clicks >= 200 && s.conversion != null && s.conversion < 0.05) {
    return action("IMPROVE", "Conversion is under 5% after 200 clicks. Pause scale-up. Change the main image or the first bullet once.");
  }
  if (s.tacos != null && s.maxTacos != null && s.tacos > s.maxTacos) {
    return action("IMPROVE", "TACOS is above the calculated maximum. Cut the daily budget in half today.");
  }
  if (s.cpcHighFor7Days && s.conversion != null && s.conversion < 0.08) {
    return action("IMPROVE", "CPC has been above half the maximum for 7 days and conversion is under 8%. Cut bids 20% and add negatives. Do not raise the budget.");
  }
  if (s.competitorHour != null && s.competitorHour < 15) {
    return action("HOLD", "Matching the competitor price drops printer-hour profit under $15. Do not match. Improve the fit proof or exit.");
  }
  if (s.overCapacity) {
    return action("SCALE", "Orders need more hours than the printer can run. Raise price 10% first. Buy another printer only if next week is still over capacity and the hour gate holds.");
  }
  const material = String(s.material || "PETG").toUpperCase();
  const failLimit = material === "ASA" || material === "ABS" ? 0.12 : 0.08;
  if (s.failRate != null && s.failRate > failLimit) {
    return action("IMPROVE", `Print failure rate is above ${Math.round(failLimit * 100)}% for ${material}. Stop saleable production and fix the spool or the profile.`);
  }
  if (s.unitsThisMonth >= 500) {
    return action("SCALE", "500 units this month. Run the mold crossover on real quotes. Order a tool only if payback sits inside the last 60 days of demand.");
  }
  if (s.unitsThisMonth >= 100) {
    return action("SCALE", "100 units this month. Write the process. Request three mold quotes. Do not send a tool deposit.");
  }
  if (s.units >= 20 && s.returnRate <= 0.08 && s.hour != null && s.hour >= 25) {
    return action("SCALE", "20 sales, returns at or under 8%, and the hour gate still holds. FBA and ads are allowed on their own triggers.");
  }
  if (s.units >= 10 && s.returnRate <= 0.08 && !s.adsOn) {
    return action("SCALE", "10 sales and returns at or under 8%. The Professional plan and two $10/day campaigns are allowed.");
  }
  if ((s.hour != null && s.hour < 15) || (s.afterLabor != null && s.afterLabor < 0)) {
    return action("KILL", "Cash profit per printer hour is under $15, or contribution after labor is negative.");
  }
  return action("HOLD", "No kill line is broken. Keep printing to order. Do not add a second SKU.");
}

export function reorderSignal(onHand, dailySales, leadTimeDays = 2) {
  if (!dailySales || dailySales <= 0) {
    return { print: false, reason: "No sales pace yet. Print to order only." };
  }
  const safety = Math.ceil(dailySales * 7);
  const point = Math.ceil(dailySales * leadTimeDays + safety);
  const daysOfCover = onHand / dailySales;
  if (daysOfCover > 60) return { print: false, reorder_point: point, days_of_cover: round1(daysOfCover), reason: "More than 60 days of cover. Stop printing." };
  if (onHand <= point) return { print: true, reorder_point: point, batch: 10, days_of_cover: round1(daysOfCover), reason: `On-hand is at or under ${point}. Print a batch of 10 of the current version only.` };
  return { print: false, reorder_point: point, days_of_cover: round1(daysOfCover), reason: "Stock is inside the band. Do not print a batch." };
}

function action(verdict, reason) {
  return { verdict, reason };
}

function stop(reason) {
  return { verdict: "KILL", reason };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
