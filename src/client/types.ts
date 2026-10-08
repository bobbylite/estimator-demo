import type { ItemCost } from "../shared/costing";

export interface Resource {
  id: string;
  kind: "material" | "subcontractor";
  description: string;
  unitCost: number;
  wastePercent: number;
  pricing: "unit" | "lump";
}

export interface Crew {
  id: string;
  name: string;
  laborRate: number;
  equipmentRate: number;
}

export interface BidItem {
  id: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  crewId: string | null;
  productionRate: number;
  resources: Resource[];
  cost: ItemCost;
}

export interface Estimate {
  id: string;
  name: string;
  clientName: string;
  location: string;
  bidDate: string | null;
  status: "draft" | "review" | "submitted";
  notes: string;
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  contingencyPercent: number;
  createdAt: string;
  updatedAt: string;
  crews: Crew[];
  items: BidItem[];
  totals: ItemCost;
}

export interface EstimateSummary {
  id: string;
  name: string;
  clientName: string;
  location: string;
  bidDate: string | null;
  status: Estimate["status"];
  updatedAt: string;
  itemCount: number;
  totals: ItemCost;
}
