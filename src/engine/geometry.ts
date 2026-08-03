import type { Point, Ring, RingKind } from "./types";

// ---------------------------------------------------------------------------
// 단일 링(다각형) 기본 연산
// ---------------------------------------------------------------------------

/**
 * 부호 있는 면적. CCW 는 양, CW 는 음.
 *
 * 중공 단면은 이 부호를 그대로 살려 합산하므로, 이 값에 절대값을 씌우면 안 된다.
 */
export function signedArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** @deprecated 부호가 필요하면 signedArea, 링 집합이면 sectionArea 를 쓴다. */
export function polygonArea(points: Point[]): number {
  return signedArea(points);
}

export function normalizePolygon(points: Point[]): Point[] {
  const cleaned = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  return signedArea(cleaned) < 0 ? [...cleaned].reverse() : cleaned;
}

export function centroid(points: Point[]): Point {
  const area = signedArea(points);
  if (Math.abs(area) < 1e-9) return { x: 0, y: 0 };

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }

  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** 원점 기준 부호 있는 2차/상승 모멘트. 링 합산의 재료가 된다. */
export function rawMoments(points: Point[]): { ix0: number; iy0: number; ixy0: number } {
  let ix0 = 0;
  let iy0 = 0;
  let ixy0 = 0;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    ix0 += (a.y * a.y + a.y * b.y + b.y * b.y) * cross;
    iy0 += (a.x * a.x + a.x * b.x + b.x * b.x) * cross;
    ixy0 += (2 * a.x * a.y + a.x * b.y + b.x * a.y + 2 * b.x * b.y) * cross;
  }

  return { ix0: ix0 / 12, iy0: iy0 / 12, ixy0: ixy0 / 24 };
}

export interface SecondMoments {
  ix: number;
  iy: number;
  /** 단면상승모멘트. **부호가 의미를 갖는다** — 절대값을 씌우면 주축 산정이 불가능해진다. */
  ixy: number;
}

export function secondMoments(points: Point[]): SecondMoments {
  const area = signedArea(points);
  const c = centroid(points);
  const { ix0, iy0, ixy0 } = rawMoments(points);
  return {
    ix: ix0 - area * c.y * c.y,
    iy: iy0 - area * c.x * c.x,
    ixy: ixy0 - area * c.x * c.y,
  };
}

/** 주축. angle 은 x축에서 반시계로 잰 제1주축 방향(rad). */
export function principalAxes(m: SecondMoments): { angle: number; i1: number; i2: number } {
  const avg = (m.ix + m.iy) / 2;
  const diff = (m.ix - m.iy) / 2;
  const r = Math.hypot(diff, m.ixy);
  return {
    angle: 0.5 * Math.atan2(-2 * m.ixy, m.ix - m.iy),
    i1: avg + r,
    i2: avg - r,
  };
}

export function bounds(points: Point[]) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------
// 중립축 법선 / 투영
// ---------------------------------------------------------------------------

/**
 * 중립축 법선 단위벡터. theta 는 압축측을 향하는 방향.
 * theta = pi/2 -> (0, 1) 즉 기존 1축(수평 중립축, 상단 압축)과 동일.
 * 90도 배수에서 cos/sin 의 부동소수 잔차(6.1e-17)를 0 으로 스냅해
 * 1축 경로가 비트 단위로 기존과 같아지게 한다.
 */
export function axisNormal(theta: number): { nx: number; ny: number } {
  let nx = Math.cos(theta);
  let ny = Math.sin(theta);
  if (Math.abs(nx) < 1e-15) nx = 0;
  if (Math.abs(ny) < 1e-15) ny = 0;
  return { nx, ny };
}

/** 법선 방향 좌표 s = x*nx + y*ny */
export function project(point: Point, nx: number, ny: number): number {
  return point.x * nx + point.y * ny;
}

export function projectionRange(points: Point[], nx: number, ny: number): { sMin: number; sMax: number } {
  let sMin = Number.POSITIVE_INFINITY;
  let sMax = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const s = p.x * nx + p.y * ny;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
  }
  return { sMin, sMax };
}

// ---------------------------------------------------------------------------
// 클리핑
// ---------------------------------------------------------------------------

/**
 * 반평면 { s >= sLimit } 로 다각형을 자른다 (Sutherland-Hodgman).
 *
 * 정점 순서를 보존하므로 CW 로 들어온 링(중공)은 CW 로 남는다.
 * 즉 링별로 독립 호출한 뒤 부호면적을 합산하면 중공 단면이 자동으로 처리된다:
 *   압축영역 = (외곽 ∩ HP) \ (중공 ∩ HP)
 * 오목 다각형에서 생기는 폭 0 의 퇴화 연결변은 신발끈 공식에서 기여가 0 이므로 무해하다.
 */
