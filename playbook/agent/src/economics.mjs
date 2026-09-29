/** Planning rates from playbook/03-numbers-cad-print.md. Confirm live fees before spending. */

export const SMALL_STANDARD_10_TO_50 = [
  [2, 3.32],
  [4, 3.42],
  [6, 3.45],
  [8, 3.54],
  [10, 3.68],
  [12, 3.78],
  [14, 3.91],
  [16, 3.96],
];

export const SMALL_STANDARD_UNDER_10 = [
  [2, 2.43],
  [4, 2.49],
  [6, 2.56],
  [8, 2.66],
  [10, 2.77],
  [12, 2.82],
  [14, 2.92],
  [16, 2.95],
];

export function roundTo(value, digits) {
  if (value == null || Number.isNaN(value)) return null;
  return Number(value.toFixed(digits));
}

export function fulfillmentBase(weightOz, price) {
  const table = price < 10 ? SMALL_STANDARD_UNDER_10 : SMALL_STANDARD_10_TO_50;
  if (weightOz <= 0 || weightOz > 16) {
    throw new Error("This helper only covers small standard up to 16 oz");
  }
  for (const [limit, fee] of table) {
    if (weightOz <= limit) return fee;
  }
  return table.at(-1)[1];
}

export function evaluate(input) {
  const price = num(input.price);
  const grams = num(input.grams);
  const printMinutes = num(input.print_minutes ?? input.printMinutes);
  const filamentPerKg = num(input.filament_per_kg ?? input.filamentPerKg);
  const failRate = num(input.fail_rate ?? input.failRate);
  const shipWeightOz = num(input.ship_weight_oz ?? input.shipWeightOz);
  const channel = input.channel;
  const tacoss = num(input.tacoss ?? input.tacos ?? 0);
  const returnRate = num(input.return_rate ?? input.returnRate ?? 0);
  const laborMinutes = num(input.labor_minutes ?? input.laborMinutes ?? 8);
  const laborRate = num(input.labor_rate ?? input.laborRate ?? 20);
  const packaging = num(input.packaging ?? 0.6);
  const postage = num(input.postage ?? 4.25);
  const watts = num(input.watts ?? 120);
  const kwhPrice = num(input.kwh_price ?? input.kwhPrice ?? 0.1834);
  const printerCost = num(input.printer_cost ?? input.printerCost ?? 399);
  const printerHours = num(input.printer_hours ?? input.printerHours ?? 4000);
  const referralRate = num(input.referral_rate ?? input.referralRate ?? 0.15);
  const fuelSurcharge = num(input.fuel_surcharge ?? input.fuelSurcharge ?? 0.035);
  const ebayRate = num(input.ebay_rate ?? input.ebayRate ?? 0.136);
  const ebayOrderFee = num(input.ebay_order_fee ?? input.ebayOrderFee ?? 0.4);

  const material = grams * (filamentPerKg / 1000);
  const hours = printMinutes / 60;
  const electricity = hours * (watts / 1000) * kwhPrice;
  const depreciation = hours * (printerCost / printerHours);
  const failure = failRate * (material + electricity);
  const labor = (laborMinutes / 60) * laborRate;
  const cashCogs = material + electricity + depreciation + failure + packaging;

  let marketplaceFees = 0;
  let outbound = 0;
  if (channel === "fba") {
    const referral = Math.max(0.3, price * referralRate);
    const fulfill = fulfillmentBase(shipWeightOz, price) * (1 + fuelSurcharge);
    marketplaceFees = referral + fulfill;
  } else if (channel === "fbm") {
    marketplaceFees = Math.max(0.3, price * referralRate);
    outbound = postage;
  } else if (channel === "ebay") {
    marketplaceFees = price * ebayRate + ebayOrderFee;
    outbound = postage;
  } else {
    throw new Error("channel must be fba, fbm, or ebay");
  }

  const adSpend = price * tacoss;
  const returnAllowance = returnRate * (cashCogs + outbound);
  const cashContribution = price - marketplaceFees - outbound - cashCogs - adSpend - returnAllowance;
  const preAdCash = price - marketplaceFees - outbound - cashCogs - returnAllowance;
  const hourProfit = hours ? cashContribution / hours : null;

  return {
    name: input.name ?? "",
    channel,
    price: roundTo(price, 2),
    material: roundTo(material, 2),
    electricity: roundTo(electricity, 3),
    depreciation: roundTo(depreciation, 3),
    failure_allowance: roundTo(failure, 3),
    packaging: roundTo(packaging, 2),
    labor: roundTo(labor, 2),
    cash_cogs: roundTo(cashCogs, 2),
    full_cogs: roundTo(cashCogs + labor, 2),
    marketplace_fees: roundTo(marketplaceFees, 2),
    outbound_postage: roundTo(outbound, 2),
    ad_spend: roundTo(adSpend, 2),
    return_allowance: roundTo(returnAllowance, 2),
    cash_contribution: roundTo(cashContribution, 2),
    contribution_after_owner_labor: roundTo(cashContribution - labor, 2),
    cash_contribution_margin: roundTo(cashContribution / price, 3),
    max_tacos_before_loss: roundTo(preAdCash / price, 3),
    break_even_roas: preAdCash > 0 ? roundTo(price / preAdCash, 2) : null,
    cash_profit_per_printer_hour: hourProfit == null ? null : roundTo(hourProfit, 2),
    cash_profit_per_gram: grams ? roundTo(cashContribution / grams, 2) : null,
    print_hours: roundTo(hours, 3),
    pre_ad_cash: roundTo(preAdCash, 2),
    label: "ESTIMATE until postage, fees, grams, and minutes are measured",
  };
}

export function economicsGate(result) {
  const hour = result.cash_profit_per_printer_hour ?? 0;
  const afterLabor = result.contribution_after_owner_labor ?? 0;
  if (hour < 15 || afterLabor < 0) {
    return { pass: false, band: "kill", reason: "Cash profit per printer hour is under $15, or contribution after owner labor is negative." };
  }
  if (hour < 25) {
    return { pass: true, band: "test", reason: "Positive, and under $25 per printer hour. Test only. Do not buy a second printer." };
  }
  return { pass: true, band: "scale", reason: "Clears $25 cash profit per printer hour and stays positive after owner labor." };
}

export function reorderPoint(dailySales, leadTimeDays, safetyDays = 7) {
  const safety = Math.ceil(dailySales * safetyDays);
  const point = dailySales * leadTimeDays + safety;
  return { reorder_point: Math.ceil(point), safety_stock: safety, batch: 10 };
}

export function moldCrossover(moldQuote, cashCogs, moldedPartPrice) {
  const spread = cashCogs - moldedPartPrice;
  if (spread <= 0) return { units: null, reason: "Molded part is not cheaper than current cash COGS." };
  return { units: Math.ceil(moldQuote / spread), reason: "Units required before the tool costs less than continuing to print." };
}

export function maxCpc(conversionRate, preAdCash) {
  if (conversionRate <= 0) return null;
  return roundTo(conversionRate * preAdCash, 2);
}

function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got ${value}`);
  return n;
}
