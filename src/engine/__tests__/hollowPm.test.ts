import { describe, expect, it } from "vitest";
import { rectangleRings, sectionArea } from "../geometry";
import { generateHollowRectangleRebars } from "../rebarLayout";
import { computePM } from "../pm";
import type { MaterialSet, PMOptions } from "../types";

const materials: MaterialSet = {
  concrete: { fc: 30, ecu: 0.0033 },
  steel: { fy: 400, es: 200000 },
};
const options: PMOptions = { designCode: "kds_strength", points: 40, transverseReinforcement: "tie" };

const B = 3000;
const H = 4000;
const T = 400;
const rebars = generateHollowRectangleRebars(B, H, T, {
  outerDc: 100,
  innerDc: 100,
  diameter: 25,
  nx: 8,
  ny: 10,
});

describe("중공 단면 P-M", () => {
  const hollow = computePM({ rings: rectangleRings(B, H, T), rebars }, materials, options);
  const solid = computePM({ rings: rectangleRings(B, H), rebars }, materials, options);

  it("계산이 성립한다", () => {
    expect(hollow.length).toBe(42);
    expect(hollow.every((p) => Number.isFinite(p.pn) && Number.isFinite(p.mn))).toBe(true);
  });

  it("순압축 강도가 속찬 단면보다 작다", () => {
    const hollowP0 = hollow.find((p) => p.id === "pure-compression")!.pn;
    const solidP0 = solid.find((p) => p.id === "pure-compression")!.pn;
    expect(hollowP0).toBeLessThan(solidP0);

    // 차이는 정확히 중공 면적 x alpha*fcd 만큼이어야 한다.
    const holeArea = (B - 2 * T) * (H - 2 * T);
    const expectedDrop = (0.85 * materials.concrete.fc * holeArea) / 1000;
    expect(solidP0 - hollowP0).toBeCloseTo(expectedDrop, 6);
  });

  it("순인장 강도는 철근만의 함수이므로 속찬 단면과 같다", () => {
    const a = hollow.find((p) => p.id === "pure-tension")!;
    const b = solid.find((p) => p.id === "pure-tension")!;
    expect(a.pn).toBeCloseTo(b.pn, 9);
  });

  it("중립축이 얕아 중공에 닿지 않는 구간은 속찬 단면과 동일하다", () => {
    // 중공 상단은 y = (H/2 - T) = 1600. 등가블록 하단이 그보다 위면 홀 기여 없음.
    const shallow = hollow.filter((p) => Number.isFinite(p.c) && 0.8 * p.c < H / 2 - (H / 2 - T));
    expect(shallow.length).toBeGreaterThan(0);
    for (const point of shallow) {
      const match = solid.find((q) => q.id === point.id)!;
      expect(point.pn).toBeCloseTo(match.pn, 9);
      expect(point.mn).toBeCloseTo(match.mn, 9);
    }
  });

  it("순 단면적이 해석해와 일치한다", () => {
    expect(sectionArea(rectangleRings(B, H, T))).toBeCloseTo(B * H - (B - 2 * T) * (H - 2 * T), 6);
  });

  it("압축측 곡선이 단조롭게 진행한다(발산/NaN 없음)", () => {
    const sweep = hollow.filter((p) => p.id.startsWith("pm-"));
    for (let i = 1; i < sweep.length; i += 1) {
      expect(sweep[i].pn).toBeGreaterThan(sweep[i - 1].pn);
    }
  });
});