export function clipHalfPlane(points: Point[], nx: number, ny: number, sLimit: number): Point[] {
  if (points.length < 3) return [];
  const output: Point[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const currentInside = current.x * nx + current.y * ny >= sLimit;
    const nextInside = next.x * nx + next.y * ny >= sLimit;

    if (currentInside && nextInside) {
      output.push(next);
    } else if (currentInside && !nextInside) {
      output.push(intersectionAtS(current, next, nx, ny, sLimit));
    } else if (!currentInside && nextInside) {
      output.push(intersectionAtS(current, next, nx, ny, sLimit));
      output.push(next);
    }
  }

  return dedupeAdjacent(output);
}

/** 밴드 { sLo <= s <= sHi } 절단. 파이버 적분용. */
export function clipBand(points: Point[], nx: number, ny: number, sLo: number, sHi: number): Point[] {
  const upper = clipHalfPlane(points, nx, ny, sLo);
  if (upper.length < 3) return [];
  // { s <= sHi } == { -s >= -sHi }
  return clipHalfPlane(upper, -nx, -ny, -sHi);
}

/** @deprecated clipHalfPlane(points, 0, 1, yLimit). 1축 호환용. */
export function clipPolygonAboveY(points: Point[], yLimit: number): Point[] {
  return normalizePolygon(clipHalfPlane(points, 0, 1, yLimit));
}

