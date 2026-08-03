import {
  axisNormal,
  clipRingsBand,
  clipRingsHalfPlane,
  project,
  rebarArea,
  sectionArea,
  sectionCentroid,
  sectionProjectionRange,
} from "./geometry";
import { parabolicRectangularLaw, parabolicRectangularStress } from "./concreteLaw";
import type { DesignCodeStrategy } from "./designCodes";
import type { MaterialSet, Point, Ring, SectionModel, TransverseReinforcement } from "./types";

/**
 * 단면 적분 프리미티브.
 *
 * P-M 곡면, 평형상태, 작용편심 Trial 계산이 **모두** 이 함수 하나를 거친다.
 * 기존에 computePM / computeBalancedState / computeSectionComponentsAtC 3곳에
 * 복붙되어 있던 로직을 통합한 것이다.
 *
 * 좌표계 / 부호 규약
 *   n̂ = (cos θ, sin θ)   중립축 법선, **압축측**을 향한다
 *   s  = x·nx + y·ny      법선 방향 좌표
 *   sMax = 최압축 연단,  c = sMax 로부터의 중립축 깊이
 *   ε(x,y) = ecu · (s - (sMax - c)) / c        압축 +
 *   Pn  = ΣF                                    압축 +
 *   Mnx = ΣF·(y - y_ref) = Pn·e_y               x축 회전 모멘트
 *   Mny = ΣF·(x - x_ref) = Pn·e_x               y축 회전 모멘트
 *
 * θ = π/2 이면 n̂ = (0,1) 이므로 s = y, sMax = maxY 가 되어 기존 1축 계산과 동일하다.
 */
export interface StrainState {
  /** 중립축 법선 각도(rad). 압축측을 향한다. */
  theta: number;
  /** 중립축 깊이. 최압축 연단 기준. Infinity 면 순압축(균일 ecu). */
  c: number;
}

export type IntegrationMethod = "equivalent_block" | "fiber";

export interface IntegrationOptions {
  transverseReinforcement: TransverseReinforcement;
  /** 모멘트 기준점. 미지정이면 소성중심. */
  reference?: Point;
  /** 콘크리트 압축영역 적분 방식. 기본 등가블록. */
  method?: IntegrationMethod;
  /** fiber 방식의 밴드 수. 기본 60. 오차 O(1/N^2). */
  fiberBands?: number;
  /**
   * EC2 3.1.7(3): 압축 연단 쪽으로 폭이 감소하는(테이퍼) 압축영역에서 η·fcd 를 10% 저감.
   * 2축의 삼각형 압축영역에서 등가블록이 압축력을 과대평가하는 것을 보정한다.
   * equivalent_block 방식에만 적용된다.
   */
  taperReduction?: boolean;
}

/**
 * 소성중심 (plastic centroid).
 *
 * KDS 14 20 20: "압축부재 단면의 편심거리는 **소성중심**으로부터 축력 작용점까지의 거리"
 * 즉 P-M 상관도의 모멘트 기준점은 콘크리트 기하 도심이 아니라 소성중심이어야 한다.
 * 순압축 상태(전 단면 균일 압축)에서 합력이 작용하는 점이며, 이 점을 기준으로 잡아야
 * 순압축점이 정확히 (Mnx, Mny) = (0, 0) 에 떨어진다.
 *
 *   D    = α·fcd·Ac + Σ (fyd - α·fcd)·As_i
 *   x_pc = [ α·fcd·Ac·x_c + Σ (fyd - α·fcd)·As_i·x_i ] / D
 *
 * 대칭 단면 + 대칭 배근이면 기하 도심과 일치하므로 1축 기존 결과는 변하지 않는다.
 * 비대칭 배근에서만 값이 달라지며, 그것이 올바른 방향이다.
 */
