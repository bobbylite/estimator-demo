import { describe, expect, it } from "vitest";
import { money, priceEstimate, priceItem, resourceAmount } from "../src/shared/costing";
import { sampleCrews, sampleEstimate, sampleItems } from "../src/shared/sample";

const markups = {
  overheadPercent: 10,
  profitPercent: 10,
  bondPercent: 10,
  contingencyPercent: 10,
};

describe("estimate cost math", () => {
  it("prices crew time, material waste, and lump subcontract", () => {
    const cost = priceItem(
      {
        id: "item",
        code: "1",
        description: "Haul",
        quantity: 10,
        unit: "CY",
        crewId: "crew",
        productionRate: 2,
        resources: [
          {
            id: "mat",
            kind: "material",
            description: "Stone",
            unitCost: 3,
            wastePercent: 10,
            pricing: "unit",
          },
          {
            id: "sub",
            kind: "subcontractor",
            description: "Flagging",
            unitCost: 7,
            wastePercent: 50,
            pricing: "lump",
          },
        ],
      },
      { id: "crew", name: "Spread", laborRate: 10, equipmentRate: 5 },
      markups,
    );

    expect(cost.hours).toBe(5);
    expect(cost.labor).toBe(50);
    expect(cost.equipment).toBe(25);
    expect(cost.material).toBe(33);
    expect(cost.subcontractor).toBe(7);
    expect(cost.direct).toBe(115);
    expect(cost.overhead).toBe(11.5);
    expect(cost.profit).toBe(12.65);
    expect(cost.bond).toBe(13.92);
    expect(cost.contingency).toBe(11.5);
    expect(cost.bid).toBe(164.57);
    expect(cost.unitPrice).toBe(16.46);
  });

  it("does not apply waste to subcontractors and skips labor without a crew", () => {
    expect(
      resourceAmount(
        {
          id: "sub",
          kind: "subcontractor",
          description: "Seed",
          unitCost: 10,
          wastePercent: 25,
          pricing: "unit",
        },
        4,
      ),
    ).toBe(40);

    const cost = priceItem(
      {
        id: "item",
        code: "2",
        description: "Lump",
        quantity: 8,
        unit: "LS",
        crewId: null,
        productionRate: 4,
        resources: [],
      },
      undefined,
      markups,
    );
    expect(cost.hours).toBe(0);
    expect(cost.labor).toBe(0);
    expect(cost.equipment).toBe(0);
    expect(cost.bid).toBe(0);
  });

  it("sums item bids into the estimate total", () => {
    const priced = priceEstimate(
      [
        {
          id: "a",
          code: "A",
          description: "A",
          quantity: 10,
          unit: "CY",
          crewId: "crew",
          productionRate: 2,
          resources: [],
        },
        {
          id: "b",
          code: "B",
          description: "B",
          quantity: 1,
          unit: "LS",
          crewId: null,
          productionRate: 0,
          resources: [
            {
              id: "sub",
              kind: "subcontractor",
              description: "Mob",
              unitCost: 100,
              wastePercent: 0,
              pricing: "lump",
            },
          ],
        },
      ],
      [{ id: "crew", name: "Spread", laborRate: 10, equipmentRate: 0 }],
      { overheadPercent: 0, profitPercent: 0, bondPercent: 0, contingencyPercent: 0 },
    );
    expect(priced.totals.labor).toBe(50);
    expect(priced.totals.subcontractor).toBe(100);
    expect(priced.totals.direct).toBe(150);
    expect(priced.totals.bid).toBe(priced.items.reduce((sum, item) => money(sum + item.cost.bid), 0));
  });

  it("prices the seeded heavy-civil estimate as a coherent bid", () => {
    const priced = priceEstimate(
      sampleItems.map((item) => ({
        id: item.code,
        code: item.code,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        crewId: item.crewKey,
        productionRate: item.productionRate,
        resources: item.resources.map((resource, index) => ({ ...resource, id: `${item.code}-${index}` })),
      })),
      sampleCrews.map((crew) => ({
        id: crew.key,
        name: crew.name,
        laborRate: crew.laborRate,
        equipmentRate: crew.equipmentRate,
      })),
      sampleEstimate.markups,
    );
    expect(priced.totals.direct).toBeGreaterThan(1_000_000);
    expect(priced.totals.bid).toBeGreaterThan(priced.totals.direct);
    expect(priced.totals.labor).toBeGreaterThan(0);
    expect(priced.totals.equipment).toBeGreaterThan(0);
    expect(priced.totals.material).toBeGreaterThan(0);
    expect(priced.totals.subcontractor).toBeGreaterThan(0);
    const rebuilt = money(
      priced.totals.direct +
        priced.totals.overhead +
        priced.totals.profit +
        priced.totals.bond +
        priced.totals.contingency,
    );
    expect(priced.totals.bid).toBe(rebuilt);
  });
});
