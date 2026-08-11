import { describe, expect, it } from "vitest";
import { circleRings, rectangleRings } from "../geometry";
import { generateCircleRebars, generateRectangleRebars } from "../rebarLayout";
import {
  angleDistance,
  computeSurface,
  interpolateAtAxial,
  meridianAtTheta,
  type InteractionSurface,
} from "../surface";
import { capacityAt, solveAtTheta } from "../solve";
import {
  checkDemand,
  expandDemands,
  minEccentricityDemand,
  prepareDemand,
  type ColumnGeometry,
  type DemandInput,
} from "../demand";
import type { DesignCodeId, MaterialSet, SectionModel } from "../types";

const materials: MaterialSet = {
  concrete: { fc: 30, ecu: 0.0033 },
  steel: { fy: 400, es: 200000 },
};

const column: ColumnGeometry = { lu: 3000, kx: 1, ky: 1 };

function build(section: SectionModel, designCode: DesignCodeId = "kds_strength"): InteractionSurface {
  const surface = computeSurface(section, materials, {
    designCode,
    thetaSteps: 72,
    cSteps: 60,
    transverseReinforcement: "tie",
  });
  if (!surface) throw new Error("곡면 생성 실패");
  return surface;
}

const rectSection: SectionModel = {
  rings: rectangleRings(600, 900),
  rebars: generateRectangleRebars(600, 900, [
    { id: "L1", dc: 60, diameter: 25, top: 4, right: 5, bottom: 4, left: 5 },
  ]),
};

