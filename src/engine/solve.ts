import { axisNormal, sectionProjectionRange } from "./geometry";
import { sectionResponse, type SectionResponse } from "./section";
import {
  angleDistance,
  interpolateAtAxial,
  normalizeAngle,
  type InteractionSurface,
  type SurfacePoint,
} from "./surface";

/**
 * 2축 강도곡면 역해석.
 *
 * 검토는 순방향 계산이 아니라 **역문제**다:
 *   주어진 (Pu, Mux, Muy) 에 대해
 *   α_e(θ, c) = α_e,demand  이고  Pn(θ, c) = Pu  인 (θ, c) 를 찾는다.
 *
 * ★ 흔한 오류: 편심 방향 α_e 만큼 단면을 회전시키고 1축 계산을 돌리는 것.
 *   일반 단면에서 α_e(θ) != θ 이므로 틀린다(세장비가 크면 10~30도 벌어진다).
 *
 * 구조:
 *   inner  이분법으로 Pn(θ, c) = Pu 인 c        (Pn 은 c 에 대해 단조 증가 -> 항상 수렴)
 *   outer  α_e(θ) - α_e,target 의 부호변화 구간을 **모두** 수집해 각각 정밀화
 *          (비대칭 배근/L형 단면에서 α_e(θ) 가 비단조일 수 있으므로 단순 이분법은 위험)
 */

export interface CapacityResult {
  theta: number;
  c: number;
  /** 실제 도달한 편심 방향. 수렴 확인용. */
  alphaE: number;
  pn: number;
  mnx: number;
  mny: number;
  phi: number;
  pd: number;
  mdx: number;
  mdy: number;
  /** 설계 모멘트 크기 */
  md: number;
  maxTensileStrain: number;
  cappedByAxialLimit: boolean;
  iterations: number;
  response: SectionResponse;
}

const THETA_TOLERANCE = 1e-5; // rad, 약 0.0006도
const AXIAL_TOLERANCE = 1e-8; // 상대
const MAX_BISECTIONS = 80;

/**
 * 주어진 축력 Pu 와 편심방향 α_e 에서 곡면 위의 점을 찾는다.
 * 해가 여럿이면 모멘트가 가장 큰(= 바깥쪽) 해를 채택한다.
 */
export function capacityAt(
  surface: InteractionSurface,
  pu: number,
  alphaE: number,
  useDesign = true,
): CapacityResult | undefined {
  const target = normalizeAngle(alphaE);

  // --- coarse: 이미 계산된 자오선을 재사용한다 (추가 단면적분 0회) ---------
  // 각 θ 자오선에서 축력 = pu 인 점을 선형보간해 α_e(θ) 표를 만든다.
  const coarse: { theta: number; alphaE: number }[] = [];
  for (let i = 0; i < surface.thetas.length; i += 1) {
    const hit = interpolateAtAxial(surface.meridians[i], pu, useDesign);
    if (!hit) continue;
    if (Math.hypot(hit.mx, hit.my) < 1e-9) continue; // 순압축 근처: 방향 정보 없음
    coarse.push({ theta: surface.thetas[i], alphaE: Math.atan2(hit.mx, hit.my) });
  }

  // ★ 고축력 폴백.
  //   자오선(surface.ts buildMeridian)은 c 를 1.8·h_θ 까지만 훑으므로 순압축 근처의
  //   축력에는 닿지 못한다. 예: 800x1000 fck80 한계상태설계법 단면에서
  //   자오선 최대 축력 38655 kN < Pn0 44278 kN 이라 그 사이가 통째로 빈다.
  //   그럴 때 꼬리를 연장해 브래킷용 표를 다시 만든다.
  //   (표가 **부분적으로만** 비는 경우는 폴백이 필요 없다 — 남은 점들로 브래킷을 잡고
  //    refineTheta 가 solveAtTheta 로 정밀화하므로 그 자체가 전 범위를 본다.)
  if (coarse.length === 0) {
    for (const theta of surface.thetas) {
      const alpha = tailAlphaE(surface, theta, pu, useDesign);
      if (alpha !== undefined) coarse.push({ theta, alphaE: alpha });
    }
  }
  if (coarse.length === 0) return undefined;

  // --- 부호변화 구간을 모두 수집 -------------------------------------------
  // α_e(θ) 는 비대칭 단면에서 비단조일 수 있으므로 단일 브래킷을 가정하지 않는다.
  const candidates: CapacityResult[] = [];
  for (let i = 0; i < coarse.length; i += 1) {
    const a = coarse[i];
    const b = coarse[(i + 1) % coarse.length];
    const da = signedAngleDiff(a.alphaE, target);
    const db = signedAngleDiff(b.alphaE, target);

    if (Math.abs(da) < THETA_TOLERANCE) {
      const exact = solveAtTheta(surface, a.theta, pu, useDesign);
      if (exact) candidates.push(exact);
      continue;
    }
    // 각도 점프(±pi 부근의 감김)는 실제 교차가 아니므로 제외한다.
    if (da * db < 0 && Math.abs(da) + Math.abs(db) < Math.PI) {
      const refined = refineTheta(surface, a.theta, b.theta, pu, target, useDesign);
      if (refined) candidates.push(refined);
    }
  }

  if (candidates.length === 0) {
    // 보간 표가 놓친 경우의 안전망: 가장 가까운 θ 에서 직접 푼다.
    let bestTheta = coarse[0].theta;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const item of coarse) {
      const diff = Math.abs(signedAngleDiff(item.alphaE, target));
      if (diff < bestDiff) {
        bestDiff = diff;
        bestTheta = item.theta;
      }
    }
    return solveAtTheta(surface, bestTheta, pu, useDesign);
  }

  return candidates.reduce((best, item) => (item.md > best.md ? item : best));
}

