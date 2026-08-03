import { describe, expect, it } from "vitest";
import { circleRings, rectangleRings } from "../geometry";
import { generateCircleRebars, generateRectangleRebars } from "../rebarLayout";
import { computePM } from "../pm";
import { angleDistance, computeSurface, meridianAt, momentContour, type InteractionSurface } from "../surface";
import type { MaterialSet, Rebar, SectionModel } from "../types";

const materials: MaterialSet = {
  concrete: { fc: 30, ecu: 0.0033 },
  steel: { fy: 400, es: 200000 },
};

const rectBars: Rebar[] = [
  { id: "R1", x: -150, y: -250, diameter: 25 },
  { id: "R2", x: 150, y: -250, diameter: 25 },
  { id: "R3", x: -150, y: 250, diameter: 25 },
  { id: "R4", x: 150, y: 250, diameter: 25 },
];

/** 같은 c 인덱스에서 자오선 간 축력이 얼마나 벌어지는지(kN). 축대칭성 지표. */
function maxAxialDeviation(surface: InteractionSurface): number {
  const first = surface.meridians[0];
  let worst = 0;
  for (const meridian of surface.meridians) {
    for (let j = 0; j < first.length; j += 1) {
      worst = Math.max(worst, Math.abs(meridian[j].pn - first[j].pn));
    }
  }
  return worst;
}

function build(section: SectionModel, thetaSteps = 72, cSteps = 60): InteractionSurface {
  const surface = computeSurface(section, materials, {
    designCode: "kds_strength",
    thetaSteps,
    cSteps,
    transverseReinforcement: "tie",
  });
  if (!surface) throw new Error("곡면 생성 실패");
  return surface;
}

// ---------------------------------------------------------------------------
// 불변식 1: 원형 단면의 곡면은 축대칭이다.
//   θ 루프 / 임의각 클리핑 / 모멘트 부호를 한 번에 검증하는 가장 강력한 테스트.
// ---------------------------------------------------------------------------
describe("불변식: 원형 단면 축대칭", () => {
  const section: SectionModel = {
    rings: circleRings(1000, 720),
    rebars: generateCircleRebars(1000, { cover: 50, diameter: 25, count: 16 }),
  };
  const surface = build(section, 64, 50);

  it("같은 c 에서 모든 θ 의 Pn 이 동일하다 (Pn0 기준)", () => {
    // 국소 Pn 이 0 근처인 구간이 있으므로 상대오차가 아니라 Pn0 기준 절대오차로 본다.
    expect(maxAxialDeviation(surface) / surface.pn0).toBeLessThan(5e-3);
  });

  it("철근을 촘촘히 배치할수록 축대칭 오차가 줄어든다 (이산화가 원인임을 증명)", () => {
    const deviations = [8, 16, 32, 64].map((count) => {
      const s = build(
        {
          rings: circleRings(1000, 720),
          rebars: generateCircleRebars(1000, { cover: 50, diameter: 25, count }),
        },
        64,
        50,
      );
      return maxAxialDeviation(s) / s.pn0;
    });
    // 8본 대비 64본에서 두 자릿수 이상 개선되어야 한다.
    expect(deviations[3]).toBeLessThan(deviations[0] / 100);
    expect(deviations[3]).toBeLessThan(1e-4);
  });

  it("Mx-My 등고선이 원에 가깝다", () => {
    const contour = momentContour(surface, surface.pn0 * 0.3, false);
    expect(contour.length).toBeGreaterThan(50);
    const radii = contour.map((pt) => Math.hypot(pt.mx, pt.my));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    for (const r of radii) {
      expect(Math.abs(r / mean - 1)).toBeLessThan(0.03);
    }
  });

  it("등고선이 원점을 한 바퀴 감싼다", () => {
    const contour = momentContour(surface, surface.pn0 * 0.3, false);
    const angles = contour.map((pt) => Math.atan2(pt.mx, pt.my)).sort((a, b) => a - b);
    // 인접 각도 간격이 균등하고 전체가 2pi 를 덮어야 한다.
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i] - angles[i - 1]).toBeLessThan(0.3);
    }
  });
});

