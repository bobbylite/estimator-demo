import type { Markups } from "./costing";

export interface SampleCrew {
  key: string;
  name: string;
  laborRate: number;
  equipmentRate: number;
}

export interface SampleResource {
  kind: "material" | "subcontractor";
  description: string;
  unitCost: number;
  wastePercent: number;
  pricing: "unit" | "lump";
}

export interface SampleItem {
  code: string;
  description: string;
  quantity: number;
  unit: "LS" | "CY" | "LF" | "SY" | "TON" | "EA" | "AC" | "HR";
  crewKey: string | null;
  productionRate: number;
  resources: SampleResource[];
}

export const sampleMarkups: Markups = {
  overheadPercent: 12.5,
  profitPercent: 8,
  bondPercent: 1.15,
  contingencyPercent: 3,
};

export const sampleCrews: SampleCrew[] = [
  { key: "excavate", name: "Excavation spread", laborRate: 268, equipmentRate: 445 },
  { key: "pipe", name: "Pipe & structure crew", laborRate: 232, equipmentRate: 196 },
  { key: "pave", name: "Paving crew", laborRate: 305, equipmentRate: 620 },
  { key: "traffic", name: "Traffic crew", laborRate: 148, equipmentRate: 72 },
];

export const sampleItems: SampleItem[] = [
  {
    code: "0100",
    description: "Mobilization and general conditions",
    quantity: 1,
    unit: "LS",
    crewKey: null,
    productionRate: 0,
    resources: [
      {
        kind: "subcontractor",
        description: "Mobilization, bonds setup, field office",
        unitCost: 168500,
        wastePercent: 0,
        pricing: "lump",
      },
    ],
  },
  {
    code: "0200",
    description: "Unclassified excavation",
    quantity: 52400,
    unit: "CY",
    crewKey: "excavate",
    productionRate: 310,
    resources: [],
  },
  {
    code: "0210",
    description: "Embankment, compacted in place",
    quantity: 18600,
    unit: "CY",
    crewKey: "excavate",
    productionRate: 165,
    resources: [],
  },
  {
    code: "0220",
    description: "Lime-treated subgrade, 8 inch",
    quantity: 28500,
    unit: "SY",
    crewKey: "excavate",
    productionRate: 420,
    resources: [
      {
        kind: "material",
        description: "Hydrated lime, delivered",
        unitCost: 1.85,
        wastePercent: 4,
        pricing: "unit",
      },
    ],
  },
  {
    code: "0300",
    description: '24" RCP, class III, installed',
    quantity: 4150,
    unit: "LF",
    crewKey: "pipe",
    productionRate: 18,
    resources: [
      {
        kind: "material",
        description: '24" RCP with gaskets',
        unitCost: 92.5,
        wastePercent: 3,
        pricing: "unit",
      },
    ],
  },
  {
    code: "0310",
    description: "Concrete headwalls",
    quantity: 16,
    unit: "EA",
    crewKey: "pipe",
    productionRate: 0.35,
    resources: [
      {
        kind: "material",
        description: "Formed headwall, concrete and steel",
        unitCost: 4800,
        wastePercent: 0,
        pricing: "unit",
      },
    ],
  },
  {
    code: "0400",
    description: "Flexible base, Type A Grade 1",
    quantity: 22800,
    unit: "TON",
    crewKey: "pave",
    productionRate: 120,
    resources: [
      {
        kind: "material",
        description: "Crushed limestone base",
        unitCost: 31.4,
        wastePercent: 8,
        pricing: "unit",
      },
    ],
  },
  {
    code: "0410",
    description: 'Hot-mix asphalt pavement, 3"',
    quantity: 48200,
    unit: "SY",
    crewKey: "pave",
    productionRate: 85,
    resources: [
      {
        kind: "material",
        description: "Type D HMAC, in place",
        unitCost: 18.75,
        wastePercent: 5,
        pricing: "unit",
      },
    ],
  },
  {
    code: "0500",
    description: "Traffic control and barricades, 90 days",
    quantity: 1,
    unit: "LS",
    crewKey: "traffic",
    productionRate: 0,
    resources: [
      {
        kind: "subcontractor",
        description: "Devices, flaggers, and maintenance",
        unitCost: 124000,
        wastePercent: 0,
        pricing: "lump",
      },
    ],
  },
  {
    code: "0600",
    description: "Seeding, fertilizing, and erosion control",
    quantity: 22,
    unit: "AC",
    crewKey: null,
    productionRate: 0,
    resources: [
      {
        kind: "subcontractor",
        description: "Hydromulch and blanket",
        unitCost: 2150,
        wastePercent: 0,
        pricing: "unit",
      },
    ],
  },
  {
    code: "0610",
    description: "Stormwater pollution prevention plan",
    quantity: 1,
    unit: "LS",
    crewKey: null,
    productionRate: 0,
    resources: [
      {
        kind: "subcontractor",
        description: "SWPPP install and weekly inspection",
        unitCost: 48500,
        wastePercent: 0,
        pricing: "lump",
      },
    ],
  },
];

export const sampleEstimate = {
  name: "US 183 Frontage & Drainage — Segment 4",
  clientName: "Williamson County Road Bond Program",
  location: "Cedar Park, Texas",
  bidDate: "2026-11-18",
  status: "review" as const,
  notes:
    "Unit prices include haul within 8 miles of the pit. Rock excavation is not anticipated. Traffic control assumes a 90-day closure on the northbound frontage road.",
  markups: sampleMarkups,
};
