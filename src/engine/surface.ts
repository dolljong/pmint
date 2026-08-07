import { axisNormal, normalizeRings, outerRings, sectionArea, sectionProjectionRange } from "./geometry";
import { designCodes, type DesignCodeStrategy } from "./designCodes";
import {
  plasticCentroid,
  pureCompression,
  pureTension,
  rebarTotalArea,
  sectionResponse,
  type IntegrationMethod,
  type IntegrationOptions,
  type SectionResponse,
} from "./section";
import type { DesignCodeId, MaterialSet, Point, SectionModel, TransverseReinforcement } from "./types";

/**
 * 2축 강도곡면 (biaxial interaction surface).
 *
 * 1축이 (M, P) 평면의 **곡선**이었다면 2축은 (Mx, My, P) 공간의 **곡면**이다.
 * 미지수가 c 하나에서 (θ, c) 둘로 늘어나므로, 곡면은 자오선(meridian) 다발로 표현한다.
 *
 *   meridians[i] = θ_i 를 고정하고 c 를 훑은 계산점 열
 *
 * θ 는 중립축 **법선** 각도이며 압축측을 향한다. θ = π/2 자오선이 기존 1축 곡선이다.
 *
 * ★ 핵심: 편심벡터 방향 α_e 는 일반적으로 θ 와 같지 않다(§1.3).
 *   따라서 각 점에 α_e 를 함께 저장해 두고, 검토(solve.ts)에서 θ 를 역으로 찾는다.
 */
export interface SurfacePoint {
  id: string;
  theta: number;
  c: number;
  pn: number;
  mnx: number;
  mny: number;
  /** 공칭 모멘트 크기 |M| */
  mn: number;
  phi: number;
  /** 축력 상한 clamp 적용 후 설계축력 */
  pd: number;
  /** 상한 미적용 설계축력 φPn. 역해석의 탐색 대상은 **이쪽**이다(평탄면 회피). */
  pdRaw: number;
  mdx: number;
  mdy: number;
  /** 설계 모멘트 크기 |Md| */
  md: number;
  /**
   * 편심벡터 방향 atan2(Mx, My) = atan2(e_y, e_x).
   * 1축 대칭에서만 α_e = θ 가 성립한다.
   */
  alphaE: number;
  maxTensileStrain: number;
  /** 축력 상한(kds_strength)에 의해 잘린 점인지 */
  cappedByAxialLimit: boolean;
  response: SectionResponse;
}

export interface InteractionSurface {
  thetas: number[];
  /** [θ index][c index] */
  meridians: SurfacePoint[][];
  pureCompression: SurfacePoint;
  pureTension: SurfacePoint;
  /** 모멘트 기준점 = 소성중심 */
  reference: Point;
  /** 공칭 순압축강도 Pn0 */
  pn0: number;
  /** α_limit (띠 0.80 / 나선 0.85, 한계상태설계법은 1) */
  axialLimitFactor: number;
  /** 설계 축력 상한 = α_limit · φ · Pn0. 곡면 상단을 자르는 평면. */
  axialCap: number;
  grossArea: number;
  steelArea: number;
  code: DesignCodeStrategy;
  materials: MaterialSet;
  section: SectionModel;
  integration: IntegrationOptions;
}

export interface SurfaceOptions {
  designCode: DesignCodeId;
  /** θ 분할 수. 기본 72 (5도 간격). */
  thetaSteps?: number;
  /** 자오선당 c 분할 수. 기본 60. */
  cSteps?: number;
  transverseReinforcement?: TransverseReinforcement;
  /** 콘크리트 압축영역 적분 방식. 미지정이면 설계법 기본값. */
  method?: IntegrationMethod;
  /** 파이버 밴드 수 */
  fiberBands?: number;
  /** EC2 3.1.7(3) 테이퍼 10% 저감 (등가블록 전용) */
  taperReduction?: boolean;
}

export const DEFAULT_THETA_STEPS = 72;
export const DEFAULT_C_STEPS = 60;

