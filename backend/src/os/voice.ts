import { clientCopy } from "./money.js";
import type { ExtractedLead, PropertyUse } from "./types.js";

const USE_LABEL: Record<PropertyUse, string> = {
  primary: "Primary residence",
  second: "Second home",
  investment: "Investment",
};

export function draftClientMessage(lead: ExtractedLead): { body: string; purpose: string } | null {
  if (lead.lowConfidence || lead.optOut) return null;
  const first = lead.name?.split(" ")[0] ?? null;
  const place = placePhrase(lead);
  const time = lead.requestedShowing ?? lead.availableShowing;
  const continuing = lead.conversation === "continuing";
  const spanish = lead.language === "es";
  const clientAlreadyOffered = Boolean(lead.availableShowing) && !lead.confirmedShowing;

  if (clientAlreadyOffered && time) {
    const body = spanish
      ? continuing || !first
        ? `Voy a pedir ${time} y te escribo cuando esté confirmado.`
        : `Hola ${first}, soy Kyle Kleinman con Redfin. Voy a pedir ${time}${place ? ` para la propiedad en ${place.replace(/ property$/, "")}` : ""} y te escribo cuando esté confirmado.`
      : continuing || !first
        ? `I'll request ${time} and text you once it is confirmed.`
        : `Hey ${first}, Kyle Kleinman with Redfin. I'll request ${time}${place ? ` for the ${place}` : ""} and text you once it is confirmed.`;
    return { body: clientCopy(body), purpose: "Request the time the client offered. It is not confirmed yet." };
  }

  let purpose = "Learn the next useful fact";
  let question = "Which areas are you looking in?";
  if (lead.requestedShowing && !lead.confirmedShowing) {
    purpose = "Ask if the requested time works, without calling it confirmed";
    question = `Does ${lead.requestedShowing} work for you if I can get it confirmed?`;
  } else if (lead.confirmedShowing) {
    purpose = "Prepare for a showing the record already calls confirmed";
    question = `Anything you want me to know before ${lead.confirmedShowing}?`;
  } else if (!place) {
    purpose = "Learn the area";
    question = "Which areas are you looking in?";
  } else if (!lead.budgetLabel) {
    purpose = "Learn the budget";
    question = "What price range should I stay inside?";
  } else if (!lead.timeline) {
    purpose = "Learn the timeline";
    question = "When do you want to be in a place?";
  } else if (!lead.propertyUse) {
    purpose = "Learn how they will use the home";
    question = "Is this a primary residence, a second home, or an investment?";
  } else {
    purpose = "Offer the next useful step";
    question = "Want me to send a few that fit what you described?";
  }

  if (spanish) {
    const area = place ? place.replace(/ property$/, "") : null;
    const spanishQuestion = lead.requestedShowing && !lead.confirmedShowing
      ? `¿Te funciona ${lead.requestedShowing} si lo puedo confirmar?`
      : !place
        ? "¿En qué zonas estás buscando?"
        : !lead.budgetLabel
          ? "¿En qué rango de precio debo quedarme?"
          : !lead.timeline
            ? "¿Para cuándo quieres estar en la propiedad?"
            : "¿Quieres que te envíe algunas que encajen con lo que describiste?";
    const body = continuing
      ? spanishQuestion
      : first && area
        ? `Hola ${first}, soy Kyle Kleinman con Redfin. Vi tu solicitud para la propiedad en ${area}. ${spanishQuestion}`
        : first
          ? `Hola ${first}, soy Kyle Kleinman con Redfin. Vi tu solicitud. ${spanishQuestion}`
          : `Hola, soy Kyle Kleinman con Redfin. Vi tu solicitud. ${spanishQuestion}`;
    return { body: clientCopy(body), purpose };
  }

  const body = continuing
    ? question
    : first && place
      ? `Hey ${first}, Kyle Kleinman with Redfin. I saw your request for the ${place}. ${question}`
      : first
        ? `Hey ${first}, Kyle Kleinman with Redfin. I saw your request. ${question}`
        : `Hey, Kyle Kleinman with Redfin. I saw your request. ${question}`;
  return { body: clientCopy(body), purpose };
}

export function placePhrase(lead: ExtractedLead): string | null {
  if (lead.areas) {
    const firstArea = lead.areas.split(",")[0]?.trim();
    if (firstArea) return `${firstArea} property`;
  }
  if (lead.address) return lead.address;
  return null;
}

export function internalNote(lead: ExtractedLead, followUpLabel: string): string {
  if (lead.optOut) return "Do not text. They asked not to be contacted.";
  if (lead.lowConfidence) {
    return "The screenshot could not be read clearly. Paste the text or upload a sharper image before you text anyone.";
  }
  const who = lead.name ?? "This lead";
  const place = placePhrase(lead);
  const showing = lead.confirmedShowing
    ? `A showing is marked confirmed for ${lead.confirmedShowing}.`
    : lead.requestedShowing
      ? `Requested ${lead.requestedShowing}${place ? ` for a ${place}` : ""}. It is not confirmed.`
      : lead.availableShowing
        ? `They can do ${lead.availableShowing}. It is not confirmed.`
        : "No showing time was stated.";
  return `${who}. ${showing} ${followUpLabel}`;
}

