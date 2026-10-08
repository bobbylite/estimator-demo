import { HttpError } from "../http";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

export interface SnapshotResource {
  kind: string;
  description: string;
  unitCost: number;
  pricing: string;
}

export interface SnapshotItem {
  id: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  crewId: string | null;
  crewName: string | null;
  productionRate: number;
  resources: SnapshotResource[];
}

export interface EstimateSnapshot {
  name: string;
  clientName: string;
  location: string;
  notes: string;
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  contingencyPercent: number;
  crews: Array<{ id: string; name: string }>;
  items: SnapshotItem[];
}

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export interface SystemOneResult {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { inputTokens: number; outputTokens: number };
}

export type Proposal =
  | { type: "bid_call"; call: string; reasons: string; changed: boolean }
  | { type: "contingency"; percent: number; changed: boolean }
  | { type: "markup"; field: "overheadPercent" | "profitPercent"; percent: number; changed: boolean }
  | { type: "production"; itemId: string; code: string; productionRate: number; changed: boolean }
  | { type: "route"; itemId: string; code: string; route: string; changed: boolean }
  | { type: "wbs"; itemId: string; code: string; wbs: string; changed: boolean }
  | { type: "vendor"; itemId: string; code: string; source: string; changed: boolean }
  | { type: "crew"; itemId: string; code: string; crewId: string | null; crewName: string; changed: boolean }
  | { type: "flag"; itemId: string; code: string; flag: "outlier" | "ok"; changed: boolean };

export interface DraftDecision {
  questionId: string;
  itemId: string | null;
  itemCode: string | null;
  kind: string;
  title: string;
  summary: string;
  confidence: number;
  threshold: number;
  status: "applied" | "review";
  actor: "jev";
  proposal: Proposal;
}

const CONTINGENCY_LEVELS = [2, 3, 4.5, 6];

/** Noul answers have no confidence field. Distance from 0.5 is |2p − 1|. */
export function noulConfidence(probability: number): number {
  if (!Number.isFinite(probability)) return 0;
  return Math.min(1, Math.max(0, Math.abs(2 * probability - 1)));
}

export function answerConfidence(answer: JevAnswer): number {
  if (answer.type === "noul") return noulConfidence(answer.noul);
  if (!Number.isFinite(answer.confidence)) return 0;
  return Math.min(1, Math.max(0, answer.confidence));
}

export function buildState(estimate: EstimateSnapshot) {
  return {
    name: estimate.name,
    clientName: estimate.clientName,
    location: estimate.location,
    notes: estimate.notes,
    markups: {
      overheadPercent: estimate.overheadPercent,
      profitPercent: estimate.profitPercent,
      bondPercent: estimate.bondPercent,
      contingencyPercent: estimate.contingencyPercent,
    },
    crews: estimate.crews,
    items: estimate.items.map((item) => ({
      code: item.code,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      crew: item.crewName,
      productionRate: item.productionRate,
      resources: item.resources,
    })),
  };
}