// ---------------------------------------------------------------------------
// inner loop
// ---------------------------------------------------------------------------
describe("solveAtTheta (inner: c 이분법)", () => {
  const surface = build(rectSection);

  it("요구 축력을 정확히 맞춘다", () => {
    for (const frac of [-0.05, 0.05, 0.2, 0.4, 0.6]) {
      const pu = surface.pn0 * frac;
      const result = solveAtTheta(surface, Math.PI / 3, pu, false);
      expect(result, `frac=${frac}`).toBeDefined();
      expect(Math.abs(result!.pn - pu) / Math.max(1, Math.abs(pu))).toBeLessThan(1e-7);
    }
  });

  it("곡면 밖의 축력은 해가 없다", () => {
    expect(solveAtTheta(surface, Math.PI / 2, surface.pn0 * 5, false)).toBeUndefined();
    expect(solveAtTheta(surface, Math.PI / 2, surface.pureTension.pn * 5, false)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ★ 왕복 테스트: 곡면 위의 점을 수요로 넣으면 사용률 1.000
//   솔버 전체(outer+inner)를 한 번에 검증하는 가장 강력한 테스트.
// ---------------------------------------------------------------------------
describe("왕복 검증: 곡면 위 점 -> ratio = 1", () => {
  const surface = build(rectSection);

  it("여러 (theta, c) 에서 되돌아온다", () => {
    let checked = 0;
    for (let ti = 0; ti < surface.meridians.length; ti += 7) {
      const meridian = surface.meridians[ti];
      for (let ci = 10; ci < meridian.length; ci += 13) {
        const point = meridian[ci];
        if (point.mn < 1 || point.cappedByAxialLimit) continue;

        const found = capacityAt(surface, point.pn, point.alphaE, false);
        expect(found, `theta=${point.theta} c=${point.c}`).toBeDefined();

        const capacityMoment = Math.hypot(found!.mnx, found!.mny);
        expect(
          Math.abs(capacityMoment / point.mn - 1),
          `|M| @theta=${((point.theta * 180) / Math.PI).toFixed(1)}deg c=${point.c.toFixed(1)}`,
        ).toBeLessThan(2e-3);
        expect(Math.abs(found!.pn - point.pn) / Math.max(1, Math.abs(point.pn))).toBeLessThan(1e-6);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("중공 단면에서도 왕복한다", () => {
    const hollow = build({
      rings: rectangleRings(3000, 4000, 400),
      rebars: generateRectangleRebars(3000, 4000, [
        { id: "L1", dc: 100, diameter: 32, top: 8, right: 10, bottom: 8, left: 10 },
      ]),
    });
    let checked = 0;
    for (let ti = 0; ti < hollow.meridians.length; ti += 11) {
      const point = hollow.meridians[ti][30];
      if (point.mn < 1 || point.cappedByAxialLimit) continue;
      const found = capacityAt(hollow, point.pn, point.alphaE, false);
      expect(found).toBeDefined();
      expect(Math.abs(Math.hypot(found!.mnx, found!.mny) / point.mn - 1)).toBeLessThan(3e-3);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// 고축력 폴백: 자오선 c 상한(1.8*h)을 넘는 축력
// ---------------------------------------------------------------------------
describe("자오선이 못 닿는 고축력 구간", () => {
  // 800x1000 fck80 SD600 / 한계상태설계법 — RcMania·DMbix 대조에 쓴 단면.
  // Pn0 = 44278 kN 인데 자오선 최대 축력은 38655 kN 에서 끊긴다.
  const highAxial = computeSurface(
    {
      rings: rectangleRings(800, 1000),
      rebars: generateRectangleRebars(800, 1000, [
        { id: "L1", dc: 90, diameter: 29, top: 7, right: 9, bottom: 7, left: 9 },
      ]),
    },
    { concrete: { fc: 80, ecu: 0.0029, ec: 37490 }, steel: { fy: 600, es: 200000 } },
    { designCode: "bridge_lsd", thetaSteps: 72, cSteps: 60, transverseReinforcement: "tie" },
  )!;

  const meridianMax = Math.max(...highAxial.meridians.flat().map((p) => p.pdRaw));

  it("전제: 자오선 최대 축력이 Pn0 보다 낮다 (폴백이 실제로 필요한 상황)", () => {
    expect(meridianMax).toBeLessThan(highAxial.pn0);
  });

  it("자오선 상한과 Pn0 사이의 축력에서도 해를 찾는다", () => {
    // LC1 (Pu = 38872.7 kN) 이 정확히 이 구간에 있다.
    for (const pu of [38872.7, meridianMax * 1.02, (meridianMax + highAxial.pn0) / 2]) {
      const alphaE = Math.atan2(68.848, 163.268);
      const found = capacityAt(highAxial, pu, alphaE, true);
      expect(found, `pu=${pu}`).toBeDefined();
      expect(Math.abs(found!.pd - pu) / pu, `축력 수렴 pu=${pu}`).toBeLessThan(1e-6);
      // 편심 방향도 목표에 맞아야 한다 (θ != alpha_e 이므로 방향 수렴이 별도 조건)
      expect(Math.abs(found!.alphaE - alphaE), `alpha_e pu=${pu}`).toBeLessThan(1e-3);
      expect(found!.md).toBeGreaterThan(0);
    }
  });

  it("모멘트가 축력에 대해 단조 감소한다 (곡면 상단이 이어진다)", () => {
    const alphaE = Math.atan2(68.848, 163.268);
    let previous = Number.POSITIVE_INFINITY;
    for (const pu of [36000, 38000, 38872.7, 40000, 42000]) {
      const found = capacityAt(highAxial, pu, alphaE, true);
      expect(found, `pu=${pu}`).toBeDefined();
      expect(found!.md, `pu=${pu}`).toBeLessThan(previous);
      previous = found!.md;
    }
  });

  it("Pn0 를 넘는 축력은 여전히 해가 없다", () => {
    expect(capacityAt(highAxial, highAxial.pn0 * 1.2, Math.PI / 4, true)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 화면 곡선(App.tsx SliceSvg)과 검토 결과의 정합
// ---------------------------------------------------------------------------
describe("하중점은 그려지는 곡선 위에 있다", () => {
  const s = computeSurface(
    {
      rings: rectangleRings(800, 1000),
      rebars: generateRectangleRebars(800, 1000, [
        { id: "L1", dc: 90, diameter: 29, top: 7, right: 9, bottom: 7, left: 9 },
      ]),
    },
    { concrete: { fc: 80, ecu: 0.0029, ec: 37490 }, steel: { fy: 600, es: 200000 } },
    { designCode: "bridge_lsd", thetaSteps: 72, cSteps: 60, transverseReinforcement: "tie" },
  )!;

  // RcMania/DMbix 대조 케이스. LC1 은 자오선 c 상한을 넘는 고축력이다.
  const cases = [
    { name: "LC1", pu: 38872.7, mx: 68.848, my: 163.268 },
    { name: "LC2", pu: 22561.2, mx: 31.593, my: 663.033 },
    { name: "대각 45도", pu: 20000, mx: 2000, my: 2000 },
  ];

  for (const lc of cases) {
    it(`${lc.name}: 곡선 위 P=Pu 지점이 검토 |Md| 와 일치한다`, () => {
      const alphaE = Math.atan2(lc.mx, lc.my);
      const capacity = capacityAt(s, lc.pu, alphaE, true);
      expect(capacity, "검토 해").toBeDefined();

      // App.tsx SliceSvg 가 그리는 바로 그 곡선
      const curve = meridianAtTheta(s, capacity!.theta, { tailSteps: 14 });
      const hit = interpolateAtAxial(curve, lc.pu, true);
      expect(hit, "곡선이 Pu 까지 닿는다").toBeDefined();

      const drawn = Math.hypot(hit!.mx, hit!.my);
      // 남는 오차는 c 분할 사이의 선형보간뿐이다.
      expect(Math.abs(drawn / capacity!.md - 1), `|Md| 곡선=${drawn} 검토=${capacity!.md}`).toBeLessThan(5e-3);
    });
  }

  it("격자 자오선으로 그리면 어긋난다 (수정 전 동작의 회귀 방지)", () => {
    const lc = cases[1]; // LC2: theta 2.02deg, 가장 가까운 격자는 0deg
    const alphaE = Math.atan2(lc.mx, lc.my);
    const capacity = capacityAt(s, lc.pu, alphaE, true)!;
    const grid = s.meridians.reduce((best, m) =>
      angleDistance(m[0].theta, capacity.theta) < angleDistance(best[0].theta, capacity.theta) ? m : best,
    );
    const gridHit = interpolateAtAxial(grid, lc.pu, true)!;
    const gridDrawn = Math.hypot(gridHit.mx, gridHit.my);
    // 격자 스냅은 1% 넘게 벌어진다 -> 정확한 theta 로 그려야 하는 이유
    expect(Math.abs(gridDrawn / capacity.md - 1)).toBeGreaterThan(1e-2);
  });
});

// ---------------------------------------------------------------------------
// 원형 단면: 모든 방향에서 같은 강도
// ---------------------------------------------------------------------------
describe("원형 단면은 방향 무관", () => {
  const surface = build({
    rings: circleRings(1000, 720),
    rebars: generateCircleRebars(1000, { cover: 50, diameter: 25, count: 32 }),
  });

  it("임의 alpha_e 에서 강도가 같다", () => {
    const pu = surface.pn0 * 0.3;
    const reference = capacityAt(surface, pu, Math.PI / 2, false)!;
    for (const deg of [0, 17, 45, 90, 133, 200, 271, 330]) {
      const found = capacityAt(surface, pu, (deg * Math.PI) / 180, false);
      expect(found, `${deg}deg`).toBeDefined();
      const refM = Math.hypot(reference.mnx, reference.mny);
      const gotM = Math.hypot(found!.mnx, found!.mny);
      expect(Math.abs(gotM / refM - 1), `${deg}deg`).toBeLessThan(0.02);
    }
  });
});

// ---------------------------------------------------------------------------
// 1축 일치: Muy = 0 이면 기존 1축 검토와 같은 답
// ---------------------------------------------------------------------------
describe("Muy = 0 이면 1축과 동일", () => {
  const surface = build(rectSection);

  it("theta = 90deg 해로 수렴한다", () => {
    const pu = surface.pn0 * 0.3;
    const found = capacityAt(surface, pu, Math.PI / 2, false)!;
    expect(found).toBeDefined();
    expect((found.theta * 180) / Math.PI).toBeCloseTo(90, 2);
    expect(Math.abs(found.mny) / Math.max(1, Math.abs(found.mnx))).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------
// 설계법별 우발편심 처리 (Phase 6)
// ---------------------------------------------------------------------------
describe("우발편심: 강도설계법 = 축력 cutoff", () => {
  const surface = build(rectSection, "kds_strength");

  it("최소모멘트를 수요에 적용하지 않는다", () => {
    const input: DemandInput = { id: "D1", label: "LC1", pu: 2000, muxNs: 300, muxS: 0, muyNs: 0, muyS: 0 };
    const prepared = prepareDemand(surface, materials, column, input);
    expect(prepared.minMomentX).toBe(0);
    expect(prepared.minMomentY).toBe(0);
    expect(prepared.e0x).toBeUndefined();
    expect(prepared.mux).toBeCloseTo(prepared.muxMagnified, 12);
  });

  it("축력 상한 초과는 즉시 NG", () => {
    const input: DemandInput = {
      id: "D1",
      label: "LC1",
      pu: surface.axialCap * 1.01,
      muxNs: 10,
      muxS: 0,
      muyNs: 0,
      muyS: 0,
    };
    const result = checkDemand(surface, materials, column, input, true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("over_axial_cap");
  });

  it("곡면은 하중케이스에 무관하다", () => {
    const a = build(rectSection, "kds_strength");
    const b = build(rectSection, "kds_strength");
    expect(a.axialCap).toBe(b.axialCap);
    expect(a.meridians[0][10].pd).toBe(b.meridians[0][10].pd);
  });
});

describe("우발편심: 한계상태설계법 = 최소모멘트", () => {
  const surface = build(rectSection, "bridge_lsd");

  /** 파생 케이스를 만들어 prepareDemand 까지 돌린다. 없으면 실패시킨다. */
  const prepareDerived = (input: DemandInput) => {
    const derived = minEccentricityDemand(surface, materials, column, input);
    expect(derived, "파생 케이스가 생성되어야 한다").not.toBeNull();
    return prepareDemand(surface, materials, column, derived!);
  };

  it("e0 = max(h/30, 20mm) 로 최소모멘트를 만든다", () => {
    const input: DemandInput = { id: "D1", label: "LC1", pu: 2000, muxNs: 0, muxS: 0, muyNs: 0, muyS: 0 };
    const prepared = prepareDemand(surface, materials, column, input);
    expect(prepared.e0y).toBeCloseTo(900 / 30, 9); // y방향 깊이 900 -> Mux 와 짝
    expect(prepared.e0x).toBeCloseTo(Math.max(600 / 30, 20), 9); // x방향 폭 600 -> Muy 와 짝
    expect(prepared.minMomentX).toBeCloseTo((2000 * 30) / 1000, 9);
    expect(prepared.minMomentY).toBeCloseTo((2000 * 20) / 1000, 9);
    expect(prepared.minMomentGovernsX).toBe(true);
    expect(prepared.minMomentGovernsY).toBe(true);
  });

  it("원 케이스는 입력값 그대로 두고, 하한은 파생 케이스에만 적용한다", () => {
    const input: DemandInput = { id: "D1", label: "LC1", pu: 2000, muxNs: 0, muxS: 0, muyNs: 0, muyS: 0 };

    const original = prepareDemand(surface, materials, column, input);
    expect(original.appliesMinMoment).toBe(false);
    expect(original.mux).toBe(0);
    expect(original.muy).toBe(0);

    const derived = prepareDerived(input);
    expect(derived.appliesMinMoment).toBe(true);
    expect(derived.mux).toBeCloseTo((2000 * 30) / 1000, 9);
    expect(derived.muy).toBeCloseTo((2000 * 20) / 1000, 9);
  });

  it("★ 최소모멘트 하한이 편심 방향을 회전시킨다 (§1.7.3 회귀)", () => {
    // Mux 만 크고 Muy = 0 -> 하한 처리 전 alpha_e = 90deg
    const input: DemandInput = { id: "D1", label: "LC1", pu: 2000, muxNs: 3000, muxS: 0, muyNs: 0, muyS: 0 };
    const prepared = prepareDerived(input);

    expect((prepared.alphaEBeforeMinMoment * 180) / Math.PI).toBeCloseTo(90, 6);
    // Muy 가 0 -> 40 kN-m 로 올라오므로 방향이 이동해야 한다.
    expect(prepared.muy).toBeCloseTo(40, 6);
    const after = (prepared.alphaE * 180) / Math.PI;
    expect(after).toBeLessThan(90);
    expect(after).toBeGreaterThan(80);
  });

  it("작용모멘트가 최소모멘트보다 크면 하한이 걸리지 않는다", () => {
    const input: DemandInput = { id: "D1", label: "LC1", pu: 1000, muxNs: 900, muxS: 0, muyNs: 700, muyS: 0 };
    const prepared = prepareDemand(surface, materials, column, input);
    expect(prepared.minMomentGovernsX).toBe(false);
    expect(prepared.minMomentGovernsY).toBe(false);
    expect(prepared.mux).toBeCloseTo(prepared.muxMagnified, 12);
    expect(minEccentricityDemand(surface, materials, column, input)).toBeNull();
  });

  it("한 축만 지배해도 파생 케이스를 만들고, 지배하지 않는 축은 입력값을 유지한다", () => {
    // Mux 는 충분히 크고(하한 60 kN-m), Muy = 0 만 하한(40 kN-m)에 걸린다.
    const input: DemandInput = { id: "D1", label: "LC1", pu: 2000, muxNs: 3000, muxS: 0, muyNs: 0, muyS: 0 };
    const prepared = prepareDerived(input);
    expect(prepared.minMomentGovernsX).toBe(false);
    expect(prepared.minMomentGovernsY).toBe(true);
    expect(prepared.mux).toBeCloseTo(prepared.muxMagnified, 12); // 그대로
    expect(prepared.muy).toBeCloseTo(40, 6); // 끌어올림
  });

  it("expandDemands 는 파생 케이스를 원 케이스 바로 뒤에 추가한다", () => {
    const governed: DemandInput = { id: "D1", label: "LC1", pu: 2000, muxNs: 0, muxS: 0, muyNs: 0, muyS: 0 };
    const free: DemandInput = { id: "D2", label: "LC2", pu: 1000, muxNs: 900, muxS: 0, muyNs: 700, muyS: 0 };

    const expanded = expandDemands(surface, materials, column, [governed, free]);
    expect(expanded.map((d) => d.id)).toEqual(["D1", "D1-e0", "D2"]);
    expect(expanded[1].label).toBe("LC1 (최소편심)");
    expect(expanded[1].minEccentricityOf).toBe("D1");
    // 원 케이스 객체는 손대지 않는다.
    expect(expanded[0]).toBe(governed);
    expect(governed.minEccentricityOf).toBeUndefined();
  });

  it("파생의 파생은 만들지 않는다", () => {
    const governed: DemandInput = { id: "D1", label: "LC1", pu: 2000, muxNs: 0, muxS: 0, muyNs: 0, muyS: 0 };
    const derived = minEccentricityDemand(surface, materials, column, governed)!;
    expect(minEccentricityDemand(surface, materials, column, derived)).toBeNull();
    expect(expandDemands(surface, materials, column, [derived]).map((d) => d.id)).toEqual(["D1-e0"]);
  });

  it("축력 상한을 쓰지 않는다", () => {
    expect(surface.axialLimitFactor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 사용률
// ---------------------------------------------------------------------------
describe("사용률 판정", () => {
  const surface = build(rectSection);

  const nonCapped = surface.meridians[12].filter((p) => !p.cappedByAxialLimit && p.mn > 1);

  it("곡면 위의 점은 ratio ~ 1", () => {
    const point = nonCapped[nonCapped.length - 3];
    const input: DemandInput = {
      id: "D1",
      label: "on-surface",
      pu: point.pd,
      muxNs: point.mdx,
      muxS: 0,
      muyNs: point.mdy,
      muyS: 0,
    };
    // 장주효과를 배제하기 위해 매우 짧은 기둥으로 검토
    const result = checkDemand(surface, materials, { lu: 1, kx: 1, ky: 1 }, input, true);
    expect(result.capacity).toBeDefined();
    expect(Math.abs(result.ratio - 1)).toBeLessThan(5e-3);
  });

  it("곡면 안쪽은 OK, 바깥쪽은 NG", () => {
    const point = nonCapped[nonCapped.length - 3];
    const base: DemandInput = {
      id: "D1",
      label: "x",
      pu: point.pd,
      muxNs: point.mdx,
      muxS: 0,
      muyNs: point.mdy,
      muyS: 0,
    };
    const short: ColumnGeometry = { lu: 1, kx: 1, ky: 1 };
    const inside = checkDemand(surface, materials, short, { ...base, muxNs: point.mdx * 0.5, muyNs: point.mdy * 0.5 }, true);
    const outside = checkDemand(surface, materials, short, { ...base, muxNs: point.mdx * 1.5, muyNs: point.mdy * 1.5 }, true);
    expect(inside.ok).toBe(true);
    expect(inside.ratio).toBeLessThan(1);
    expect(outside.ok).toBe(false);
    expect(outside.ratio).toBeGreaterThan(1);
  });
});
