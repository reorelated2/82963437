/** Documents the agent writes. Claims stay inside the measurements it was given. */

const SLICER = {
  PLA: { nozzle: "200–215°C", bed: "55–60°C", fan: "100% after layer 3", walls: 3, infill: "15% gyroid", layer: "0.20 mm", note: "Fit check only. Marker the part NOT FOR SALE." },
  PETG: { nozzle: "230–250°C", bed: "70–80°C", fan: "20–50%", walls: 4, infill: "20% gyroid", layer: "0.20 mm", note: "Default production material for indoor parts." },
  ASA: { nozzle: "240–260°C", bed: "90–100°C", fan: "0–20%", walls: "4–6", infill: "25% gyroid", layer: "0.20 mm", note: "Enclosed printer. Ventilate the room. Brim on." },
  ABS: { nozzle: "240–260°C", bed: "90–100°C", fan: "0–20%", walls: "4–6", infill: "25% gyroid", layer: "0.20 mm", note: "Prefer ASA unless you already run ABS. Ventilate." },
};

export function researchPlan(opportunity) {
  const phrase = opportunity.phrase || opportunity.product;
  return {
    label: "Do these searches. Record what you see. Do not type a monthly sales number.",
    searches: [
      { site: "https://www.ebay.com", action: `Search "${phrase}", filter Sold items, write 20 ended prices and whether the shaft or mating feature is visible.` },
      { site: "https://www.amazon.com", action: `Search "${phrase}". Open 10 listings. Record price, stars, review count, pack size, OEM or aftermarket.` },
      { site: "https://trends.google.com", action: `United States, past 12 months, term "${phrase}". Note flat, seasonal, or decaying. Do not convert the index into units.` },
      { site: "https://patents.google.com", action: `Search "${phrase}" and the OEM name. Write patent numbers and status. "Probably expired" is not a result.` },
      { site: "https://tmsearch.uspto.gov", action: "Search the brand name you want on the bag. Do not file a trademark." },
    ],
  };
}

export function cadBrief(opportunity) {
  const m = opportunity.measurements || {};
  const lines = Object.entries(m).map(([key, value]) => `- ${key}: ${value}`);
  return [
    "CAD DESIGN BRIEF",
    `WORKING NAME: ${opportunity.id || "NEW"}`,
    `PART: ${opportunity.product}`,
    `DATE: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "WHAT THE BUYER IS TRYING TO DO",
    opportunity.problem || "(not stated)",
    "",
    "WHAT THIS PART MUST NOT BE",
    opportunity.banSentence || "Not an OEM part. Not for a gas valve, a child product, food contact, or a safety interlock.",
    "",
    "MATERIAL",
    `Production: ${opportunity.material || "PETG"}`,
    "Fit check: PLA allowed only for geometry. Label it NOT FOR SALE.",
    "",
    "DIMENSIONS IN MILLIMETERS (three readings required before this brief is buildable)",
    lines.length ? lines.join("\n") : "- Donor not measured. Do not invent a shaft size.",
    "",
    "CAD REQUIREMENTS",
    "- Start the mating feature 0.2 mm tight. Revise in 0.1 mm steps.",
    "- Minimum wall 2.0 mm on a knob or clip.",
    "- Emboss your brand and the version. No OEM logo.",
    "- Orient so a twist or a snap does not peel layers apart.",
    "- No supports inside a shaft hole.",
    "",
    "ACCEPTANCE",
    "- Three install and remove cycles on the donor.",
    "- Mating feature within 0.3 mm of the target after the fit test.",
    "- If cash profit per printer hour is under $15, stop. Do not pretty the model.",
    "",
    lines.length ? "STATUS: Ready for CAD." : "STATUS: Blocked until the donor is measured.",
  ].join("\n");
}

export function listingDraft(opportunity, economics) {
  const m = opportunity.measurements || {};
  const shaft = m.shaft || m.shaft_type || "shaft not measured";
  const brand = opportunity.brand || "YOUR BRAND";
  const models = opportunity.modelsVerified || "models you have fitted, and no others";
  const title = `${brand} ${opportunity.product}, ${shaft}, compatible with ${models}`.slice(0, 200);
  const bullets = [
    `${opportunity.product}. Mating feature: ${shaft}. ${opportunity.banSentence || "Not an OEM part. Not a gas valve."}`,
    `Fitted by us on: ${models}. Measure your part and compare it to the photo before you install this.`,
    `Material: ${opportunity.material || "PETG"}. Environment tested: ${opportunity.environmentTested || "not yet tested in a machine"}.`,
    "In the package: one printed part and a slip with the measurement and the limits.",
    `Version ${opportunity.version || "v01"}. If the mating feature does not match the photo, do not force it.`,
  ];
  return {
    title,
    bullets,
    price: economics?.price ?? opportunity.price ?? null,
    handling_days: 2,
    inventory_to_print: 0,
    channel: opportunity.channel || "fbm",
    backend_warning: "Do not put competitor brand names in hidden keywords. Compatibility belongs in the visible copy, and only for models you fitted.",
    main_image: "Pure white background, product filling most of the frame, no text, if the category style guide requires it.",
    second_image: "Installed on the donor, mating feature visible.",
  };
}

export function packSlip(opportunity) {
  const m = opportunity.measurements || {};
  return [
    `${opportunity.brand || "YOUR BRAND"} ${opportunity.product}, version ${opportunity.version || "v01"}`,
    `Mating feature: ${m.shaft || m.summary || "see the photo"}`,
    `Fitted by us on: ${opportunity.modelsVerified || "(none yet)"}`,
    `Material: ${opportunity.material || "PETG"}`,
    "Not an OEM part.",
    opportunity.banSentence || "Not for gas valves or any control that operates a flame or a safety interlock.",
    "Measure your part and compare it to the photo before you install this.",
  ].join("\n");
}

export function slicerStart(material) {
  const key = String(material || "PETG").toUpperCase();
  return { material: key, ...(SLICER[key] || SLICER.PETG) };
}

export function qcChecklist(opportunity) {
  return [
    `File version: ${opportunity.version || "v01"}`,
    `Material: ${opportunity.material || "PETG"}`,
    "Correct file is the one sliced",
    "First layer stuck, no lifted corner",
    "No stringing across a mating hole",
    "Mating dimension checked with calipers",
    "Installs on the donor kept in the bin",
    "No crack, brand emboss readable",
    "Weight within 10% of the slicer grams",
    "Slip is in the bag",
    "Failed parts counted and not shipped",
  ];
}