export function crmNote(lead: ExtractedLead, followUpLabel: string, demo: boolean): string {
  const line = (label: string, value: string | null | undefined) => `${label}: ${value && value.trim() ? value : "Data needed."}`;
  const showing = lead.confirmedShowing
    ? `Showing confirmed: ${lead.confirmedShowing}.`
    : `Showing requested: ${lead.requestedShowing ?? "Data needed."} Available: ${lead.availableShowing ?? "Data needed."} Confirmed: no.`;
  return [
    demo ? "DEMO record. Not a real client." : "Working note for Redfin. This desk does not write to Redfin.",
    lead.optOut ? "They asked not to be contacted. Do not send a message." : null,
    lead.language === "es" ? "Language: Spanish, as stated." : null,
    line("Name", lead.name),
    line("Phone", lead.phone),
    line("Email", lead.email),
    line("Source", lead.leadSource),
    line("Assigned agent", lead.assignedAgent),
    line("Property", lead.address),
    line("MLS", lead.mls),
    line("Areas", lead.areas),
    showing,
    line("Budget", lead.budgetLabel),
    line("Use", lead.propertyUse ? USE_LABEL[lead.propertyUse] : null),
    line("Financing", lead.financing),
    lead.financingMentionedWithoutApproval ? "Financing was mentioned. Approval was not stated." : null,
    line("Timeline", lead.timeline),
    line("Motivation", lead.motivation),
    line("Must haves", lead.mustHaves),
    line("Deal breakers", lead.dealBreakers),
    line("Previous communication", lead.previousCommunication),
    line("Conversation", lead.conversation === "continuing" ? "Continuing" : "New inquiry"),
    `Next: ${followUpLabel}`,
    lead.unclearNotes.length ? `Review: ${lead.unclearNotes.join(" ")}` : null,
    lead.inlineConflicts.length
      ? `Conflicts in this note: ${lead.inlineConflicts.map((item) => `${item.field} (${item.values.join(" / ")})`).join("; ")}.`
      : null,
  ]
    .filter((lineText): lineText is string => Boolean(lineText))
    .join("\n");
}

export function buyerSummary(lead: ExtractedLead): { known: { label: string; value: string }[]; needed: string[] } {
  const known: { label: string; value: string }[] = [];
  const needed: string[] = [];
  const consider: { label: string; value: string | null; needed?: boolean }[] = [
    { label: "Name", value: lead.name },
    { label: "Phone", value: lead.phone },
    { label: "Email", value: lead.email },
    { label: "Source", value: lead.leadSource },
    { label: "Assigned agent", value: lead.assignedAgent },
    { label: "Property", value: lead.address },
    { label: "MLS", value: lead.mls },
    { label: "Areas", value: lead.areas },
    { label: "Budget", value: lead.budgetLabel },
    { label: "Use", value: lead.propertyUse ? USE_LABEL[lead.propertyUse] : null },
    { label: "Financing", value: lead.financing },
    { label: "Timeline", value: lead.timeline },
    { label: "Motivation", value: lead.motivation },
    { label: "Must haves", value: lead.mustHaves },
    { label: "Deal breakers", value: lead.dealBreakers },
    { label: "Requested showing", value: lead.requestedShowing },
    { label: "Available time", value: lead.availableShowing },
    { label: "Confirmed showing", value: lead.confirmedShowing },
  ];
  for (const item of consider) {
    if (item.value) known.push({ label: item.label, value: item.value });
    else needed.push(item.label);
  }
  if (lead.financingMentionedWithoutApproval) {
    known.push({ label: "Financing note", value: "Mentioned. Approval was not stated." });
    const index = needed.indexOf("Financing");
    if (index >= 0) needed.splice(index, 1);
  }
  if (lead.confirmedShowing) {
    const index = needed.indexOf("Confirmed showing");
    if (index >= 0) needed.splice(index, 1);
  }
  return { known, needed };
}

export function summaryLine(lead: ExtractedLead): string {
  if (lead.lowConfidence) return "Screenshot text is unclear. Nothing was treated as confirmed.";
  const who = lead.name ?? "Unnamed lead";
  const showing = lead.confirmedShowing
    ? `Confirmed showing ${lead.confirmedShowing}.`
    : lead.requestedShowing
      ? `Requested showing ${lead.requestedShowing}. Not confirmed.`
      : lead.availableShowing
        ? `Available ${lead.availableShowing}. Not confirmed.`
        : "No showing time stated.";
  return `${who}. ${showing}`;
}