export function plasticCentroid(
  section: SectionModel,
  materials: MaterialSet,
  code: DesignCodeStrategy,
): Point {
  const fc = materials.concrete.fc / code.materialFactors.concrete;
  const fy = materials.steel.fy / code.materialFactors.steel;
  const block = code.stressBlock(fc);
  const concreteStress = block.alpha * fc;

  const area = sectionArea(section.rings);
  const geo = sectionCentroid(section.rings);
  let denom = concreteStress * area;
  let sx = concreteStress * area * geo.x;
  let sy = concreteStress * area * geo.y;

  for (const bar of section.rebars) {
    const netStress = fy - concreteStress;
    const w = netStress * rebarArea(bar.diameter);
    denom += w;
    sx += w * bar.x;
    sy += w * bar.y;
  }

  if (Math.abs(denom) < 1e-9) return geo;
  return { x: sx / denom, y: sy / denom };
}

export interface NeutralAxisInfo {
  theta: number;
  nx: number;
  ny: number;
  c: number;
  sMax: number;
  sMin: number;
  /** 법선 방향 단면 깊이 h_θ */
  depth: number;
  /** 등가응력블록 깊이 a = β1·c */
  a: number;
  /** 등가블록 하단의 s 좌표 */
  blockLimit: number;
}

export interface BarResponse {
  id: string;
  x: number;
  y: number;
  s: number;
  area: number;
  strain: number;
  /** 클램프된 철근 응력 (±fyd) */
  stress: number;
  /** 압축측 콘크리트 치환 공제를 반영한 유효응력 */
  netStress: number;
  /** kN, 압축 + */
  force: number;
  compression: boolean;
}

export interface SectionResponse {
  neutralAxis: NeutralAxisInfo;
  concrete: {
    /** 압축영역. 중공 링을 포함하므로 렌더링 시 fill-rule="evenodd" 가 필요하다. */
    rings: Ring[];
    /** 순 압축면적 (중공 공제). */
    area: number;
    centroid: Point;
    /** kN */
    force: number;
    /** kN-m */
    mx: number;
    my: number;
  };
  bars: BarResponse[];
  steel: {
    compressionForce: number;
    tensionForce: number;
    compressionMx: number;
    tensionMx: number;
    compressionMy: number;
    tensionMy: number;
  };
  reference: Point;
  pn: number;
  mnx: number;
  mny: number;
  maxTensileStrain: number;
  phi: number;
  pd: number;
  mdx: number;
  mdy: number;
}

