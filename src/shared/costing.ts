/**
 * Heavy-civil bid math shared by the SPA (live preview) and the Worker (persisted totals).
 *
 * Crew cost follows the production-rate model used by tools like HeavyBid:
 * hours = quantity / production rate, then labor and equipment are that duration
 * times the blended crew rates (the whole spread, not one person).
 *
 * Markup stack, applied to each bid item and summed:
 *   direct       = labor + equipment + material + subcontract
 *   overhead     = direct × overhead%
 *   profit       = (direct + overhead) × profit%
 *   bond         = (direct + overhead + profit) × bond%
 *   contingency  = direct × contingency%
 *   bid          = direct + overhead + profit + bond + contingency
 *
 * Money is rounded to cents at each component so the displayed parts add back to the bid.
 */

export type ResourceKind = "material" | "subcontractor";
export type Pricing = "unit" | "lump";

export interface CostResource {
  id: string;
  kind: ResourceKind;
  description: string;
  unitCost: number;
  wastePercent: number;
  pricing: Pricing;
}

export interface CostCrew {
  id: string;
  name: string;
  laborRate: number;
  equipmentRate: number;
}

export interface CostItem {
  id: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  crewId: string | null;
  productionRate: number;
  resources: CostResource[];
}

export interface Markups {
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  contingencyPercent: number;
}

export interface ItemCost {
  hours: number;
  labor: number;
  equipment: number;
  material: number;
  subcontractor: number;
  direct: number;
  overhead: number;
  profit: number;
  bond: number;
  contingency: number;
  bid: number;
  unitPrice: number;
}

export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function resourceAmount(resource: CostResource, quantity: number): number {
  if (resource.pricing === "lump") return money(resource.unitCost);
  const waste =
    resource.kind === "material" ? 1 + safePercent(resource.wastePercent) / 100 : 1;
  return money(quantity * resource.unitCost * waste);
}

export function priceItem(
  item: CostItem,
  crew: CostCrew | undefined,
  markups: Markups,
): ItemCost {
  const hours =
    crew && item.productionRate > 0 ? item.quantity / item.productionRate : 0;
  const labor = crew ? money(hours * crew.laborRate) : 0;
  const equipment = crew ? money(hours * crew.equipmentRate) : 0;

  let material = 0;
  let subcontractor = 0;
  for (const resource of item.resources) {
    const amount = resourceAmount(resource, item.quantity);
    if (resource.kind === "material") material = money(material + amount);
    else subcontractor = money(subcontractor + amount);
  }

  const direct = money(labor + equipment + material + subcontractor);
  const overhead = money(direct * (safePercent(markups.overheadPercent) / 100));
  const profit = money((direct + overhead) * (safePercent(markups.profitPercent) / 100));
  const bond = money((direct + overhead + profit) * (safePercent(markups.bondPercent) / 100));
  const contingency = money(direct * (safePercent(markups.contingencyPercent) / 100));
  const bid = money(direct + overhead + profit + bond + contingency);
  const unitPrice = item.quantity > 0 ? money(bid / item.quantity) : bid;

  return {
    hours,
    labor,
    equipment,
    material,
    subcontractor,
    direct,
    overhead,
    profit,
    bond,
    contingency,
    bid,
    unitPrice,
  };
}

export interface PricedItem extends CostItem {
  cost: ItemCost;
}

export interface PricedEstimate {
  items: PricedItem[];
  totals: ItemCost;
}

export function priceEstimate(
  items: CostItem[],
  crews: CostCrew[],
  markups: Markups,
): PricedEstimate {
  const byId = new Map(crews.map((crew) => [crew.id, crew]));
  const priced = items.map((item) => ({
    ...item,
    cost: priceItem(item, item.crewId ? byId.get(item.crewId) : undefined, markups),
  }));
  return { items: priced, totals: sumCosts(priced.map((item) => item.cost)) };
}

export function sumCosts(costs: ItemCost[]): ItemCost {
  const totals = costs.reduce(
    (acc, cost) => ({
      hours: acc.hours + cost.hours,
      labor: money(acc.labor + cost.labor),
      equipment: money(acc.equipment + cost.equipment),
      material: money(acc.material + cost.material),
      subcontractor: money(acc.subcontractor + cost.subcontractor),
      direct: money(acc.direct + cost.direct),
      overhead: money(acc.overhead + cost.overhead),
      profit: money(acc.profit + cost.profit),
      bond: money(acc.bond + cost.bond),
      contingency: money(acc.contingency + cost.contingency),
      bid: money(acc.bid + cost.bid),
      unitPrice: 0,
    }),
    emptyCost(),
  );
  return totals;
}

export function emptyCost(): ItemCost {
  return {
    hours: 0,
    labor: 0,
    equipment: 0,
    material: 0,
    subcontractor: 0,
    direct: 0,
    overhead: 0,
    profit: 0,
    bond: 0,
    contingency: 0,
    bid: 0,
    unitPrice: 0,
  };
}

function safePercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}
