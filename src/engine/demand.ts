import { outerBounds, sectionArea, sectionSecondMoments } from "./geometry";
import { capacityAt, type CapacityResult } from "./solve";
import type { InteractionSurface } from "./surface";
import type { MaterialSet } from "./types";

/**
 * 하중케이스 수요 확정 및 강도 검토.
 *
 * ★ 우발편심(최소편심)은 설계법에 따라 **정반대 위치**에서 처리된다.
 *
 *   강도설계법(kds_strength)   ->  강도(곡면) 쪽을 자른다  : 축력 cutoff  φPn ≤ α·φ·Pn0
 *                                  (ACI 318-02 이후 최소편심 조항을 삭제하고 축력 상한으로 대체.
 *                                   최소모멘트를 **중복 적용하면 안 된다**.)
 *   한계상태설계법(bridge_lsd) ->  수요(하중) 쪽을 올린다  : 최소모멘트 M ≥ NEd·e0
 *                                  (EC2 6.1(4), e0 = max(h/30, 20mm). 곡면은 손대지 않는다.)
 *
 * ★ 순서 함정: 축별 최소모멘트 하한 처리는 편심 방향 α_e 를 **회전시킨다**.
 *   예) Mux*=3000, Muy*=0, NEd·e0x/1000=400  ->  α_e 가 90.0deg 에서 82.4deg 로 이동.
 *   따라서 α_e 는 반드시 하한 처리 **후에** 계산해야 한다. 아래 prepareDemand 가 그 순서를 강제한다.
 *
 * 부호 규약: Mx = P·e_y (y방향 편심), My = P·e_x (x방향 편심).
 *   즉 Mux 는 **y방향** 단면깊이와, Muy 는 **x방향** 단면폭과 짝을 이룬다. 바꿔 쓰기 쉬우니 주의.
 */

export interface DemandInput {
  id: string;
  label: string;
  /** 계수축하중 (kN, 압축 +) */
  pu: number;
  /** x축 회전 모멘트 (kN-m). 비횡구속/횡구속 성분. */
  muxNs: number;
  muxS: number;
  /** y축 회전 모멘트 (kN-m) */
  muyNs: number;
  muyS: number;
  /** 지속하중비 */
  betaDx?: number;
  betaDy?: number;
}

export interface ColumnGeometry {
  /** 비지지 길이 (mm) */
  lu: number;
  kx: number;
  ky: number;
  /** 한계상태설계법 전용 최소편심 오버라이드 (mm). 미지정이면 max(h/30, 20). */
  e0x?: number;
  e0y?: number;
}

export interface PreparedDemand {
  input: DemandInput;
  /** 세장비 */
  lambdaX: number;
  lambdaY: number;
  /** 임계좌굴하중 (kN) */
  pcx: number;
  pcy: number;
  /** 모멘트 확대계수 */
  deltaX: number;
  deltaY: number;
  /** 장주 확대 후 (kN-m) */
  muxMagnified: number;
  muyMagnified: number;
  /** 최소모멘트 하한(한계상태설계법 전용, kN-m). 강도설계법이면 0. */
  minMomentX: number;
  minMomentY: number;
  /** 최소편심 (mm). 강도설계법이면 undefined. */
  e0x?: number;
  e0y?: number;
  /** 하한 처리가 실제로 걸렸는지 */
  minMomentGovernsX: boolean;
  minMomentGovernsY: boolean;
  /** 최종 검토 모멘트 (kN-m) */
  mux: number;
  muy: number;
  /** 합성 모멘트 크기 */
  mu: number;
  /** 편심 (mm) */
  ex: number;
  ey: number;
  /** 편심 방향 = atan2(Mux, Muy). 반드시 하한 처리 후 값. */
  alphaE: number;
  /** 장주 확대로 인한 편심 방향 회전량 (rad) */
  alphaEBeforeMinMoment: number;
}

export interface DemandCheck {
  demand: PreparedDemand;
  capacity?: CapacityResult;
  /** 사용률 = |Mu| / |φMn| (같은 축력, 같은 편심 방향) */
  ratio: number;
  ok: boolean;
  /** 판정 불가 사유 */
  status: "ok" | "ng" | "over_axial_cap" | "below_tension_capacity" | "no_solution";
  message?: string;
}