export function buildQuestions(estimate: EstimateSnapshot): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    bid_call: {
      type: "choice",
      instructions: `Should Meridian bid ${estimate.name} for ${estimate.clientName} in ${estimate.location}? Use the notes and the item mix.`,
      criteria: {
        bid: "The package is a normal bid",
        no_bid: "Decline the package",
        bid_with_conditions: "Bid, and name the qualifications",
      },
    },
    contingency: {
      type: "score",
      instructions: "How much contingency belongs on direct cost for this package?",
      criteria: ["2% — lean", "3% — typical", "4.5% — haul and traffic risk", "6% — open exposure"],
    },
    overhead: {
      type: "choice",
      instructions: `Overhead is ${estimate.overheadPercent}%. What should it be?`,
      criteria: {
        "12.5": "Hold a light office burden",
        "14": "Raise overhead for the field office and traffic window",
        "16": "Heavy general conditions",
      },
    },
    profit: {
      type: "choice",
      instructions: `Profit is ${estimate.profitPercent}%. What should it be?`,
      criteria: {
        "8": "Hold the current profit",
        "10": "Raise profit",
        "6": "Sharpen the bid",
      },
    },
  };
  for (const item of estimate.items) {
    const label = `${item.code} ${item.description}`;
    questions[`wbs:${item.code}`] = {
      type: "choice",
      instructions: `Map ${label} to a WBS / cost code.`,
      criteria:
        item.code === "0200"
          ? {
              keep: "Keep the current code",
              "02.10": "Earthwork — unclassified excavation",
              "02.20": "Earthwork — embankment",
            }
          : {
              keep: "Keep the current code",
              suggested: `File it under a WBS node for ${item.description}`,
            },
    };
    questions[`route:${item.code}`] = {
      type: "choice",
      instructions: `How should ${label} be built: self-perform, subcontract, or material only?`,
      criteria: {
        self_perform: "Own crew and equipment",
        subcontract: "A subcontractor carries the item",
        material: "Material supply only",
      },
    };
    questions[`outlier:${item.code}`] = {
      type: "noul",
      instructions: `Is the quantity or unit cost on ${label} far from a typical heavy-civil price? Quantity ${item.quantity} ${item.unit}.`,
      criteria: {
        true: "Wrong unit, missing digit, or a price far from typical",
        false: "The quantity and prices are plausible",
      },
    };
    if (item.productionRate > 0) {
      questions[`production:${item.code}`] = {
        type: "choice",
        instructions: `Manual production on ${label} is ${item.productionRate} ${item.unit} per hour with ${item.crewName ?? "no crew"}. Check it.`,
        criteria: {
          keep: "The manual rate is reasonable",
          lower_10: "Lower the rate about 10 percent",
          raise_10: "Raise the rate about 10 percent",
        },
      };
    }
    if (item.resources.some((resource) => resource.kind === "material")) {
      questions[`vendor:${item.code}`] = {
        type: "choice",
        instructions: `Are the material prices on ${label} vendor quotes or plug numbers?`,
        criteria: {
          quote: "Use the vendor quote",
          plug: "Treat the number as a plug until a quote arrives",
          hold: "Leave the price as entered",
        },
      };
    }
    if (item.crewId) {
      const criteria: Record<string, string> = { keep: "Keep the assigned crew" };
      for (const crew of estimate.crews) criteria[crew.id] = crew.name;
      questions[`crew:${item.code}`] = {
        type: "choice",
        instructions: `Which crew and equipment spread should build ${label}? It is on ${item.crewName ?? "no crew"}.`,
        criteria,
      };
    }
  }
  return questions;
}

export async function systemOne(input: {
  fetchImpl: typeof fetch;
  apiKey: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
}): Promise<SystemOneResult> {
  const response = await input.fetchImpl(JEV_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ model: JEV_MODEL, state: input.state, questions: input.questions }),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }
  if (!response.ok || !json || typeof json !== "object") {
    throw new HttpError(502, "Jev did not return a decision. Try again in a moment.");
  }
  const record = json as Record<string, unknown>;
  const answers = record.answers;
  if (!answers || typeof answers !== "object") {
    throw new HttpError(502, "Jev did not return a decision. Try again in a moment.");
  }
  const usage = record.usage;
  const usageRecord = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  return {
    model: typeof record.model === "string" ? record.model : JEV_MODEL,
    answers: answers as Record<string, JevAnswer>,
    usage: {
      inputTokens: numberField(usageRecord.input_tokens),
      outputTokens: numberField(usageRecord.output_tokens),
    },
  };
}

export async function evaluateEstimate(input: {
  authorize: () => Promise<void>;
  fetchImpl: typeof fetch;
  apiKey?: string;
  mock: boolean;
  estimate: EstimateSnapshot;
  threshold: number;
}): Promise<{ decisions: DraftDecision[]; usage: { inputTokens: number; outputTokens: number } }> {
  await input.authorize();
  const questions = buildQuestions(input.estimate);
  const state = buildState(input.estimate);
  const key = input.apiKey?.trim();
  let result: SystemOneResult;
  if (input.mock) {
    result = mockSystemOne(input.estimate, questions);
  } else if (!key) {
    throw new HttpError(503, "Set the JEV_API_KEY Worker secret to call Jev.");
  } else {
    result = await systemOne({ fetchImpl: input.fetchImpl, apiKey: key, state, questions });
  }
  return {
    decisions: routeDecisions(result.answers, questions, input.estimate, input.threshold),
    usage: result.usage,
  };
}

