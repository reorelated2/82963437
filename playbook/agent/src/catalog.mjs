/** The thirty rows from the manual. Volume is not verified. Scores for ranks 4–30 are priority judgments. */

export const CATALOG = [
  row("cycle-knob", "Non-gas dryer or washer cycle knob", "Timer knob split and the machine otherwise works.", "dryer knob", "PETG", 22, 30, 27.99, "TEST", 74, "15 / 25 / 14 / 12 / 8"),
  row("hinge-jig", "Euro-hinge drill jig, non-structural", "Stripped screws beside a 35 mm cup. The plastic must not hold the door.", "euro hinge stripped screw hole", "PETG", 28, 40, 22.99, "TEST", 74, "12 / 18 / 18 / 14 / 12"),
  row("snowblower-knob", "Snowblower chute-aim knob", "The chute knob split. This is not the safety bail.", "snowblower chute knob", "ASA", 20, 30, 27.99, "TEST", 70, "12 / 22 / 16 / 12 / 8"),
  row("mailbox-flag", "Mailbox plastic flag", "The flag snapped off.", "mailbox flag replacement", "ASA", 25, 40, 19.99, "HOLD", 64, "judgment"),
  row("closet-rod", "Closet-rod end support", "Rod end pulled out of the bracket.", "closet rod support", "PETG", 30, 40, 22.99, "HOLD", 61, "judgment"),
  row("thermostat-plate", "Thermostat trim plate", "Old round opening, new rectangular thermostat.", "thermostat trim plate", "PETG", 30, 45, 21.99, "HOLD", 60, "judgment"),
  row("stake-pocket", "Truck stake-pocket plug, one generation", "One truck, one hole. Not all trucks.", "stake pocket plug", "ASA", 20, 35, 24.99, "HOLD", 58, "judgment"),
  row("dehumidifier-latch", "Dehumidifier tank latch", "Tank will not stay seated.", "dehumidifier tank latch", "PETG", 15, 25, 22.99, "HOLD", 55, "judgment"),
  row("shower-guide", "Shower-door bottom guide", "Guide is missing. Not a bearing roller.", "shower door bottom guide", "PETG", 12, 25, 19.99, "HOLD", 54, "judgment"),
  row("window-crank", "Window crank handle", "Crank spline stripped.", "window crank handle", "PETG", 25, 40, 24.99, "HOLD", 50, "judgment"),
  row("dishwasher-clip", "Dishwasher rack clip, single", "OEM clip listed at $6.52. Printed single fails the hour gate.", "dishwasher rack clip", "ASA", 8, 25, 8.99, "KILL", 40, "calculator kill"),
  row("dishwasher-pack", "Dishwasher clip multipack", "Only revisit if a tested pack clears $18 against molded $9 packs.", "dishwasher rack clip 8 pack", "ASA", 40, 70, 18.99, "HOLD", 48, "judgment"),
  row("fridge-clip", "Refrigerator rail clip", "Same price pattern as the dishwasher clip until prices are opened.", "refrigerator rail clip", "PETG", 8, 20, 9.99, "HOLD", 50, "judgment"),
  row("shop-vac", "Shop-vac hose adapter", "Molded adapters already sell cheap.", "shop vac hose adapter", "PETG", 40, 50, 14.99, "KILL", 45, "judgment"),
  row("blind-connector", "Blind wand connector multipack", "Bags of connectors already sell for a few dollars.", "blind wand connector", "PETG", 15, 30, 9.99, "KILL", 42, "judgment"),
  row("fan-pull", "Ceiling-fan pull coupler", "Commodity price.", "ceiling fan pull coupler", "PETG", 5, 15, 8.99, "KILL", 40, "judgment"),
  row("headphone-hook", "Under-desk headphone hook", "Molded hooks are about $8 and the print is long.", "headphone hook under desk", "PLA", 40, 80, 12.99, "KILL", 35, "judgment"),
  row("gridfinity", "Gridfinity bins", "Open designs and a race to the bottom.", "gridfinity bin", "PLA", 80, 180, 14.99, "KILL", 30, "judgment"),
  row("honeycomb", "Honeycomb wall panel", "Print hours destroy the gate.", "honeycomb wall panel", "PLA", 120, 240, 19.99, "KILL", 28, "judgment"),
  row("holiday-clips", "Holiday light clips", "Molded bags of 100, then aged inventory after December.", "christmas light clips", "PETG", 30, 60, 9.99, "KILL", 25, "judgment"),
  row("cable-clips", "Adhesive cable-clip pack", "Injection molding already won.", "cable clip pack", "PETG", 20, 40, 8.99, "KILL", 25, "judgment"),
  row("tracker-case", "Tracker-case clone", "Trademark and a crowded low price.", "airtag holder", "PETG", 15, 30, 12.99, "KILL", 20, "judgment"),
  row("packout-plate", "Branded tool-box mounting plate clone", "Design patents and trademarks around those systems.", "packout mount", "PETG", 40, 60, 19.99, "KILL", 10, "judgment"),
  row("camera-mount", "Action-camera mount clone", "Crowded and exposed on trademarks.", "gopro mount", "PETG", 20, 40, 14.99, "KILL", 15, "judgment"),
  row("baby-gate", "Baby-gate hardware", "A falling gate is not a side project.", "baby gate hardware", "PETG", 20, 30, 18.99, "KILL", 0, "hard ban"),
  row("filter-bypass", "Fridge water-filter bypass", "Drinking water.", "refrigerator water filter bypass", "PETG", 15, 25, 16.99, "KILL", 0, "hard ban"),
  row("mower-bail", "Mower deadman bail", "That part is the safety system.", "lawn mower bail", "PETG", 20, 30, 19.99, "KILL", 0, "hard ban"),
  row("sensor-bracket", "Garage-door sensor bracket", "A misaimed sensor is how a door hits a person.", "garage door sensor bracket", "PETG", 15, 25, 16.99, "KILL", 0, "hard ban"),
  row("food-latch", "Food-container latch", "Food contact and layer lines.", "food container latch", "PETG", 10, 20, 12.99, "KILL", 0, "hard ban"),
  row("skimmer-weir", "Pool skimmer weir", "Chlorine and a molded OEM part. FDM is the wrong process.", "pool skimmer weir", "PETG", 25, 40, 19.99, "KILL", 20, "judgment"),
];

function row(id, product, problem, phrase, material, grams, minutes, price, verdict, score, blocks) {
  return {
    id,
    product,
    problem,
    phrase,
    material,
    grams,
    minutes,
    price,
    channel: id === "cycle-knob" ? "fbm" : "fbm",
    verdict,
    score,
    blocks,
    volume_note: "not verified",
    stage: verdict === "KILL" ? "killed" : "discovered",
  };
}

export function defaultAssumptions(material) {
  const key = String(material || "PETG").toUpperCase();
  if (key === "ASA" || key === "ABS") return { filament_per_kg: 24, fail_rate: 0.12 };
  if (key === "PLA") return { filament_per_kg: 20, fail_rate: 0.15 };
  return { filament_per_kg: 18, fail_rate: 0.08 };
}