export function prepareDemand(
  surface: InteractionSurface,
  materials: MaterialSet,
  column: ColumnGeometry,
  input: DemandInput,
): PreparedDemand {
  const rings = surface.section.rings;
  const area = sectionArea(rings);
  const moments = sectionSecondMoments(rings);
  const box = outerBounds(rings);
  const ec = concreteElasticModulus(materials);

  // --- 1) 장주 확대 --------------------------------------------------------
  const rx = area > 0 ? Math.sqrt(Math.abs(moments.ix) / area) : 0;
  const ry = area > 0 ? Math.sqrt(Math.abs(moments.iy) / area) : 0;
  const lambdaX = rx > 0 ? (column.kx * column.lu) / rx : 0;
  const lambdaY = ry > 0 ? (column.ky * column.lu) / ry : 0;
  const pcx = eulerBucklingLoad(ec, moments.ix, column.kx, column.lu);
  const pcy = eulerBucklingLoad(ec, moments.iy, column.ky, column.lu);
  const deltaX = momentMagnificationFactor(input.pu, pcx);
  const deltaY = momentMagnificationFactor(input.pu, pcy);

  const muxMagnified = (input.muxNs + input.muxS) * deltaX;
  const muyMagnified = (input.muyNs + input.muyS) * deltaY;
  const alphaEBeforeMinMoment = Math.atan2(muxMagnified, muyMagnified);

  // --- 2) 최소모멘트 하한 (한계상태설계법 전용) -----------------------------
  const usesMinMoment = surface.code.designBasis === "material_factor";
  const hy = box.maxY - box.minY; // y방향 깊이 -> Mux 와 짝
  const hx = box.maxX - box.minX; // x방향 폭   -> Muy 와 짝
  const e0y = usesMinMoment ? (column.e0y ?? defaultE0(hy)) : undefined;
  const e0x = usesMinMoment ? (column.e0x ?? defaultE0(hx)) : undefined;
  const minMomentX = e0y !== undefined ? (Math.abs(input.pu) * e0y) / 1000 : 0;
  const minMomentY = e0x !== undefined ? (Math.abs(input.pu) * e0x) / 1000 : 0;

  const absX = Math.abs(muxMagnified);
  const absY = Math.abs(muyMagnified);
  const minMomentGovernsX = minMomentX > absX;
  const minMomentGovernsY = minMomentY > absY;
  const mux = signOf(muxMagnified, alphaEBeforeMinMoment, "x") * Math.max(absX, minMomentX);
  const muy = signOf(muyMagnified, alphaEBeforeMinMoment, "y") * Math.max(absY, minMomentY);

  // --- 3) 편심 방향은 하한 처리 **후에** 계산 -------------------------------
  const alphaE = Math.atan2(mux, muy);

  return {
    input,
    lambdaX,
    lambdaY,
    pcx,
    pcy,
    deltaX,
    deltaY,
    muxMagnified,
    muyMagnified,
    minMomentX,
    minMomentY,
    e0x,
    e0y,
    minMomentGovernsX,
    minMomentGovernsY,
    mux,
    muy,
    mu: Math.hypot(mux, muy),
    ex: input.pu !== 0 ? (muy / input.pu) * 1000 : 0,
    ey: input.pu !== 0 ? (mux / input.pu) * 1000 : 0,
    alphaE,
    alphaEBeforeMinMoment,
  };
}

export function checkDemand(
  surface: InteractionSurface,
  materials: MaterialSet,
  column: ColumnGeometry,
  input: DemandInput,
  useDesign = true,
): DemandCheck {
  const demand = prepareDemand(surface, materials, column, input);

  if (useDesign && Number.isFinite(surface.axialCap) && demand.input.pu > surface.axialCap) {
    return {
      demand,
      ratio: Number.POSITIVE_INFINITY,
      ok: false,
      status: "over_axial_cap",
      message: `Pu 가 설계 축력 상한 ${surface.axialCap.toFixed(1)} kN 을 초과합니다.`,
    };
  }

  const tensionLimit = useDesign ? surface.pureTension.pd : surface.pureTension.pn;
  if (demand.input.pu < tensionLimit) {
    return {
      demand,
      ratio: Number.POSITIVE_INFINITY,
      ok: false,
      status: "below_tension_capacity",
      message: `Pu 가 순인장강도 ${tensionLimit.toFixed(1)} kN 보다 작습니다.`,
    };
  }

  const capacity = capacityAt(surface, demand.input.pu, demand.alphaE, useDesign);
  if (!capacity) {
    return {
      demand,
      ratio: Number.POSITIVE_INFINITY,
      ok: false,
      status: "no_solution",
      message: "해당 축력·편심 방향에서 곡면과의 교점을 찾지 못했습니다.",
    };
  }

  const capacityMoment = useDesign ? capacity.md : Math.hypot(capacity.mnx, capacity.mny);

  // 모멘트가 사실상 0 인 순압축 근처: 축력만으로 판정한다.
  if (demand.mu < 1e-9) {
    return { demand, capacity, ratio: 0, ok: true, status: "ok" };
  }

  const ratio = capacityMoment > 1e-12 ? demand.mu / capacityMoment : Number.POSITIVE_INFINITY;
  return {
    demand,
    capacity,
    ratio,
    ok: ratio <= 1,
    status: ratio <= 1 ? "ok" : "ng",
  };
}

/** EC2 6.1(4): e0 = max(h/30, 20mm) */
export function defaultE0(depth: number): number {
  return Math.max(depth / 30, 20);
}

export function concreteElasticModulus(materials: MaterialSet): number {
  return materials.concrete.ec ?? 8500 * Math.cbrt(materials.concrete.fc + 4);
}

export function eulerBucklingLoad(ec: number, inertia: number, k: number, lu: number): number {
  if (k <= 0 || lu <= 0) return Number.POSITIVE_INFINITY;
  return (Math.PI * Math.PI * 0.5 * ec * Math.abs(inertia)) / (k * lu) ** 2 / 1000;
}

export function momentMagnificationFactor(pu: number, pc: number): number {
  if (!Number.isFinite(pc) || pc <= 0) return 1;
  const denominator = 1 - pu / (0.75 * pc);
  if (denominator <= 0) return 1.4;
  return Math.min(1.4, Math.max(1, 1 / denominator));
}

/**
 * 최소모멘트로 끌어올릴 때의 부호.
 * 원래 성분이 0 이면 방향 정보가 없으므로 양(+)으로 둔다 —
 * 우발편심은 불리한 쪽으로 작용한다고 보아야 하고, 대칭 단면에서는 부호가 무의미하다.
 */
function signOf(value: number, _alphaE: number, _axis: "x" | "y"): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 1;
}
