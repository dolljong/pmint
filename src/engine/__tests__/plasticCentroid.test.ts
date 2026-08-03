import { describe, expect, it } from "vitest";
import { rectangleRings, sectionCentroid } from "../geometry";
import { designCodes } from "../designCodes";
import { plasticCentroid, pureCompression } from "../section";
import { computePM } from "../pm";
import type { DesignCodeId, MaterialSet, Rebar, SectionModel } from "../types";

const materials: MaterialSet = {
  concrete: { fc: 30, ecu: 0.0033 },
  steel: { fy: 400, es: 200000 },
};

const symmetricBars: Rebar[] = [
  { id: "R1", x: -150, y: -250, diameter: 25 },
  { id: "R2", x: 150, y: -250, diameter: 25 },
  { id: "R3", x: -150, y: 250, diameter: 25 },
  { id: "R4", x: 150, y: 250, diameter: 25 },
];

const asymmetricBars: Rebar[] = [
  { id: "R1", x: -150, y: -250, diameter: 16 },
  { id: "R2", x: 150, y: -250, diameter: 16 },
  { id: "R3", x: -150, y: 250, diameter: 32 },
  { id: "R4", x: 150, y: 250, diameter: 32 },
  { id: "R5", x: 0, y: 250, diameter: 32 },
];

describe("소성중심", () => {
  it("대칭 배근이면 기하 도심과 일치한다", () => {
    const section: SectionModel = { rings: rectangleRings(400, 600), rebars: symmetricBars };
    const pc = plasticCentroid(section, materials, designCodes.kds_strength);
    const geo = sectionCentroid(section.rings);
    expect(pc.x).toBeCloseTo(geo.x, 9);
    expect(pc.y).toBeCloseTo(geo.y, 9);
  });

  it("비대칭 배근이면 철근이 많은 쪽으로 이동한다", () => {
    const section: SectionModel = { rings: rectangleRings(400, 600), rebars: asymmetricBars };
    const pc = plasticCentroid(section, materials, designCodes.kds_strength);
    expect(pc.x).toBeCloseTo(0, 9); // x 방향은 여전히 대칭
    expect(pc.y).toBeGreaterThan(0); // 상단 배근이 크므로 위로 이동
  });

  it("중공 단면에서도 성립한다", () => {
    const section: SectionModel = { rings: rectangleRings(3000, 4000, 400), rebars: symmetricBars };
    const pc = plasticCentroid(section, materials, designCodes.kds_strength);
    expect(pc.x).toBeCloseTo(0, 6);
    expect(pc.y).toBeCloseTo(0, 6);
  });

  for (const designCode of ["kds_strength", "bridge_lsd"] as DesignCodeId[]) {
    for (const [label, rebars] of [
      ["대칭", symmetricBars],
      ["비대칭", asymmetricBars],
    ] as const) {
      it(`${designCode}/${label}: 순압축점의 모멘트가 정확히 0 이다`, () => {
        const section: SectionModel = { rings: rectangleRings(400, 600), rebars };
        const code = designCodes[designCode];
        const response = pureCompression(section, materials, code, { transverseReinforcement: "tie" });
        // Pn0 규모(수천 kN)에 대해 상대적으로 0 이어야 한다.
        expect(Math.abs(response.mnx) / Math.abs(response.pn)).toBeLessThan(1e-12);
        expect(Math.abs(response.mny) / Math.abs(response.pn)).toBeLessThan(1e-12);
      });
    }
  }

  it("P-M 곡선의 순압축점도 Mn = 0 이다 (비대칭 배근)", () => {
    const data = computePM(
      { rings: rectangleRings(400, 600), rebars: asymmetricBars },
      materials,
      { designCode: "kds_strength", points: 40, transverseReinforcement: "tie" },
    );
    const p0 = data.find((p) => p.id === "pure-compression")!;
    expect(Math.abs(p0.mn) / Math.abs(p0.pn)).toBeLessThan(1e-12);
  });
});