export function computeSurface(
  section: SectionModel,
  materials: MaterialSet,
  options: SurfaceOptions,
): InteractionSurface | undefined {
  const rings = normalizeRings(section.rings);
  const outers = outerRings(rings);
  if (outers.length === 0 || outers.every((ring) => ring.points.length < 3)) return undefined;
  if (section.rebars.length === 0) return undefined;

  const model: SectionModel = { rings, rebars: section.rebars };
  const code = designCodes[options.designCode];
  const transverse = options.transverseReinforcement ?? "tie";
  // 여기서 한 번 확정해 둔다. surface.integration 을 읽는 쪽(UI/보고서)이
  // undefined 를 만나 "등가블록이겠지" 라고 오해하지 않도록.
  const method = options.method ?? code.defaultIntegration;
  const integration: IntegrationOptions = {
    transverseReinforcement: transverse,
    reference: plasticCentroid(model, materials, code, method),
    method,
    fiberBands: options.fiberBands,
    taperReduction: options.taperReduction,
  };

  const thetaSteps = Math.max(4, Math.round(options.thetaSteps ?? DEFAULT_THETA_STEPS));
  const cSteps = Math.max(8, Math.round(options.cSteps ?? DEFAULT_C_STEPS));

  const compression = pureCompression(model, materials, code, integration);
  const tension = pureTension(model, materials, code, integration);
  const pn0 = compression.pn;
  const axialLimitFactor = code.axialLimitFactor(transverse);
  const axialCap = axialLimitFactor * compression.phi * pn0;

  const thetas: number[] = [];
  const meridians: SurfacePoint[][] = [];

  // θ 는 0 ~ 2π 전 구간을 훑는다. 비대칭 단면/배근에서는 반대편이 다른 값을 주기 때문이다.
  for (let i = 0; i < thetaSteps; i += 1) {
    const theta = (2 * Math.PI * i) / thetaSteps;
    thetas.push(theta);
    meridians.push(buildMeridian(model, materials, code, integration, theta, cSteps, `m${i}`, axialCap));
  }

  return {
    thetas,
    meridians,
    pureCompression: toSurfacePoint("pure-compression", Number.NaN, Number.POSITIVE_INFINITY, compression, axialCap),
    pureTension: toSurfacePoint("pure-tension", Number.NaN, Number.POSITIVE_INFINITY, tension, axialCap),
    reference: integration.reference!,
    pn0,
    axialLimitFactor,
    axialCap,
    grossArea: sectionArea(rings),
    steelArea: rebarTotalArea(section.rebars),
    code,
    materials,
    section: model,
    integration,
  };
}

function buildMeridian(
  model: SectionModel,
  materials: MaterialSet,
  code: DesignCodeStrategy,
  integration: IntegrationOptions,
  theta: number,
  cSteps: number,
  idPrefix: string,
  axialCap: number,
): SurfacePoint[] {
  const { nx, ny } = axisNormal(theta);
  const { sMin, sMax } = sectionProjectionRange(model.rings, nx, ny);
  // h_θ = 법선 방향 단면 깊이. θ 마다 달라지므로 c 범위를 여기에 맞춰 스케일한다.
  const depth = sMax - sMin;
  const points: SurfacePoint[] = [];

  for (let j = 0; j < cSteps; j += 1) {
    const ratio = j / (cSteps - 1);
    const c = 0.02 * depth + ratio * 1.8 * depth;
    const response = sectionResponse(model, materials, code, { theta, c }, integration);
    points.push(toSurfacePoint(`${idPrefix}-${j}`, theta, c, response, axialCap));
  }

  return points;
}

export interface MeridianOptions {
  /** c 분할 수. 기본은 곡면과 동일. */
  cSteps?: number;
  /**
   * 순압축 쪽으로 잇는 꼬리 점 수. 0 이면 buildMeridian 과 완전히 같은 c 범위다.
   *
   * 자오선의 c 상한 1.8·h_θ 는 Pn0 에 못 미친다(800x1000 fck80 에서 38655 < 44278).
   * 그 사이 축력의 하중케이스는 곡선이 **끝나기 전에** 점이 떠 버리므로, 화면·보고서는
   * 꼬리를 붙여 곡선을 순압축까지 잇는다. 검토(solve.ts)는 자체적으로 c 를 40·h_θ 까지
   * 훑으므로 이 꼬리와 무관하다.
   */
  tailSteps?: number;
}

/** 꼬리 끝 c. solveAtTheta 의 탐색 상한과 맞춘다. */
const TAIL_C_FACTOR = 40;

/**
 * 임의 θ 의 자오선을 즉석 계산한다.
 *
 * meridianAt() 은 미리 계산해 둔 thetaSteps 방향 중 **가장 가까운 것**을 고르므로
 * 최대 반칸(기본 2.5도) 어긋난다. 검토(solve.ts capacityAt)는 역해석으로 정확한 θ 를
 * 0.0006도 까지 수렴시키는데 화면 곡선만 격자에 스냅하면, 사용률이 정확히 1.0 인
 * 하중점이 곡선 **안쪽**에 찍혀 여유가 있는 것처럼 보인다.
 * 800x1000 fck80 한계상태설계법 LC2 에서 θ 2.02도 차이가 |Md| 2.25% 차이로 나타났다.
 *
 * 비용은 곡면 생성의 1/thetaSteps (기본 1/72).
 */
export function meridianAtTheta(
  surface: InteractionSurface,
  theta: number,
  options: MeridianOptions = {},
): SurfacePoint[] {
  const angle = normalizeAngle(theta);
  const steps = Math.max(8, Math.round(options.cSteps ?? surface.meridians[0]?.length ?? DEFAULT_C_STEPS));
  const body = buildMeridian(
    surface.section,
    surface.materials,
    surface.code,
    surface.integration,
    angle,
    steps,
    "exact",
    surface.axialCap,
  );

  const tailSteps = Math.max(0, Math.round(options.tailSteps ?? 0));
  if (tailSteps === 0 || body.length === 0) return body;

  const { nx, ny } = axisNormal(angle);
  const { sMin, sMax } = sectionProjectionRange(surface.section.rings, nx, ny);
  const depth = sMax - sMin;
  const cStart = body[body.length - 1].c;
  const cEnd = TAIL_C_FACTOR * depth;
  if (!(depth > 0) || !(cEnd > cStart)) return body;

  const tail: SurfacePoint[] = [];
  for (let i = 1; i <= tailSteps; i += 1) {
    // 기하 분포. 축력은 c 에 대해 빠르게 포화하므로 균등 분할은 낭비다.
    const c = cStart * (cEnd / cStart) ** (i / tailSteps);
    const response = sectionResponse(surface.section, surface.materials, surface.code, { theta: angle, c }, surface.integration);
    tail.push(toSurfacePoint(`exact-tail-${i}`, angle, c, response, surface.axialCap));
  }

  return [...body, ...tail];
}