// ---------------------------------------------------------------------------
// 불변식 2: θ = π/2 자오선이 기존 1축 곡선과 일치한다.
// ---------------------------------------------------------------------------
describe("불변식: theta=90deg 자오선 == 1축 곡선", () => {
  const section: SectionModel = { rings: rectangleRings(400, 600), rebars: rectBars };
  const surface = build(section, 72, 60);
  const uniaxial = computePM(section, materials, {
    designCode: "kds_strength",
    points: 60,
    transverseReinforcement: "tie",
  }).filter((p) => p.id.startsWith("pm-"));

  it("Pn, Mn 이 자오선과 일치한다", () => {
    const meridian = meridianAt(surface, Math.PI / 2);
    expect(meridian.length).toBe(uniaxial.length);
    for (let i = 0; i < meridian.length; i += 1) {
      expect(meridian[i].c).toBeCloseTo(uniaxial[i].c, 9);
      expect(meridian[i].pn).toBeCloseTo(uniaxial[i].pn, 9);
      expect(meridian[i].mnx).toBeCloseTo(uniaxial[i].mn, 9);
      expect(meridian[i].mny).toBeCloseTo(0, 9);
      expect(meridian[i].phi).toBeCloseTo(uniaxial[i].phi, 12);
    }
  });

  it("theta=0deg 자오선은 축을 바꾼 1축 곡선이다", () => {
    const swapped: SectionModel = {
      rings: rectangleRings(600, 400),
      rebars: rectBars.map((b) => ({ ...b, x: b.y, y: b.x })),
    };
    const swappedUniaxial = computePM(swapped, materials, {
      designCode: "kds_strength",
      points: 60,
      transverseReinforcement: "tie",
    }).filter((p) => p.id.startsWith("pm-"));
    const meridian = meridianAt(surface, 0);

    for (let i = 0; i < meridian.length; i += 1) {
      expect(meridian[i].pn).toBeCloseTo(swappedUniaxial[i].pn, 9);
      expect(meridian[i].mny).toBeCloseTo(swappedUniaxial[i].mn, 9);
      expect(meridian[i].mnx).toBeCloseTo(0, 9);
    }
  });
});