function intersectionAtS(a: Point, b: Point, nx: number, ny: number, sLimit: number): Point {
  const sa = a.x * nx + a.y * ny;
  const sb = b.x * nx + b.y * ny;
  const ds = sb - sa;
  if (Math.abs(ds) < 1e-12) return { x: a.x, y: a.y };
  const t = (sLimit - sa) / ds;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function dedupeAdjacent(points: Point[]): Point[] {
  if (points.length < 2) return points;
  return points.filter((point, index) => {
    const prev = points[(index - 1 + points.length) % points.length];
    return Math.hypot(point.x - prev.x, point.y - prev.y) > 1e-6;
  });
}

// ---------------------------------------------------------------------------
// 링 집합(중공 단면)
// ---------------------------------------------------------------------------

/**
 * 링 방향 정규화: outer = CCW(양의 부호면적), hole = CW(음의 부호면적).
 *
 * 이 규약을 강제하면 면적/도심/2차모멘트/클리핑이 전부 **단순 합산**이 되고
 * 홀 전용 분기가 필요 없어진다.
 */
export function normalizeRings(rings: Ring[]): Ring[] {
  return rings.map((ring) => {
    const points = ring.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const area = signedArea(points);
    const wantPositive = ring.kind === "outer";
    const needsFlip = area !== 0 && wantPositive === area < 0;
    return { ...ring, points: needsFlip ? [...points].reverse() : points };
  });
}

export function outerRings(rings: Ring[]): Ring[] {
  return rings.filter((ring) => ring.kind === "outer");
}

/** 순 단면적 (중공 공제). 정규화된 링을 전제한다. */
export function sectionArea(rings: Ring[]): number {
  let total = 0;
  for (const ring of rings) total += signedArea(ring.points);
  return total;
}

export function sectionCentroid(rings: Ring[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    const a = signedArea(ring.points);
    if (Math.abs(a) < 1e-12) continue;
    const c = centroid(ring.points);
    area += a;
    cx += c.x * a;
    cy += c.y * a;
  }
  if (Math.abs(area) < 1e-9) return { x: 0, y: 0 };
  return { x: cx / area, y: cy / area };
}

export function sectionSecondMoments(rings: Ring[]): SecondMoments {
  let area = 0;
  let ix0 = 0;
  let iy0 = 0;
  let ixy0 = 0;
  for (const ring of rings) {
    area += signedArea(ring.points);
    const m = rawMoments(ring.points);
    ix0 += m.ix0;
    iy0 += m.iy0;
    ixy0 += m.ixy0;
  }
  const c = sectionCentroid(rings);
  return {
    ix: ix0 - area * c.y * c.y,
    iy: iy0 - area * c.x * c.x,
    ixy: ixy0 - area * c.x * c.y,
  };
}

/** 외곽 링만의 경계. 중공은 내부에 있으므로 경계에 기여하지 않는다. */
export function outerBounds(rings: Ring[]) {
  const points = outerRings(rings).flatMap((ring) => ring.points);
  return bounds(points.length > 0 ? points : rings.flatMap((ring) => ring.points));
}

/** 외곽 링 기준 법선방향 투영 범위. */
export function sectionProjectionRange(rings: Ring[], nx: number, ny: number): { sMin: number; sMax: number } {
  const source = outerRings(rings);
  const points = (source.length > 0 ? source : rings).flatMap((ring) => ring.points);
  return projectionRange(points, nx, ny);
}

export function clipRingsHalfPlane(rings: Ring[], nx: number, ny: number, sLimit: number): Ring[] {
  const out: Ring[] = [];
  for (const ring of rings) {
    const clipped = clipHalfPlane(ring.points, nx, ny, sLimit);
    if (clipped.length >= 3) out.push({ ...ring, points: clipped });
  }
  return out;
}

export function clipRingsBand(rings: Ring[], nx: number, ny: number, sLo: number, sHi: number): Ring[] {
  const out: Ring[] = [];
  for (const ring of rings) {
    const clipped = clipBand(ring.points, nx, ny, sLo, sHi);
    if (clipped.length >= 3) out.push({ ...ring, points: clipped });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 형상 생성기
// ---------------------------------------------------------------------------

export function rectanglePolygon(width: number, height: number): Point[] {
  const w = width / 2;
  const h = height / 2;
  return [
    { x: -w, y: -h },
    { x: w, y: -h },
    { x: w, y: h },
    { x: -w, y: h },
  ];
}

export function circlePolygon(diameter: number, segments = 72): Point[] {
  const r = diameter / 2;
  const n = Math.max(3, Math.round(segments));
  return Array.from({ length: n }, (_, i) => {
    const angle = (Math.PI * 2 * i) / n;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
}

export function makeRing(id: string, kind: RingKind, points: Point[]): Ring {
  return { id, kind, points };
}

/** 속찬/중공 직사각형. wallThickness > 0 이면 내부 중공 링을 추가한다. */
export function rectangleRings(width: number, height: number, wallThickness = 0): Ring[] {
  const rings: Ring[] = [makeRing("O1", "outer", rectanglePolygon(width, height))];
  const innerWidth = width - 2 * wallThickness;
  const innerHeight = height - 2 * wallThickness;
  if (wallThickness > 0 && innerWidth > 0 && innerHeight > 0) {
    rings.push(makeRing("H1", "hole", rectanglePolygon(innerWidth, innerHeight)));
  }
  return normalizeRings(rings);
}

/** 속찬/중공 원형. innerDiameter > 0 이면 내부 중공 링을 추가한다. */
export function circleRings(diameter: number, segments = 72, innerDiameter = 0): Ring[] {
  const rings: Ring[] = [makeRing("O1", "outer", circlePolygon(diameter, segments))];
  if (innerDiameter > 0 && innerDiameter < diameter) {
    rings.push(makeRing("H1", "hole", circlePolygon(innerDiameter, segments)));
  }
  return normalizeRings(rings);
}

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

export interface SectionIssue {
  level: "warning" | "error";
  message: string;
}

/**
 * 링 구성 검증. **크래시 대신 경고를 돌려준다** — 사용자가 편집 중인 중간 상태에서도
 * 화면이 죽으면 안 되기 때문이다.
 */
export function validateRings(rings: Ring[]): SectionIssue[] {
  const issues: SectionIssue[] = [];
  const outers = outerRings(rings);
  const holes = rings.filter((r) => r.kind === "hole");

  if (outers.length === 0) issues.push({ level: "error", message: "외곽 링이 없습니다." });
  for (const ring of rings) {
    if (ring.points.length < 3) {
      issues.push({ level: "error", message: `${ring.id}: 절점이 3개 미만입니다.` });
      continue;
    }
    if (Math.abs(signedArea(ring.points)) < 1e-6) {
      issues.push({ level: "error", message: `${ring.id}: 면적이 0 입니다(절점 중복/일직선).` });
    }
    if (hasSelfIntersection(ring.points)) {
      issues.push({ level: "warning", message: `${ring.id}: 변이 서로 교차합니다.` });
    }
  }

  for (const hole of holes) {
    if (hole.points.length < 3) continue;
    const inside = outers.some((outer) => hole.points.every((p) => pointInPolygon(p, outer.points)));
    if (!inside) {
      issues.push({ level: "warning", message: `${hole.id}: 중공이 외곽 링 안에 있지 않습니다.` });
    }
  }

  if (rings.length > 0 && sectionArea(rings) <= 0) {
    issues.push({ level: "error", message: "순 단면적이 0 이하입니다(중공이 외곽보다 큽니다)." });
  }

  return issues;
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < x) inside = !inside;
  }
  return inside;
}

function hasSelfIntersection(points: Point[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue; // 인접 변
      if (segmentsIntersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

// ---------------------------------------------------------------------------
// 철근
// ---------------------------------------------------------------------------

export function rebarArea(diameter: number): number {
  const nominalAreas: Record<number, number> = {
    10: 71.3,
    13: 126.7,
    16: 198.6,
    19: 286.5,
    22: 387.1,
    25: 506.7,
    29: 642.4,
    32: 794.2,
    35: 956.6,
    38: 1140,
    41: 1340,
    51: 2027,
  };
  const nominal = nominalAreas[Math.round(diameter)];
  if (nominal !== undefined) return nominal;
  return (Math.PI * diameter * diameter) / 4;
}
