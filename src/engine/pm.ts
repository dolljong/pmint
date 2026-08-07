import { axisNormal, normalizeRings, outerRings, sectionProjectionRange } from "./geometry";
import { designCodes } from "./designCodes";
import { plasticCentroid, pureCompression, pureTension, sectionResponse, type IntegrationOptions } from "./section";
import type { MaterialSet, PMOptions, PMPoint, SectionModel } from "./types";

/** 1축(중립축 수평, 상단 압축) 법선 각도. */
const UNIAXIAL_THETA = Math.PI / 2;

/**
 * 1축 P-M 상관도.
 *
 * 2축 곡면(surface.ts)의 θ = π/2 자오선과 동일하다.
 * 계산 자체는 전부 sectionResponse() 프리미티브가 담당한다.
 */
export function computePM(section: SectionModel, materials: MaterialSet, options: PMOptions): PMPoint[] {
  const rings = normalizeRings(section.rings);
  const outers = outerRings(rings);
  if (outers.length === 0 || outers.every((ring) => ring.points.length < 3)) return [];
  if (section.rebars.length === 0) return [];

  const model: SectionModel = { rings, rebars: section.rebars };
  const code = designCodes[options.designCode];
  const { nx, ny } = axisNormal(UNIAXIAL_THETA);
  const { sMin, sMax } = sectionProjectionRange(rings, nx, ny);
  const height = sMax - sMin;
  const minEccentricity = options.minEccentricity ?? Math.max(15, height * 0.05);
  // 모멘트 기준점은 소성중심(KDS 14 20 20). 한 번만 구해 전 계산점에 공유한다.
  const integration: IntegrationOptions = {
    transverseReinforcement: options.transverseReinforcement ?? "tie",
    reference: plasticCentroid(model, materials, code, code.defaultIntegration),
    method: code.defaultIntegration,
  };
  const materialFactor = code.designBasis === "material_factor" ? 1 : 0;
  const sweepCount = Math.max(12, options.points);
  const results: PMPoint[] = [];

  for (let i = 0; i < sweepCount; i += 1) {
    const ratio = i / (sweepCount - 1);
    const c = 0.02 * height + ratio * 1.8 * height;
    const response = sectionResponse(model, materials, code, { theta: UNIAXIAL_THETA, c }, integration);
    results.push({
      id: `pm-${i}`,
      neutralAxisY: sMax - c,
      c,
      pn: response.pn,
      mn: response.mnx,
      phi: response.phi,
      materialFactor,
      pd: response.pd,
      md: response.mdx,
      maxSteelStrain: response.maxTensileStrain,
      minEccentricity,
    });
  }

  const compression = pureCompression(model, materials, code, integration);
  const tension = pureTension(model, materials, code, integration);

  return [
    {
      id: "pure-tension",
      neutralAxisY: Number.NEGATIVE_INFINITY,
      c: Number.POSITIVE_INFINITY,
      pn: tension.pn,
      mn: tension.mnx,
      phi: tension.phi,
      materialFactor: 0,
      pd: tension.pd,
      md: tension.mdx,
      maxSteelStrain: tension.maxTensileStrain,
      minEccentricity,
    },
    ...results,
    {
      id: "pure-compression",
      neutralAxisY: Number.POSITIVE_INFINITY,
      c: Number.POSITIVE_INFINITY,
      pn: compression.pn,
      mn: compression.mnx,
      phi: compression.phi,
      materialFactor: 0,
      pd: compression.pd,
      md: compression.mdx,
      maxSteelStrain: compression.maxTensileStrain,
      minEccentricity,
    },
  ];
}
