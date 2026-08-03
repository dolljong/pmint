import { capacityAt } from "./solve";
import type { InteractionSurface } from "./surface";

/**
 * 코드 간이법. 정확 곡면과의 **대조 표시용**이며 판정의 근거로 쓰지 않는다.
 * 실무 보고서에서 관행적으로 병기를 요구받으므로 함께 제공한다.
 */

export interface BreslerResult {
  /** 1축 x 강도 (Muy = 0 방향) */
  pnx: number;
  /** 1축 y 강도 (Mux = 0 방향) */
  pny: number;
  p0: number;
  /** 역수법 예측 축강도 */
  pn: number;
  /** 적용 가능 구간인지 (Pn >= 0.1 fck Ag) */
  applicable: boolean;
}

/**
 * Bresler 역수법: 1/Pn ≈ 1/Pnx + 1/Pny - 1/P0
 * 압축지배 영역(Pn >= 0.1 fck Ag)에서만 유효하고 저축력에서 크게 틀린다.
 */
export function breslerReciprocal(
  surface: InteractionSurface,
  mux: number,
  muy: number,
  useDesign = true,
): BreslerResult | undefined {
  const p0 = useDesign ? surface.axialCap : surface.pn0;
  const ex = Math.abs(muy);
  const ey = Math.abs(mux);
  if (ex < 1e-9 && ey < 1e-9) return undefined;

  // 각 축 단독 편심에서의 축강도
  const alongX = axialAtMomentDirection(surface, Math.PI / 2, ey, useDesign); // Mux 단독
  const alongY = axialAtMomentDirection(surface, 0, ex, useDesign); // Muy 단독
  if (alongX === undefined || alongY === undefined) return undefined;

  const inverse = 1 / alongX + 1 / alongY - 1 / p0;
  const threshold = 0.1 * surface.materials.concrete.fc * surface.grossArea / 1000;
  return {
    pnx: alongX,
    pny: alongY,
    p0,
    pn: inverse > 0 ? 1 / inverse : Number.POSITIVE_INFINITY,
    applicable: inverse > 0 && 1 / inverse >= threshold,
  };
}

/** 주어진 모멘트 방향/크기에서 곡면이 허용하는 축력. 이분법으로 P 를 훑는다. */
function axialAtMomentDirection(
  surface: InteractionSurface,
  alphaE: number,
  moment: number,
  useDesign: boolean,
): number | undefined {
  if (moment < 1e-12) return useDesign ? surface.axialCap : surface.pn0;

  const pMin = useDesign ? surface.pureTension.pd : surface.pureTension.pn;
  const pMax = useDesign ? surface.axialCap : surface.pn0;
  let lo = pMin;
  let hi = pMax;

  const momentAt = (p: number) => {
    const found = capacityAt(surface, p, alphaE, useDesign);
    if (!found) return undefined;
    return useDesign ? found.md : Math.hypot(found.mnx, found.mny);
  };

  // 모멘트는 P 에 대해 단봉(최대 휨강도 근처에서 정점)이므로,
  // 압축지배 구간(정점 위쪽)에서만 단조 감소한다. Bresler 는 그 구간을 전제한다.
  const peakP = findPeakMomentAxial(surface, alphaE, useDesign);
  if (peakP === undefined) return undefined;
  lo = peakP;

  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const m = momentAt(mid);
    if (m === undefined) {
      hi = mid;
      continue;
    }
    if (m > moment) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function findPeakMomentAxial(
  surface: InteractionSurface,
  alphaE: number,
  useDesign: boolean,
): number | undefined {
  const pMin = useDesign ? surface.pureTension.pd : surface.pureTension.pn;
  const pMax = useDesign ? surface.axialCap : surface.pn0;
  let bestP: number | undefined;
  let bestM = -1;
  const steps = 40;
  for (let i = 0; i <= steps; i += 1) {
    const p = pMin + ((pMax - pMin) * i) / steps;
    const found = capacityAt(surface, p, alphaE, useDesign);
    if (!found) continue;
    const m = useDesign ? found.md : Math.hypot(found.mnx, found.mny);
    if (m > bestM) {
      bestM = m;
      bestP = p;
    }
  }
  return bestP;
}

export interface Ec2BiaxialResult {
  /** 지수 a */
  exponent: number;
  /** 축력비 NEd / NRd */
  axialRatio: number;
  /** 각 축 단독 저항모멘트 */
  mrdx: number;
  mrdy: number;
  /** (Mx/Mrx)^a + (My/Mry)^a */
  utilisation: number;
  ok: boolean;
}

/**
 * Eurocode 2 §5.8.9 지수법.
 *
 *   (MEdx/MRdx)^a + (MEdy/MRdy)^a <= 1.0
 *   직사각형: NEd/NRd = 0.1 -> a=1.0,  0.7 -> a=1.5,  1.0 -> a=2.0 (선형보간)
 *   원형/타원: a = 2.0
 *   NRd = Ac·fcd + As·fyd
 */
export function ec2BiaxialCheck(
  surface: InteractionSurface,
  pu: number,
  mux: number,
  muy: number,
  options: { circular?: boolean; useDesign?: boolean } = {},
): Ec2BiaxialResult | undefined {
  const useDesign = options.useDesign ?? true;
  const fcd = surface.materials.concrete.fc / surface.code.materialFactors.concrete;
  const fyd = surface.materials.steel.fy / surface.code.materialFactors.steel;
  const nrd = (fcd * (surface.grossArea - surface.steelArea) + fyd * surface.steelArea) / 1000;
  const axialRatio = nrd > 0 ? pu / nrd : 0;

  const alongX = capacityAt(surface, pu, Math.PI / 2, useDesign);
  const alongY = capacityAt(surface, pu, 0, useDesign);
  if (!alongX || !alongY) return undefined;

  const mrdx = Math.abs(useDesign ? alongX.mdx : alongX.mnx);
  const mrdy = Math.abs(useDesign ? alongY.mdy : alongY.mny);
  if (mrdx < 1e-12 || mrdy < 1e-12) return undefined;

  const exponent = options.circular ? 2 : ec2Exponent(axialRatio);
  const utilisation = (Math.abs(mux) / mrdx) ** exponent + (Math.abs(muy) / mrdy) ** exponent;

  return { exponent, axialRatio, mrdx, mrdy, utilisation, ok: utilisation <= 1 };
}

export function ec2Exponent(axialRatio: number): number {
  const table: [number, number][] = [
    [0.1, 1.0],
    [0.7, 1.5],
    [1.0, 2.0],
  ];
  const r = Math.max(0, axialRatio);
  if (r <= table[0][0]) return table[0][1];
  if (r >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i += 1) {
    const [rLo, aLo] = table[i - 1];
    const [rHi, aHi] = table[i];
    if (r <= rHi) return aLo + ((r - rLo) / (rHi - rLo)) * (aHi - aLo);
  }
  return 2;
}