export function mockSystemOne(
  estimate: EstimateSnapshot,
  questions: Record<string, JevQuestion>,
): SystemOneResult {
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    answers[id] = mockAnswer(id, question, estimate);
  }
  return {
    model: JEV_MODEL,
    answers,
    usage: { inputTokens: 860, outputTokens: 140 },
  };
}

export function routeDecisions(
  answers: Record<string, JevAnswer>,
  questions: Record<string, JevQuestion>,
  estimate: EstimateSnapshot,
  threshold: number,
): DraftDecision[] {
  const decisions: DraftDecision[] = [];
  for (const [id, answer] of Object.entries(answers)) {
    const question = questions[id];
    if (!question || !answer || answer.type !== question.type) continue;
    const drafted = draftFor(id, answer, question, estimate, threshold);
    if (!drafted) continue;
    const confidence = answerConfidence(answer);
    if (!drafted.proposal.changed && confidence >= threshold && drafted.kind !== "bid_call") continue;
    drafted.confidence = round3(confidence);
    drafted.status = confidence >= threshold ? "applied" : "review";
    decisions.push(drafted);
  }
  return decisions;
}

function draftFor(
  id: string,
  answer: JevAnswer,
  question: JevQuestion,
  estimate: EstimateSnapshot,
  threshold: number,
): DraftDecision | null {
  const confidence = answerConfidence(answer);
  const base = {
    questionId: id,
    confidence,
    threshold,
    status: "review" as const,
    actor: "jev" as const,
  };
  if (id === "bid_call" && answer.type === "choice") {
    const reasons = choiceText(question, answer.choice);
    return {
      ...base,
      itemId: null,
      itemCode: null,
      kind: "bid_call",
      title: "Bid or no-bid",
      summary: `${labelCall(answer.choice)}. ${reasons}`,
      proposal: { type: "bid_call", call: answer.choice, reasons, changed: true },
    };
  }
  if (id === "contingency" && answer.type === "score") {
    const index = Math.min(CONTINGENCY_LEVELS.length - 1, Math.max(0, Math.round(answer.score)));
    const percent = CONTINGENCY_LEVELS[index] ?? estimate.contingencyPercent;
    const changed = percent !== estimate.contingencyPercent;
    return {
      ...base,
      itemId: null,
      itemCode: null,
      kind: "contingency",
      title: "Contingency",
      summary: changed
        ? `Move contingency from ${estimate.contingencyPercent}% to ${percent}% for haul and the traffic window.`
        : `Keep contingency at ${percent}%.`,
      proposal: { type: "contingency", percent, changed },
    };
  }
  if ((id === "overhead" || id === "profit") && answer.type === "choice") {
    const field = id === "overhead" ? "overheadPercent" : "profitPercent";
    const percent = Number(answer.choice);
    if (!Number.isFinite(percent)) return null;
    const current = field === "overheadPercent" ? estimate.overheadPercent : estimate.profitPercent;
    const changed = percent !== current;
    const name = id === "overhead" ? "Overhead" : "Profit";
    return {
      ...base,
      itemId: null,
      itemCode: null,
      kind: "markup",
      title: name,
      summary: changed ? `Move ${name.toLowerCase()} from ${current}% to ${percent}%.` : `Keep ${name.toLowerCase()} at ${percent}%.`,
      proposal: { type: "markup", field, percent, changed },
    };
  }
  const [kind, code] = id.split(":");
  const item = estimate.items.find((candidate) => candidate.code === code);
  if (!item || !kind) return null;
  if (kind === "production" && answer.type === "choice") {
    const rate =
      answer.choice === "lower_10"
        ? roundRate(item.productionRate * 0.9)
        : answer.choice === "raise_10"
          ? roundRate(item.productionRate * 1.1)
          : item.productionRate;
    const changed = rate !== item.productionRate;
    return {
      ...base,
      itemId: item.id,
      itemCode: item.code,
      kind: "production",
      title: `${item.description} production`,
      summary: changed
        ? `Manual rate is ${item.productionRate} ${item.unit}/hr. Jev suggests ${rate}.`
        : `Manual rate ${item.productionRate} ${item.unit}/hr checks out.`,
      proposal: { type: "production", itemId: item.id, code: item.code, productionRate: rate, changed },
    };
  }
  if (kind === "route" && answer.type === "choice") {
    const route = answer.choice;
    const current = inferRoute(item);
    return {
      ...base,
      itemId: item.id,
      itemCode: item.code,
      kind: "route",
      title: `${item.description} route`,
      summary: `${item.description}: ${labelRoute(route)}.`,
      proposal: { type: "route", itemId: item.id, code: item.code, route, changed: route !== current || Boolean(SPECIAL_ROUTE[item.code]) },
    };
  }
  if (kind === "wbs" && answer.type === "choice") {
    const changed = answer.choice !== "keep";
    return {
      ...base,
      itemId: item.id,
      itemCode: item.code,
      kind: "wbs",
      title: `${item.description} cost code`,
      summary: changed ? `Map ${item.code} to WBS ${answer.choice}.` : `Keep cost code ${item.code}.`,
      proposal: { type: "wbs", itemId: item.id, code: item.code, wbs: changed ? answer.choice : item.code, changed },
    };
  }
  if (kind === "vendor" && answer.type === "choice") {
    const changed = answer.choice !== "hold";
    return {
      ...base,
      itemId: item.id,
      itemCode: item.code,
      kind: "vendor",
      title: `${item.description} price source`,
      summary:
        answer.choice === "plug"
          ? "Treat the material number as a plug until a vendor quote is in."
          : answer.choice === "quote"
            ? "Use the vendor quote for this material."
            : "Leave the entered price.",
      proposal: { type: "vendor", itemId: item.id, code: item.code, source: answer.choice, changed },
    };
  }
  if (kind === "crew" && answer.type === "choice") {
    const changed = answer.choice !== "keep" && answer.choice !== item.crewId;
    const crew = estimate.crews.find((candidate) => candidate.id === answer.choice);
    return {
      ...base,
      itemId: item.id,
      itemCode: item.code,
      kind: "crew",
      title: `${item.description} crew`,
      summary: changed
        ? `Put ${item.description} on ${crew?.name ?? "another crew"}.`
        : `Keep ${item.crewName ?? "the current crew"}.`,
      proposal: {
        type: "crew",
        itemId: item.id,
        code: item.code,
        crewId: changed ? (crew?.id ?? null) : item.crewId,
        crewName: changed ? (crew?.name ?? "Unassigned") : (item.crewName ?? "Unassigned"),
        changed,
      },
    };
  }
  if (kind === "outlier" && answer.type === "noul") {
    const outlier = answer.noul >= 0.5;
    return {
      ...base,
      itemId: item.id,
      itemCode: item.code,
      kind: "outlier",
      title: `${item.description} outlier check`,
      summary: outlier
        ? `Quantity or unit cost on ${item.code} looks off typical. Check the unit before it goes out.`
        : `Quantity and unit cost on ${item.code} look plausible.`,
      proposal: { type: "flag", itemId: item.id, code: item.code, flag: outlier ? "outlier" : "ok", changed: outlier },
    };
  }
  return null;
}