// ---------------------------------------------------------------------------
// 불변식 3: 점대칭 단면은 M(θ+180°) = -M(θ)
// ---------------------------------------------------------------------------
describe("불변식: 점대칭 단면의 부호 반전", () => {
  const section: SectionModel = { rings: rectangleRings(400, 600), rebars: rectBars };
  const surface = build(section, 72, 40);

  it("반대편 자오선의 모멘트가 부호 반전이다", () => {
    const half = surface.thetas.length / 2;
    for (let i = 0; i < half; i += 1) {
      const a = surface.meridians[i];
      const b = surface.meridians[i + half];
      for (let j = 0; j < a.length; j += 1) {
        const scale = Math.max(1, Math.abs(a[j].mn));
        expect(Math.abs(a[j].pn - b[j].pn) / Math.max(1, Math.abs(a[j].pn))).toBeLessThan(1e-9);
        expect(Math.abs(a[j].mnx + b[j].mnx) / scale).toBeLessThan(1e-9);
        expect(Math.abs(a[j].mny + b[j].mny) / scale).toBeLessThan(1e-9);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 불변식 4: 순압축점은 모든 θ 에서 (P0, 0, 0)
// ---------------------------------------------------------------------------
describe("불변식: 순압축점", () => {
  it("비대칭 배근에서도 모멘트가 0 이다", () => {
    const section: SectionModel = {
      rings: rectangleRings(400, 600),
      rebars: [
        { id: "R1", x: -150, y: -250, diameter: 16 },
        { id: "R2", x: 150, y: -250, diameter: 16 },
        { id: "R3", x: -150, y: 250, diameter: 32 },
        { id: "R4", x: 150, y: 250, diameter: 32 },
        { id: "R5", x: 0, y: 250, diameter: 32 },
      ],
    };
    const surface = build(section, 24, 30);
    expect(Math.abs(surface.pureCompression.mn) / surface.pn0).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------------------
// 불변식 5: 공칭 곡면의 P-절단면은 볼록하다.
//   적분/클리핑 오류가 있으면 등고선이 안쪽으로 접힌다.
// ---------------------------------------------------------------------------
describe("불변식: 공칭 등고선의 볼록성", () => {
  const section: SectionModel = {
    rings: rectangleRings(600, 900),
    rebars: generateRectangleRebars(600, 900, [
      { id: "L1", dc: 60, diameter: 25, top: 4, right: 5, bottom: 4, left: 5 },
    ]),
  };
  const surface = build(section, 96, 60);

  for (const frac of [0.1, 0.3, 0.5, 0.7]) {
    it(`P = ${frac} * Pn0 등고선이 볼록하다`, () => {
      const contour = momentContour(surface, surface.pn0 * frac, false);
      expect(contour.length).toBeGreaterThan(80);
      const points = contour.map((pt) => ({ x: pt.my, y: pt.mx }));

      // 인접 3점의 외적 부호가 일관되어야 볼록. 수치 잡음 허용치를 둔다.
      const scale = Math.max(...points.map((p) => Math.hypot(p.x, p.y)));
      let negative = 0;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const c = points[(i + 2) % points.length];
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (cross / (scale * scale) < -1e-4) negative += 1;
      }
      expect(negative).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// 불변식 6: 축력 상한(kds_strength)이 곡면 상단을 자른다.
// ---------------------------------------------------------------------------
describe("축력 상한", () => {
  const section: SectionModel = { rings: rectangleRings(400, 600), rebars: rectBars };

  it("띠철근은 0.80, 나선철근은 0.85", () => {
    const tie = build(section, 12, 20);
    const spiral = computeSurface(section, materials, {
      designCode: "kds_strength",
      thetaSteps: 12,
      cSteps: 20,
      transverseReinforcement: "spiral",
    })!;
    expect(tie.axialLimitFactor).toBe(0.8);
    expect(spiral.axialLimitFactor).toBe(0.85);
  });

  it("어떤 계산점도 축력 상한을 넘지 않는다", () => {
    const surface = build(section, 24, 40);
    for (const meridian of surface.meridians) {
      for (const point of meridian) {
        expect(point.pd).toBeLessThanOrEqual(surface.axialCap + 1e-9);
      }
    }
  });

  it("한계상태설계법은 축력 상한을 쓰지 않는다 (alpha = 1)", () => {
    const lsd = computeSurface(section, materials, {
      designCode: "bridge_lsd",
      thetaSteps: 12,
      cSteps: 20,
    })!;
    expect(lsd.axialLimitFactor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 중공 단면
// ---------------------------------------------------------------------------
describe("중공 단면 곡면", () => {
  it("중공 교각 단면에서 곡면이 정상 생성된다", () => {
    const section: SectionModel = {
      rings: rectangleRings(3000, 4000, 400),
      rebars: generateRectangleRebars(3000, 4000, [
        { id: "L1", dc: 100, diameter: 32, top: 8, right: 10, bottom: 8, left: 10 },
      ]),
    };
    const surface = build(section, 36, 40);
    expect(surface.meridians).toHaveLength(36);
    for (const meridian of surface.meridians) {
      for (const point of meridian) {
        expect(Number.isFinite(point.pn)).toBe(true);
        expect(Number.isFinite(point.mnx)).toBe(true);
        expect(Number.isFinite(point.mny)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ★ 2축 효과의 존재 자체를 확인: alpha_e != theta
// ---------------------------------------------------------------------------
describe("중립축 각도와 편심 방향은 다르다", () => {
  it("세장한 직사각형에서 alpha_e 와 theta 가 유의하게 벌어진다", () => {
    const section: SectionModel = {
      rings: rectangleRings(400, 1200),
      rebars: generateRectangleRebars(400, 1200, [
        { id: "L1", dc: 60, diameter: 25, top: 3, right: 6, bottom: 3, left: 6 },
      ]),
    };
    const surface = build(section, 72, 40);
    let maxGap = 0;
    for (const meridian of surface.meridians) {
      for (const point of meridian) {
        if (point.mn < 1) continue;
        maxGap = Math.max(maxGap, angleDistance(point.alphaE, point.theta));
      }
    }
    // 10도 이상 벌어져야 "2축은 1축 회전이 아니다"라는 명제가 코드에 살아 있는 것이다.
    expect((maxGap * 180) / Math.PI).toBeGreaterThan(10);
  });

  it("원형 단면에서는 alpha_e = theta 이다", () => {
    const section: SectionModel = {
      rings: circleRings(1000, 720),
      rebars: generateCircleRebars(1000, { cover: 50, diameter: 25, count: 24 }),
    };
    const surface = build(section, 48, 30);
    for (const meridian of surface.meridians) {
      for (const point of meridian) {
        if (point.mn < 10) continue;
        expect((angleDistance(point.alphaE, point.theta) * 180) / Math.PI).toBeLessThan(3);
      }
    }
  });
});