export function sectionResponse(
  section: SectionModel,
  materials: MaterialSet,
  code: DesignCodeStrategy,
  state: StrainState,
  options: IntegrationOptions,
): SectionResponse {
  const rings = section.rings;
  const { nx, ny } = axisNormal(state.theta);
  const { sMin, sMax } = sectionProjectionRange(rings, nx, ny);
  const fc = materials.concrete.fc / code.materialFactors.concrete;
  const fy = materials.steel.fy / code.materialFactors.steel;
  const block = code.stressBlock(fc);
  const reference = options.reference ?? plasticCentroid(section, materials, code);

  const finiteC = Number.isFinite(state.c);
  const method = options.method ?? "equivalent_block";
  const a = finiteC ? block.beta * state.c : Number.POSITIVE_INFINITY;
  const blockLimit = finiteC ? sMax - a : Number.NEGATIVE_INFINITY;

  // 링별 독립 절단 + 부호면적 합산 -> (외곽 ∩ HP) \ (중공 ∩ HP) 가 자동으로 성립한다.
  const compressed = finiteC ? clipRingsHalfPlane(rings, nx, ny, blockLimit) : rings;
  const concArea = sectionArea(compressed);
  const concCentroid = concArea > 1e-9 ? sectionCentroid(compressed) : { x: 0, y: 0 };

  const concreteIntegral =
    method === "fiber"
      ? integrateFiber(
          rings,
          nx,
          ny,
          sMax,
          state.c,
          // 정점응력은 등가블록과 **같은** α·fcd 를 쓴다.
          // 0.85 는 지속하중/치수효과 보정이며 응력법칙의 형상과 무관하게 적용된다.
          // 이걸 fcd 로 두면 두 엔진이 1/0.85 = 17.6% 어긋난다.
          block.alpha * fc,
          materials.concrete.fc,
          reference,
          options.fiberBands ?? 60,
        )
      : integrateEquivalentBlock(
          compressed,
          concArea,
          concCentroid,
          block.alpha * fc,
          reference,
          options.taperReduction === true && finiteC
            ? isTaperedTowardExtremeFibre(compressed, nx, ny)
            : false,
        );

  const concreteForce = concreteIntegral.force;
  const concreteMx = concreteIntegral.mx;
  const concreteMy = concreteIntegral.my;

  let pn = concreteForce;
  let mnx = concreteMx;
  let mny = concreteMy;
  let maxTensileStrain = 0;
  let compressionForce = 0;
  let tensionForce = 0;
  let compressionMx = 0;
  let tensionMx = 0;
  let compressionMy = 0;
  let tensionMy = 0;

  const bars: BarResponse[] = [];
  for (const bar of section.rebars) {
    const s = project(bar, nx, ny);
    const strain = finiteC ? materials.concrete.ecu * (1 - (sMax - s) / state.c) : materials.concrete.ecu;
    const stress = clamp(strain * materials.steel.es, -fy, fy);
    const compression = strain > 0;
    // 압축측 철근은 등가 콘크리트 응력과 중복되는 면적을 공제한다.
    // (docs/compression-steel-stress-block-review.md 의 판단: 등가블록 내부 여부가 아니라
    //  중립축 기준 압축측 여부로 판정)
    const netStress = compression && stress > 0 ? stress - block.alpha * fc : stress;
    const area = rebarArea(bar.diameter);
    const force = (netStress * area) / 1000;
    const mx = (force * (bar.y - reference.y)) / 1000;
    const my = (force * (bar.x - reference.x)) / 1000;

    pn += force;
    mnx += mx;
    mny += my;
    maxTensileStrain = Math.max(maxTensileStrain, Math.max(0, -strain));

    if (compression) {
      compressionForce += force;
      compressionMx += mx;
      compressionMy += my;
    } else {
      tensionForce += force;
      tensionMx += mx;
      tensionMy += my;
    }

    bars.push({ id: bar.id, x: bar.x, y: bar.y, s, area, strain, stress, netStress, force, compression });
  }

  const phi = code.phi({
    maxTensileStrain,
    transverseReinforcement: options.transverseReinforcement,
    yieldStrain: materials.steel.fy / materials.steel.es,
  });

  return {
    neutralAxis: { theta: state.theta, nx, ny, c: state.c, sMax, sMin, depth: sMax - sMin, a, blockLimit },
    concrete: {
      rings: compressed,
      area: concArea,
      centroid: concCentroid,
      force: concreteForce,
      mx: concreteMx,
      my: concreteMy,
    },
    bars,
    steel: { compressionForce, tensionForce, compressionMx, tensionMx, compressionMy, tensionMy },
    reference,
    pn,
    mnx,
    mny,
    maxTensileStrain,
    phi,
    pd: pn * phi,
    mdx: mnx * phi,
    mdy: mny * phi,
  };
}

/**
 * 순압축 P0. 모든 철근이 항복 압축, 콘크리트 전단면.
 * 등가블록 적분의 c -> ∞ 극한과 일치하도록 같은 공제 규칙을 쓴다.
 */