/**
 * 자오선 꼬리 연장: c 를 순압축 쪽으로 더 밀어 α_e(θ) 를 얻는다.
 *
 * 여기서 만드는 값은 **브래킷용 근사**다. 실제 해는 refineTheta 가 solveAtTheta 로
 * 정밀화하므로 몇 점 선형보간이면 충분하다. 대신 θ 를 솎아내지 않고 72방향을 그대로
 * 유지해 브래킷 해상도를 잃지 않는다 — θ 마다 solveAtTheta(≈128회 적분)를 부르는 것보다
 * 훨씬 싸다(평균 2~3회 적분).
 */
const TAIL_FACTORS = [1.8, 2.6, 4, 7, 14, 40];

function tailAlphaE(
  surface: InteractionSurface,
  theta: number,
  pu: number,
  useDesign: boolean,
): number | undefined {
  const { nx, ny } = axisNormal(theta);
  const { sMin, sMax } = sectionProjectionRange(surface.section.rings, nx, ny);
  const depth = sMax - sMin;
  if (!Number.isFinite(depth) || depth <= 0) return undefined;

  let previous: { p: number; mx: number; my: number } | undefined;
  for (const factor of TAIL_FACTORS) {
    const response = evaluate(surface, theta, factor * depth);
    const current = {
      p: useDesign ? response.pd : response.pn,
      mx: useDesign ? response.mdx : response.mnx,
      my: useDesign ? response.mdy : response.mny,
    };
    if (previous && pu >= Math.min(previous.p, current.p) && pu <= Math.max(previous.p, current.p)) {
      const span = current.p - previous.p;
      const t = Math.abs(span) < 1e-12 ? 0 : (pu - previous.p) / span;
      const mx = previous.mx + (current.mx - previous.mx) * t;
      const my = previous.my + (current.my - previous.my) * t;
      if (Math.hypot(mx, my) < 1e-9) return undefined; // 순압축: 방향 정보 없음
      return Math.atan2(mx, my);
    }
    previous = current;
  }
  return undefined;
}

/** outer loop: θ 구간을 이분해 α_e 를 목표에 맞춘다. */
function refineTheta(
  surface: InteractionSurface,
  thetaLo: number,
  thetaHi: number,
  pu: number,
  target: number,
  useDesign: boolean,
): CapacityResult | undefined {
  let lo = thetaLo;
  let hi = unwrapTowards(thetaHi, thetaLo);
  let loResult = solveAtTheta(surface, lo, pu, useDesign);
  let hiResult = solveAtTheta(surface, hi, pu, useDesign);
  if (!loResult || !hiResult) return undefined;

  let dLo = signedAngleDiff(loResult.alphaE, target);
  let best = Math.abs(dLo) < Math.abs(signedAngleDiff(hiResult.alphaE, target)) ? loResult : hiResult;
  let iterations = 0;

  for (; iterations < MAX_BISECTIONS; iterations += 1) {
    const mid = (lo + hi) / 2;
    const midResult = solveAtTheta(surface, mid, pu, useDesign);
    if (!midResult) return best;
    const dMid = signedAngleDiff(midResult.alphaE, target);
    best = midResult;

    if (Math.abs(dMid) < THETA_TOLERANCE || Math.abs(hi - lo) < THETA_TOLERANCE) break;

    if (dLo * dMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      dLo = dMid;
    }
  }

  return { ...best, iterations: best.iterations + iterations };
}

const C_SAMPLES = 48;

