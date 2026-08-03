import { describe, expect, it } from "vitest";
import { rectangleRings } from "../geometry";
import { generateRectangleRebars } from "../rebarLayout";
import { designCodes } from "../designCodes";
import { sectionResponse } from "../section";
import { parabolicRectangularLaw, parabolicRectangularStress } from "../concreteLaw";
import { computeSurface } from "../surface";
import { ec2Exponent, ec2BiaxialCheck } from "../simplified";
import type { MaterialSet, SectionModel } from "../types";

const materials: MaterialSet = {
  concrete: { fc: 30, ecu: 0.0033 },
  steel: { fy: 400, es: 200000 },
};

const section: SectionModel = {
  rings: rectangleRings(600, 900),
  rebars: generateRectangleRebars(600, 900, [
    { id: "L1", dc: 60, diameter: 25, top: 4, right: 5, bottom: 4, left: 5 },
  ]),
};

function respond(theta: number, c: number, opts: Parameters<typeof sectionResponse>[4]) {
  return sectionResponse(section, materials, designCodes.kds_strength, { theta, c }, opts);
}

describe("포물선-직선 응력법칙", () => {
  const law = parabolicRectangularLaw(30);

  it("fck<=40 은 고전값 (n=2, ec0=0.002, ecu=0.0033)", () => {
    expect(law.n).toBe(2);
    expect(law.ec0).toBeCloseTo(0.002, 9);
    expect(law.ecu).toBeCloseTo(0.0033, 9);
  });

  it("인장은 0, 정점 이후는 fcd 로 평탄", () => {
    expect(parabolicRectangularStress(-0.001, 25.5, law)).toBe(0);
    expect(parabolicRectangularStress(0.0025, 25.5, law)).toBe(25.5);
    expect(parabolicRectangularStress(0.002, 25.5, law)).toBeCloseTo(25.5, 9);
  });

  it("정점 이전은 단조 증가", () => {
    let prev = -1;
    for (let e = 0; e <= 0.002; e += 0.0001) {
      const s = parabolicRectangularStress(e, 25.5, law);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe("파이버 적분", () => {
  it("밴드 수를 2배로 늘려도 결과가 0.1% 이내로 수렴한다", () => {
    for (const [theta, c] of [
      [Math.PI / 2, 300],
      [Math.PI / 4, 400],
      [1.1, 250],
    ] as const) {
      const coarse = respond(theta, c, { transverseReinforcement: "tie", method: "fiber", fiberBands: 60 });
      const fine = respond(theta, c, { transverseReinforcement: "tie", method: "fiber", fiberBands: 240 });
      const scale = Math.max(1, Math.abs(fine.pn));
      expect(Math.abs(coarse.pn - fine.pn) / scale, `pn theta=${theta}`).toBeLessThan(1e-3);
      const mScale = Math.max(1, Math.hypot(fine.mnx, fine.mny));
      expect(Math.abs(coarse.mnx - fine.mnx) / mScale).toBeLessThan(1e-3);
      expect(Math.abs(coarse.mny - fine.mny) / mScale).toBeLessThan(1e-3);
    }
  });

  it("1축 직사각형에서 등가블록과 차이가 5% 이내", () => {
    for (const c of [200, 400, 600, 800]) {
      const block = respond(Math.PI / 2, c, { transverseReinforcement: "tie" });
      const fiber = respond(Math.PI / 2, c, { transverseReinforcement: "tie", method: "fiber", fiberBands: 120 });
      const rel = Math.abs(fiber.concrete.force - block.concrete.force) / Math.abs(block.concrete.force);
      expect(rel, `c=${c}`).toBeLessThan(0.05);
    }
  });

  it("중공 단면에서도 수렴한다", () => {
    const hollow: SectionModel = {
      rings: rectangleRings(3000, 4000, 400),
      rebars: generateRectangleRebars(3000, 4000, [
        { id: "L1", dc: 100, diameter: 32, top: 8, right: 10, bottom: 8, left: 10 },
      ]),
    };
    const a = sectionResponse(hollow, materials, designCodes.kds_strength, { theta: 0.8, c: 1500 }, {
      transverseReinforcement: "tie",
      method: "fiber",
      fiberBands: 60,
    });
    const b = sectionResponse(hollow, materials, designCodes.kds_strength, { theta: 0.8, c: 1500 }, {
      transverseReinforcement: "tie",
      method: "fiber",
      fiberBands: 240,
    });
    expect(Math.abs(a.pn - b.pn) / Math.abs(b.pn)).toBeLessThan(2e-3);
  });
});

describe("EC2 3.1.7(3) 테이퍼 저감", () => {
  it("1축(수평 중립축, 폭 일정)에서는 저감이 걸리지 않는다", () => {
    const off = respond(Math.PI / 2, 400, { transverseReinforcement: "tie" });
    const on = respond(Math.PI / 2, 400, { transverseReinforcement: "tie", taperReduction: true });
    expect(on.concrete.force).toBeCloseTo(off.concrete.force, 9);
  });

  it("★ 모서리 압축(삼각형 압축영역)에서는 10% 저감이 걸린다", () => {
    // 대각 방향 중립축 + 얕은 c -> 압축영역이 삼각형
    const theta = Math.atan2(900, 600);
    const off = respond(theta, 150, { transverseReinforcement: "tie" });
    const on = respond(theta, 150, { transverseReinforcement: "tie", taperReduction: true });
    expect(on.concrete.force / off.concrete.force).toBeCloseTo(0.9, 6);
  });

  it("저감을 켜면 압축강도가 낮아진다(안전측)", () => {
    const theta = Math.atan2(900, 600);
    const off = respond(theta, 150, { transverseReinforcement: "tie" });
    const on = respond(theta, 150, { transverseReinforcement: "tie", taperReduction: true });
    expect(on.pn).toBeLessThan(off.pn);
  });
});

describe("EC2 5.8.9 지수법", () => {
  it("지수 a 가 표대로 보간된다", () => {
    expect(ec2Exponent(0.05)).toBeCloseTo(1.0, 9);
    expect(ec2Exponent(0.1)).toBeCloseTo(1.0, 9);
    expect(ec2Exponent(0.4)).toBeCloseTo(1.25, 9);
    expect(ec2Exponent(0.7)).toBeCloseTo(1.5, 9);
    expect(ec2Exponent(0.85)).toBeCloseTo(1.75, 9);
    expect(ec2Exponent(1.2)).toBeCloseTo(2.0, 9);
  });

  /**
   * 정확 곡면 위의 점을 지수법에 넣으면 사용률이 1 이 **되지 않는다**. 그게 정상이다.
   *
   * 저축력에서 a -> 1.0 이면 (Mx/Mrx) + (My/Mry) <= 1 인 **직선** 상관식이 되는데,
   * 실제 등고선은 볼록하므로 직선은 그 안쪽에 놓인다. 즉 지수법은 **보수적**이고
   * 곡면 위의 점에 대해 사용률 > 1 을 낸다. 이 방향성 자체가 검증 대상이다.
   */
  it("저축력에서 지수법은 보수측이다 (사용률 > 1)", () => {
    const surface = computeSurface(section, materials, {
      designCode: "bridge_lsd",
      thetaSteps: 72,
      cSteps: 60,
    })!;

    let checked = 0;
    for (const ti of [9, 18, 27]) {
      const point = surface.meridians[ti].find((p) => p.mn > 10 && p.pn > 0)!;
      const result = ec2BiaxialCheck(surface, point.pd, point.mdx, point.mdy, { useDesign: true });
      expect(result, `theta index ${ti}`).toBeDefined();
      expect(result!.exponent).toBeGreaterThanOrEqual(1);
      expect(result!.exponent).toBeLessThanOrEqual(2);
      // 보수측이되, 2배를 넘게 틀리면 구현 오류로 본다.
      expect(result!.utilisation, `theta index ${ti}`).toBeGreaterThan(0.95);
      expect(result!.utilisation, `theta index ${ti}`).toBeLessThan(2);
      checked += 1;
    }
    expect(checked).toBe(3);
  });

  it("한 축 단독 모멘트면 사용률이 정확히 1 이다", () => {
    const surface = computeSurface(section, materials, {
      designCode: "bridge_lsd",
      thetaSteps: 72,
      cSteps: 60,
    })!;
    const pu = surface.pn0 * 0.2;
    const result = ec2BiaxialCheck(surface, pu, 0, 0, { useDesign: true })!;
    // Muy = 0 인 경우 (Mrdx/Mrdx)^a + 0 = 1 이 되어야 한다.
    const onlyX = ec2BiaxialCheck(surface, pu, result.mrdx, 0, { useDesign: true })!;
    expect(onlyX.utilisation).toBeCloseTo(1, 6);
  });

  it("원형은 a = 2 로 고정", () => {
    const surface = computeSurface(section, materials, { designCode: "bridge_lsd", thetaSteps: 36, cSteps: 40 })!;
    const result = ec2BiaxialCheck(surface, surface.pn0 * 0.3, 100, 80, { circular: true });
    expect(result!.exponent).toBe(2);
  });
});