export function pureCompression(
  section: SectionModel,
  materials: MaterialSet,
  code: DesignCodeStrategy,
  options: IntegrationOptions,
): SectionResponse {
  const rings = section.rings;
  const fc = materials.concrete.fc / code.materialFactors.concrete;
  const fy = materials.steel.fy / code.materialFactors.steel;
  const block = code.stressBlock(fc);
  const reference = options.reference ?? plasticCentroid(section, materials, code);
  const area = sectionArea(rings);
  const concCentroid = sectionCentroid(rings);
  const concreteForce = (block.alpha * fc * area) / 1000;

  let pn = concreteForce;
  let mnx = (concreteForce * (concCentroid.y - reference.y)) / 1000;
  let mny = (concreteForce * (concCentroid.x - reference.x)) / 1000;
  let compressionForce = 0;
  let compressionMx = 0;
  let compressionMy = 0;
  const bars: BarResponse[] = [];

  for (const bar of section.rebars) {
    const netStress = fy - block.alpha * fc;
    const barArea = rebarArea(bar.diameter);
    const force = (netStress * barArea) / 1000;
    const mx = (force * (bar.y - reference.y)) / 1000;
    const my = (force * (bar.x - reference.x)) / 1000;
    pn += force;
    mnx += mx;
    mny += my;
    compressionForce += force;
    compressionMx += mx;
    compressionMy += my;
    bars.push({
      id: bar.id,
      x: bar.x,
      y: bar.y,
      s: bar.y,
      area: barArea,
      strain: materials.concrete.ecu,
      stress: fy,
      netStress,
      force,
      compression: true,
    });
  }

  const phi = code.phi({
    maxTensileStrain: 0,
    transverseReinforcement: options.transverseReinforcement,
    yieldStrain: materials.steel.fy / materials.steel.es,
  });

  return {
    neutralAxis: {
      theta: Number.NaN,
      nx: 0,
      ny: 0,
      c: Number.POSITIVE_INFINITY,
      sMax: Number.POSITIVE_INFINITY,
      sMin: Number.NEGATIVE_INFINITY,
      depth: Number.POSITIVE_INFINITY,
      a: Number.POSITIVE_INFINITY,
      blockLimit: Number.NEGATIVE_INFINITY,
    },
    concrete: { rings, area, centroid: concCentroid, force: concreteForce, mx: mnx, my: mny },
    bars,
    steel: {
      compressionForce,
      tensionForce: 0,
      compressionMx,
      tensionMx: 0,
      compressionMy,
      tensionMy: 0,
    },
    reference,
    pn,
    mnx,
    mny,
    maxTensileStrain: 0,
    phi,
    pd: pn * phi,
    mdx: mnx * phi,
    mdy: mny * phi,
  };
}

/** 순인장. 콘크리트 무시, 모든 철근 항복 인장. */
export function pureTension(
  section: SectionModel,
  materials: MaterialSet,
  code: DesignCodeStrategy,
  options: IntegrationOptions,
): SectionResponse {
  const fy = materials.steel.fy / code.materialFactors.steel;
  const reference = options.reference ?? plasticCentroid(section, materials, code);

  let pn = 0;
  let mnx = 0;
  let mny = 0;
  const bars: BarResponse[] = [];

  for (const bar of section.rebars) {
    const barArea = rebarArea(bar.diameter);
    const force = (-fy * barArea) / 1000;
    const mx = (force * (bar.y - reference.y)) / 1000;
    const my = (force * (bar.x - reference.x)) / 1000;
    pn += force;
    mnx += mx;
    mny += my;
    bars.push({
      id: bar.id,
      x: bar.x,
      y: bar.y,
      s: bar.y,
      area: barArea,
      strain: -0.01,
      stress: -fy,
      netStress: -fy,
      force,
      compression: false,
    });
  }

  // 인장지배이므로 phi 는 상한값(0.85). 기존 구현의 maxSteelStrain = 0.01 취급을 승계한다.
  const phi = code.phi({
    maxTensileStrain: 0.01,
    transverseReinforcement: options.transverseReinforcement,
    yieldStrain: materials.steel.fy / materials.steel.es,
  });

  return {
    neutralAxis: {
      theta: Number.NaN,
      nx: 0,
      ny: 0,
      c: Number.POSITIVE_INFINITY,
      sMax: Number.NEGATIVE_INFINITY,
      sMin: Number.NEGATIVE_INFINITY,
      depth: 0,
      a: 0,
      blockLimit: Number.POSITIVE_INFINITY,
    },
    concrete: { rings: [], area: 0, centroid: { x: 0, y: 0 }, force: 0, mx: 0, my: 0 },
    bars,
    steel: {
      compressionForce: 0,
      tensionForce: pn,
      compressionMx: 0,
      tensionMx: mnx,
      compressionMy: 0,
      tensionMy: mny,
    },
    reference,
    pn,
    mnx,
    mny,
    maxTensileStrain: 0.01,
    phi,
    pd: pn * phi,
    mdx: mnx * phi,
    mdy: mny * phi,
  };
}

interface ConcreteIntegral {
  force: number;
  mx: number;
  my: number;
  /** 테이퍼 저감이 실제로 적용됐는지 */
  taperApplied: boolean;
}