/**
 * inner loop: θ 고정, 축력이 pu 가 되는 c 를 찾는다.
 *
 * ★ 설계축력은 **상한 적용 전(uncapped)** 값으로 탐색한다.
 *   상한을 적용한 φPn 은 c 가 깊어지면 cap 에서 평탄해져(예: c ≥ 1009mm 에서 전부 8542kN)
 *   이분법이 평탄면 위를 헤매다 사실상 순압축(모멘트≈0)으로 발산한다.
 *   uncapped φPn 은 단조에 가까우므로 유일한 c 로 수렴하고, 그 점이 곧
 *   "절단면 P = cap 위에서 모멘트가 최대인 점" 이다.
 *
 * ★ φ 가 c 에 따라 0.85 -> 0.65 로 변하므로 φPn 이 국소적으로 비단조일 수 있다(§1.6).
 *   따라서 단일 이분법이 아니라 표본 격자에서 **모든 교차 구간**을 수집해 각각 정밀화하고,
 *   그중 모멘트가 가장 큰(= 바깥쪽) 해를 채택한다.
 */
export function solveAtTheta(
  surface: InteractionSurface,
  theta: number,
  pu: number,
  useDesign = true,
): CapacityResult | undefined {
  const { nx, ny } = axisNormal(theta);
  const { sMin, sMax } = sectionProjectionRange(surface.section.rings, nx, ny);
  const depth = sMax - sMin;
  if (!Number.isFinite(depth) || depth <= 0) return undefined;

  // 상한 미적용 축력. 상한은 결과 보고 단계에서만 clamp 한다.
  const axialOf = (c: number) => {
    const response = evaluate(surface, theta, c);
    return { value: useDesign ? response.pd : response.pn, response };
  };

  const cMin = 1e-4 * depth;
  const cMax = 40 * depth;
  const samples: { c: number; value: number; response: SectionResponse }[] = [];
  for (let i = 0; i < C_SAMPLES; i += 1) {
    // 얕은 쪽(인장지배)에 표본을 몰아주기 위해 기하 분포를 쓴다.
    const t = i / (C_SAMPLES - 1);
    const c = cMin * (cMax / cMin) ** t;
    const { value, response } = axialOf(c);
    samples.push({ c, value, response });
  }

  const roots: CapacityResult[] = [];
  const tolerance = Math.max(1, Math.abs(pu)) * AXIAL_TOLERANCE;

  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (pu < Math.min(a.value, b.value) - tolerance) continue;
    if (pu > Math.max(a.value, b.value) + tolerance) continue;

    let lo = a.c;
    let hi = b.c;
    let loValue = a.value;
    let current = b;
    let iterations = 0;

    for (; iterations < MAX_BISECTIONS; iterations += 1) {
      const mid = (lo + hi) / 2;
      const evaluated = axialOf(mid);
      current = { c: mid, value: evaluated.value, response: evaluated.response };
      if (Math.abs(evaluated.value - pu) < tolerance || hi - lo < cMin * 1e-6) break;
      if ((loValue < pu) === (evaluated.value < pu)) {
        lo = mid;
        loValue = evaluated.value;
      } else {
        hi = mid;
      }
    }

    roots.push(toCapacity(surface, theta, current.c, current.response, iterations));
  }

  if (roots.length === 0) return undefined;
  return roots.reduce((best, item) => (item.md > best.md ? item : best));
}

function evaluate(surface: InteractionSurface, theta: number, c: number): SectionResponse {
  return sectionResponse(surface.section, surface.materials, surface.code, { theta, c }, surface.integration);
}

function toCapacity(
  surface: InteractionSurface,
  theta: number,
  c: number,
  response: SectionResponse,
  iterations: number,
): CapacityResult {
  // 모멘트는 비례축소하지 않는다(surface.ts 의 toSurfacePoint 와 같은 이유).
  const capped = Number.isFinite(surface.axialCap) && response.pd > surface.axialCap;
  const pd = capped ? surface.axialCap : response.pd;
  const mdx = response.mdx;
  const mdy = response.mdy;

  return {
    theta: normalizeAngle(theta),
    c,
    alphaE: Math.atan2(response.mnx, response.mny),
    pn: response.pn,
    mnx: response.mnx,
    mny: response.mny,
    phi: response.phi,
    pd,
    mdx,
    mdy,
    md: Math.hypot(mdx, mdy),
    maxTensileStrain: response.maxTensileStrain,
    cappedByAxialLimit: capped,
    iterations,
    response,
  };
}

// ---------------------------------------------------------------------------
// 각도 유틸
// ---------------------------------------------------------------------------

/** a - b 를 (-pi, pi] 로 감아 부호를 살린 차이. 이분법 브래킷 판정에 필요하다. */
export function signedAngleDiff(a: number, b: number): number {
  let d = normalizeAngle(a) - normalizeAngle(b);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** target 을 reference 에서 반 바퀴 이내가 되도록 풀어준다(구간 이분용). */
function unwrapTowards(target: number, reference: number): number {
  let value = target;
  while (value - reference > Math.PI) value -= 2 * Math.PI;
  while (value - reference <= -Math.PI) value += 2 * Math.PI;
  return value;
}

export { angleDistance };
export type { SurfacePoint };
