import { describe, expect, it } from "vitest";
import {
  axisNormal,
  circleRings,
  clipRingsHalfPlane,
  makeRing,
  normalizeRings,
  outerBounds,
  pointInPolygon,
  rectanglePolygon,
  rectangleRings,
  sectionArea,
  sectionCentroid,
  sectionProjectionRange,
  sectionSecondMoments,
  signedArea,
  validateRings,
} from "../geometry";
import type { Point, Ring } from "../types";

describe("링 방향 정규화", () => {
  it("outer 는 CCW(양), hole 은 CW(음)로 강제된다", () => {
    const rings = normalizeRings([
      makeRing("O1", "outer", [...rectanglePolygon(400, 600)].reverse()),
      makeRing("H1", "hole", rectanglePolygon(200, 400)),
    ]);
    expect(signedArea(rings[0].points)).toBeGreaterThan(0);
    expect(signedArea(rings[1].points)).toBeLessThan(0);
  });
});

describe("중공 사각형 해석해", () => {
  const B = 2000;
  const H = 3000;
  const t = 300;
  const rings = rectangleRings(B, H, t);
  const bi = B - 2 * t;
  const hi = H - 2 * t;

  it("순 단면적 = BH - bi*hi", () => {
    expect(sectionArea(rings)).toBeCloseTo(B * H - bi * hi, 6);
  });

  it("도심은 원점", () => {
    const c = sectionCentroid(rings);
    expect(c.x).toBeCloseTo(0, 9);
    expect(c.y).toBeCloseTo(0, 9);
  });

  it("Ix = (B*H^3 - bi*hi^3)/12, Iy = (H*B^3 - hi*bi^3)/12", () => {
    const m = sectionSecondMoments(rings);
    expect(m.ix).toBeCloseTo((B * H ** 3 - bi * hi ** 3) / 12, 3);
    expect(m.iy).toBeCloseTo((H * B ** 3 - hi * bi ** 3) / 12, 3);
    expect(m.ixy).toBeCloseTo(0, 3);
  });

  it("외곽 경계는 중공에 영향받지 않는다", () => {
    const box = outerBounds(rings);
    expect(box.minX).toBeCloseTo(-B / 2, 9);
    expect(box.maxY).toBeCloseTo(H / 2, 9);
  });
});

describe("중공 원형 해석해", () => {
  // 다각형 근사이므로 분할 수를 크게 잡고 상대오차로 본다.
  const D = 2000;
  const Di = 1400;
  const rings = circleRings(D, 2880, Di);

  it("순 단면적 = pi(D^2 - Di^2)/4", () => {
    const exact = (Math.PI * (D ** 2 - Di ** 2)) / 4;
    expect(Math.abs(sectionArea(rings) / exact - 1)).toBeLessThan(2e-6);
  });

  it("Ix = Iy = pi(D^4 - Di^4)/64", () => {
    const exact = (Math.PI * (D ** 4 - Di ** 4)) / 64;
    const m = sectionSecondMoments(rings);
    expect(Math.abs(m.ix / exact - 1)).toBeLessThan(5e-6);
    expect(Math.abs(m.iy / exact - 1)).toBeLessThan(5e-6);
    expect(Math.abs(m.ixy)).toBeLessThan(exact * 1e-9);
  });
});

/**
 * 반평면 절단 x 중공의 상호작용 검증.
 * 링별 독립 절단 + 부호합산이 (외곽 ∩ HP) \ (중공 ∩ HP) 와 같은지를
 * 조밀 격자 샘플링으로 대조한다.
 */
function sampleArea(rings: Ring[], nx: number, ny: number, sLimit: number, n = 1400): { area: number; cx: number; cy: number } {
  const box = outerBounds(rings);
  const dx = (box.maxX - box.minX) / n;
  const dy = (box.maxY - box.minY) / n;
  const cell = dx * dy;
  const outers = rings.filter((r) => r.kind === "outer");
  const holes = rings.filter((r) => r.kind === "hole");
  let area = 0;
  let mx = 0;
  let my = 0;

  for (let i = 0; i < n; i += 1) {
    const x = box.minX + (i + 0.5) * dx;
    for (let j = 0; j < n; j += 1) {
      const y = box.minY + (j + 0.5) * dy;
      const p: Point = { x, y };
      if (x * nx + y * ny < sLimit) continue;
      const inside =
        outers.some((r) => pointInPolygon(p, r.points)) && !holes.some((r) => pointInPolygon(p, r.points));
      if (!inside) continue;
      area += cell;
      mx += x * cell;
      my += y * cell;
    }
  }
  return { area, cx: area > 0 ? mx / area : 0, cy: area > 0 ? my / area : 0 };
}

describe("중공 단면의 임의 반평면 절단", () => {
  const rings = rectangleRings(2000, 3000, 300);

  for (const deg of [90, 60, 45, 20, 135]) {
    it(`theta=${deg}deg 절단이 격자 샘플링과 일치한다`, () => {
      const { nx, ny } = axisNormal((deg * Math.PI) / 180);
      const { sMin, sMax } = sectionProjectionRange(rings, nx, ny);
      const sLimit = sMin + (sMax - sMin) * 0.45;

      const clipped = clipRingsHalfPlane(rings, nx, ny, sLimit);
      const area = sectionArea(clipped);
      const c = sectionCentroid(clipped);
      const ref = sampleArea(rings, nx, ny, sLimit);

      expect(Math.abs(area / ref.area - 1), "면적").toBeLessThan(2e-3);
      const scale = Math.max(1, Math.hypot(ref.cx, ref.cy));
      expect(Math.abs(c.x - ref.cx) / scale, "도심 x").toBeLessThan(5e-3);
      expect(Math.abs(c.y - ref.cy) / scale, "도심 y").toBeLessThan(5e-3);
    });
  }

  it("절단면이 중공을 완전히 통과하면 홀 기여가 사라진다", () => {
    const { nx, ny } = axisNormal(Math.PI / 2);
    const { sMax } = sectionProjectionRange(rings, nx, ny);
    // 중공 상단(y=1200) 위쪽만 남기면 순수 외곽 벽체만 남는다.
    const clipped = clipRingsHalfPlane(rings, nx, ny, 1200);
    expect(clipped.every((r) => r.kind === "outer")).toBe(true);
    expect(sectionArea(clipped)).toBeCloseTo(2000 * (sMax - 1200), 6);
  });
});

describe("링 검증", () => {
  it("중공이 외곽 밖에 있으면 경고한다", () => {
    const rings = normalizeRings([
      makeRing("O1", "outer", rectanglePolygon(400, 400)),
      makeRing("H1", "hole", [
        { x: 900, y: 900 },
        { x: 1100, y: 900 },
        { x: 1100, y: 1100 },
        { x: 900, y: 1100 },
      ]),
    ]);
    const issues = validateRings(rings);
    expect(issues.some((i) => i.message.includes("외곽 링 안에 있지 않습니다"))).toBe(true);
  });

  it("중공이 외곽보다 크면 오류다", () => {
    const rings = normalizeRings([
      makeRing("O1", "outer", rectanglePolygon(400, 400)),
      makeRing("H1", "hole", rectanglePolygon(600, 600)),
    ]);
    expect(validateRings(rings).some((i) => i.level === "error")).toBe(true);
  });

  it("정상 중공 단면은 지적사항이 없다", () => {
    expect(validateRings(rectangleRings(2000, 3000, 300))).toHaveLength(0);
  });
});