/** 등가직사각형 응력블록: 압축영역 전체에 균일 응력. 클리핑 1회로 끝난다. */
function integrateEquivalentBlock(
  compressed: Ring[],
  area: number,
  centroidPoint: Point,
  stress: number,
  reference: Point,
  taperApplied: boolean,
): ConcreteIntegral {
  const effectiveStress = taperApplied ? stress * 0.9 : stress;
  const force = (effectiveStress * area) / 1000;
  return {
    force,
    mx: (force * (centroidPoint.y - reference.y)) / 1000,
    my: (force * (centroidPoint.x - reference.x)) / 1000,
    taperApplied,
  };
}

/**
 * 파이버(밴드) 적분: 포물선-직선 응력법칙을 압축영역 위에서 적분한다.
 *
 * 알고리즘
 *   1) 실제 압축영역 = { s >= sMax - c }        (β1 을 쓰지 않는다)
 *   2) s 범위를 N 개 밴드로 분할
 *   3) 각 밴드를 링별로 절단해 **정확한** 면적/도심을 얻는다 (기하는 근사가 아니다)
 *   4) 밴드 도심의 변형률로 응력을 평가해 곱한다
 *
 * 기하가 정확하고 응력만 밴드 대표값으로 근사하므로 오차는 O(1/N^2) 이다.
 */
function integrateFiber(
  rings: Ring[],
  nx: number,
  ny: number,
  sMax: number,
  c: number,
  peakStress: number,
  fck: number,
  reference: Point,
  bands: number,
): ConcreteIntegral {
  const law = parabolicRectangularLaw(fck);
  const finiteC = Number.isFinite(c);
  const sLow = finiteC ? sMax - c : Number.NEGATIVE_INFINITY;
  const region = finiteC ? clipRingsHalfPlane(rings, nx, ny, sLow) : rings;
  if (region.length === 0) return { force: 0, mx: 0, my: 0, taperApplied: false };

  const { sMin: regionMin, sMax: regionMax } = sectionProjectionRange(region, nx, ny);
  const span = regionMax - regionMin;
  if (!(span > 0)) return { force: 0, mx: 0, my: 0, taperApplied: false };

  const n = Math.max(4, Math.round(bands));
  const step = span / n;
  let force = 0;
  let mx = 0;
  let my = 0;

  for (let i = 0; i < n; i += 1) {
    const lo = regionMin + step * i;
    const hi = lo + step;
    const slice = clipRingsBand(region, nx, ny, lo, hi);
    const area = sectionArea(slice);
    if (Math.abs(area) < 1e-12) continue;
    const centroidPoint = sectionCentroid(slice);
    const s = project(centroidPoint, nx, ny);
    // 순압축(c = Infinity)은 전 단면 균일 ecu.
    const strain = finiteC ? law.ecu * (1 - (sMax - s) / c) : law.ecu;
    const stress = parabolicRectangularStress(strain, peakStress, law);
    const f = (stress * area) / 1000;
    force += f;
    mx += (f * (centroidPoint.y - reference.y)) / 1000;
    my += (f * (centroidPoint.x - reference.x)) / 1000;
  }

  return { force, mx, my, taperApplied: false };
}

/**
 * 압축영역의 폭이 최압축 연단 쪽으로 **감소**하는가 (EC2 3.1.7(3) 판정).
 * 법선방향으로 3구간 나눠 폭(= 밴드 면적 / 밴드 두께)의 추세를 본다.
 */
function isTaperedTowardExtremeFibre(compressed: Ring[], nx: number, ny: number): boolean {
  if (compressed.length === 0) return false;
  const { sMin, sMax } = sectionProjectionRange(compressed, nx, ny);
  const span = sMax - sMin;
  if (!(span > 0)) return false;

  const segments = 3;
  const widths: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const lo = sMin + (span * i) / segments;
    const hi = sMin + (span * (i + 1)) / segments;
    widths.push(Math.abs(sectionArea(clipRingsBand(compressed, nx, ny, lo, hi))) / (span / segments));
  }

  // 연단(마지막 구간)이 반대편(첫 구간)보다 뚜렷하게 좁으면 테이퍼로 본다.
  return widths[segments - 1] < widths[0] * 0.95;
}

export function rebarTotalArea(rebars: SectionModel["rebars"]): number {
  let total = 0;
  for (const bar of rebars) total += rebarArea(bar.diameter);
  return total;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