function toSurfacePoint(
  id: string,
  theta: number,
  c: number,
  response: SectionResponse,
  axialCap: number,
): SurfacePoint {
  // 축력 상한: 강도설계법에서 최소편심 조항을 대체하는 장치. 곡면 상단을 평면으로 **자른다**.
  // 수요(하중)는 건드리지 않는다 — 한계상태설계법의 최소모멘트와 정반대 위치의 처리다.
  //
  // 주의: 잘린 점의 모멘트를 비례축소하면 안 된다. 그건 원래 곡면에 없던 점을 지어내는 것이다.
  // 절단면 P = cap 위에서 쓸 수 있는 최대 모멘트는 "φPn 이 cap 에 처음 도달하는 c" 의 모멘트이며,
  // 그보다 깊은 c 는 모멘트가 더 작아 자동으로 열등해진다. 따라서 축력만 clamp 하고 모멘트는 그대로 둔다.
  const capped = Number.isFinite(axialCap) && response.pd > axialCap;
  const pd = capped ? axialCap : response.pd;
  const mdx = response.mdx;
  const mdy = response.mdy;

  return {
    id,
    theta,
    c,
    pn: response.pn,
    mnx: response.mnx,
    mny: response.mny,
    mn: Math.hypot(response.mnx, response.mny),
    phi: response.phi,
    pd,
    pdRaw: response.pd,
    mdx,
    mdy,
    md: Math.hypot(mdx, mdy),
    alphaE: Math.atan2(response.mnx, response.mny),
    maxTensileStrain: response.maxTensileStrain,
    cappedByAxialLimit: capped,
    response,
  };
}

/**
 * 주어진 축력에서의 Mx-My 등고선(수평 절단면).
 *
 * 각 자오선에서 Pn(또는 Pd) = p 인 점을 선형보간으로 찾아 잇는다.
 * 자오선 위에서 축력은 c 에 대해 단조 증가하므로 교점 탐색이 안정적이다.
 */
export function momentContour(
  surface: InteractionSurface,
  p: number,
  useDesign = true,
): { mx: number; my: number; theta: number }[] {
  const contour: { mx: number; my: number; theta: number }[] = [];

  for (const meridian of surface.meridians) {
    const hit = interpolateAtAxial(meridian, p, useDesign);
    if (hit) contour.push(hit);
  }

  return contour;
}

export function interpolateAtAxial(
  meridian: SurfacePoint[],
  p: number,
  useDesign: boolean,
): { mx: number; my: number; theta: number; c: number } | undefined {
  // 설계 경로는 상한 미적용 값(pdRaw)으로 교차를 찾는다. clamp 된 pd 는 평탄면이라 역해석이 불가능하다.
  const axial = (point: SurfacePoint) => (useDesign ? point.pdRaw : point.pn);
  const mxOf = (point: SurfacePoint) => (useDesign ? point.mdx : point.mnx);
  const myOf = (point: SurfacePoint) => (useDesign ? point.mdy : point.mny);

  let best: { mx: number; my: number; theta: number; c: number } | undefined;
  let bestMagnitude = -1;

  for (let i = 1; i < meridian.length; i += 1) {
    const a = meridian[i - 1];
    const b = meridian[i];
    const pa = axial(a);
    const pb = axial(b);
    if (p < Math.min(pa, pb) || p > Math.max(pa, pb)) continue;
    const span = pb - pa;
    const t = Math.abs(span) < 1e-12 ? 0 : (p - pa) / span;
    const candidate = {
      mx: mxOf(a) + (mxOf(b) - mxOf(a)) * t,
      my: myOf(a) + (myOf(b) - myOf(a)) * t,
      theta: a.theta,
      c: a.c + (b.c - a.c) * t,
    };
    // 축력 상한으로 잘린 구간은 여러 점이 같은 P 를 가질 수 있다.
    // 그중 모멘트가 가장 큰(= 바깥쪽) 해를 강도로 채택한다.
    const magnitude = Math.hypot(candidate.mx, candidate.my);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      best = candidate;
    }
  }

  return best;
}

/** θ 자오선을 (|M|, P) 1축 곡선처럼 보기 위한 슬라이스. */
export function meridianAt(surface: InteractionSurface, theta: number): SurfacePoint[] {
  const target = normalizeAngle(theta);
  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < surface.thetas.length; i += 1) {
    const diff = angleDistance(surface.thetas[i], target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return surface.meridians[bestIndex];
}

export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

export function angleDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, Math.PI * 2 - diff);
}