const SPECIAL_ROUTE: Record<string, string> = {
  "0500": "subcontract",
  "0220": "subcontract",
};

function mockAnswer(id: string, question: JevQuestion, estimate: EstimateSnapshot): JevAnswer {
  if (id === "bid_call") return choiceAnswer("bid_with_conditions", { bid: 0.06, no_bid: 0.03, bid_with_conditions: 0.91 }, 0.91);
  if (id === "contingency") {
    return {
      type: "score",
      score: 2.05,
      legend: { "0": "2% — lean", "1": "3% — typical", "2": "4.5% — haul and traffic risk", "3": "6% — open exposure" },
      probabilities: { "0": 0.02, "1": 0.08, "2": 0.84, "3": 0.06 },
      confidence: 0.88,
    };
  }
  if (id === "overhead") return choiceAnswer("14", { "12.5": 0.3, "14": 0.55, "16": 0.15 }, 0.55);
  if (id === "profit") return choiceAnswer("8", { "8": 0.86, "10": 0.1, "6": 0.04 }, 0.86);
  if (id === "production:0400") return choiceAnswer("lower_10", { keep: 0.05, lower_10: 0.92, raise_10: 0.03 }, 0.92);
  if (id === "production:0200") return choiceAnswer("lower_10", { keep: 0.28, lower_10: 0.61, raise_10: 0.11 }, 0.61);
  if (id === "route:0500") return choiceAnswer("subcontract", { self_perform: 0.04, subcontract: 0.93, material: 0.03 }, 0.93);
  if (id === "route:0220") return choiceAnswer("subcontract", { self_perform: 0.3, subcontract: 0.64, material: 0.06 }, 0.64);
  if (id === "wbs:0200") return choiceAnswer("02.10", { keep: 0.04, "02.10": 0.94, "02.20": 0.02 }, 0.94);
  if (id === "outlier:0310") return { type: "noul", noul: 0.96 };
  if (id === "outlier:0410") return { type: "noul", noul: 0.58 };
  if (id === "vendor:0400") return choiceAnswer("plug", { quote: 0.32, plug: 0.57, hold: 0.11 }, 0.57);
  if (id === "crew:0310") {
    const excavate = estimate.crews.find((crew) => /excavat/i.test(crew.name));
    if (excavate && question.type === "choice" && question.criteria[excavate.id]) {
      return choiceAnswer(excavate.id, { keep: 0.34, [excavate.id]: 0.66 }, 0.66);
    }
  }
  if (id.startsWith("route:")) {
    const item = estimate.items.find((candidate) => candidate.code === id.slice("route:".length));
    const route = item ? inferRoute(item) : "self_perform";
    return choiceAnswer(route, { [route]: 0.9 }, 0.9);
  }
  if (id.startsWith("vendor:")) return choiceAnswer("hold", { hold: 0.9, quote: 0.05, plug: 0.05 }, 0.9);
  if (question.type === "noul") return { type: "noul", noul: 0.08 };
  if (question.type === "score") {
    return {
      type: "score",
      score: 1,
      legend: Object.fromEntries(question.criteria.map((level, index) => [String(index), level])),
      probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), index === 1 ? 0.9 : 0.1 / Math.max(1, question.criteria.length - 1)])),
      confidence: 0.9,
    };
  }
  const keep = Object.keys(question.criteria)[0] ?? "keep";
  const preferred = question.criteria.keep !== undefined ? "keep" : keep;
  return choiceAnswer(preferred, { [preferred]: 0.9 }, 0.9);
}

function choiceAnswer(choice: string, probabilities: Record<string, number>, confidence: number): JevAnswer {
  return { type: "choice", choice, probabilities, confidence };
}

function choiceText(question: JevQuestion, choice: string): string {
  if (question.type !== "choice") return "";
  return question.criteria[choice] ?? choice;
}

function inferRoute(item: SnapshotItem): string {
  const hasCrew = Boolean(item.crewId);
  const hasSub = item.resources.some((resource) => resource.kind === "subcontractor");
  const hasMaterial = item.resources.some((resource) => resource.kind === "material");
  if (hasSub && !hasCrew) return "subcontract";
  if (hasMaterial && !hasCrew && !hasSub) return "material";
  if (hasCrew) return "self_perform";
  return "subcontract";
}

function labelRoute(route: string): string {
  if (route === "self_perform") return "self-perform";
  if (route === "subcontract") return "subcontract";
  if (route === "material") return "material only";
  return route;
}

function labelCall(call: string): string {
  if (call === "bid") return "Bid";
  if (call === "no_bid") return "No-bid";
  if (call === "bid_with_conditions") return "Bid with conditions";
  return call;
}

function roundRate(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
