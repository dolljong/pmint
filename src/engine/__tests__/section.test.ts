import { describe, expect, it } from "vitest";
import {
  bounds,
  centroid,
  clipPolygonAboveY,
  polygonArea,
  rebarArea,
  rectanglePolygon,
} from "../geometry";
import { designCodes } from "../designCodes";
import { sectionResponse } from "../section";
import type { DesignCodeId, MaterialSet, Point, Rebar, TransverseReinforcement } from "../types";
import { generateRectangleRebars } from "../rebarLayout";

const UNIAXIAL_THETA = Math.PI / 2;

/** 참조 구현이 단일 다각형을 쓰므로 링 모델로 감싼다. */
function rectangleRings2(points: Point[]) {
  return [{ id: "O1", kind: "outer" as const, points }];
}

/**
 * 리팩터링 이전 App.tsx / pm.ts 에 복붙되어 있던 1축 적분 로직의 **원본 재현**.
 * sectionResponse() 가 이것과 수치적으로 동일함을 증명하기 위한 참조 구현이며,
 * 문서화된 산출식(docs/compression-steel-stress-block-review.md)을 그대로 고정한다.
 */
function referenceUniaxial(
  polygon: Point[],
  rebars: Rebar[],
  materials: MaterialSet,
  designCode: DesignCodeId,
  tie: TransverseReinforcement,
  c: number,
) {
  const box = bounds(polygon);
  const center = centroid(polygon);
  const code = designCodes[designCode];
  const fc = materials.concrete.fc / code.materialFactors.concrete;
  const fy = materials.steel.fy / code.materialFactors.steel;
  const stressBlock = code.stressBlock(fc);
  const compressed = clipPolygonAboveY(polygon, box.maxY - stressBlock.beta * c);
  const compressedArea = Math.abs(polygonArea(compressed));
  const compressedCentroid = compressedArea > 1e-9 ? centroid(compressed) : { x: 0, y: 0 };
  const concreteForce = (stressBlock.alpha * fc * compressedArea) / 1000;
  const concreteMoment = (concreteForce * (compressedCentroid.y - center.y)) / 1000;

  let compressionSteelForce = 0;
  let tensionSteelForce = 0;
  let compressionSteelMoment = 0;
  let tensionSteelMoment = 0;
  let tensionStrain = 0;

  for (const bar of rebars) {
    const strain = materials.concrete.ecu * (1 - (box.maxY - bar.y) / c);
    const stress = Math.max(-fy, Math.min(fy, strain * materials.steel.es));
    const isCompressionSide = strain > 0;
    const effectiveStress = isCompressionSide && stress > 0 ? stress - stressBlock.alpha * fc : stress;
    const force = (effectiveStress * rebarArea(bar.diameter)) / 1000;
    const moment = (force * (bar.y - center.y)) / 1000;
    if (isCompressionSide) {
      compressionSteelForce += force;
      compressionSteelMoment += moment;
    } else {
      tensionSteelForce += force;
      tensionSteelMoment += moment;
      tensionStrain = Math.max(tensionStrain, -strain);
    }
  }

  let phi = 1;
  if (designCode === "kds_strength") {
    const minPhi = tie === "spiral" ? 0.7 : 0.65;
    const ey = materials.steel.fy / materials.steel.es;
    if (tensionStrain <= ey) phi = minPhi;
    else if (tensionStrain >= 0.005) phi = 0.85;
    else phi = minPhi + ((tensionStrain - ey) / (0.005 - ey)) * (0.85 - minPhi);
  }

  return {
    pn: concreteForce + compressionSteelForce + tensionSteelForce,
    mn: concreteMoment + compressionSteelMoment + tensionSteelMoment,
    phi,
    tensionStrain,
    concreteForce,
    concreteMoment,
    compressionSteelForce,
    tensionSteelForce,
    compressionSteelMoment,
    tensionSteelMoment,
  };
}

const cases = [
  {
    label: "400x600 fck30 fy400",
    polygon: rectanglePolygon(400, 600),
    rebars: [
      { id: "R1", x: -150, y: -250, diameter: 25 },
      { id: "R2", x: 150, y: -250, diameter: 25 },
      { id: "R3", x: -150, y: 250, diameter: 25 },
      { id: "R4", x: 150, y: 250, diameter: 25 },
    ] as Rebar[],
    materials: { concrete: { fc: 30, ecu: 0.0033 }, steel: { fy: 400, es: 200000 } } as MaterialSet,
  },
  {
    label: "B5-I 1100x1100 fck80 fy600",
    polygon: rectanglePolygon(1100, 1100),
    rebars: generateRectangleRebars(1100, 1100, [
      { id: "L1", dc: 90, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
      { id: "L2", dc: 120, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
    ]),
    materials: { concrete: { fc: 80, ecu: 0.003, ec: 37490 }, steel: { fy: 600, es: 200000 } } as MaterialSet,
  },
];

describe("sectionResponse 가 기존 1축 적분과 동일하다", () => {
  for (const testCase of cases) {
    for (const designCode of ["kds_strength", "bridge_lsd"] as DesignCodeId[]) {
      for (const tie of ["tie", "spiral"] as TransverseReinforcement[]) {
        it(`${testCase.label} / ${designCode} / ${tie}`, () => {
          const height = bounds(testCase.polygon).maxY - bounds(testCase.polygon).minY;
          for (let i = 0; i < 60; i += 1) {
            const c = 0.02 * height + (i / 59) * 1.8 * height;
            const expected = referenceUniaxial(
              testCase.polygon,
              testCase.rebars,
              testCase.materials,
              designCode,
              tie,
              c,
            );
            const actual = sectionResponse(
              { rings: rectangleRings2(testCase.polygon), rebars: testCase.rebars },
              testCase.materials,
              designCodes[designCode],
              { theta: UNIAXIAL_THETA, c },
              { transverseReinforcement: tie, reference: centroid(testCase.polygon) },
            );

            expect(actual.pn, `pn @c=${c}`).toBeCloseTo(expected.pn, 9);
            expect(actual.mnx, `mnx @c=${c}`).toBeCloseTo(expected.mn, 9);
            expect(actual.phi, `phi @c=${c}`).toBeCloseTo(expected.phi, 12);
            expect(actual.maxTensileStrain, `et @c=${c}`).toBeCloseTo(expected.tensionStrain, 12);
            expect(actual.concrete.force, `Cc @c=${c}`).toBeCloseTo(expected.concreteForce, 9);
            expect(actual.concrete.mx, `Mc @c=${c}`).toBeCloseTo(expected.concreteMoment, 9);
            expect(actual.steel.compressionForce, `Cs @c=${c}`).toBeCloseTo(expected.compressionSteelForce, 9);
            expect(actual.steel.tensionForce, `Tt @c=${c}`).toBeCloseTo(expected.tensionSteelForce, 9);
            expect(actual.steel.compressionMx, `Ms @c=${c}`).toBeCloseTo(expected.compressionSteelMoment, 9);
            expect(actual.steel.tensionMx, `Mt @c=${c}`).toBeCloseTo(expected.tensionSteelMoment, 9);
          }
        });
      }
    }
  }
});

describe("대칭 단면의 2축 성분", () => {
  it("theta=pi/2 에서 Mny 는 0 이다", () => {
    const polygon = rectanglePolygon(400, 600);
    const rebars: Rebar[] = [
      { id: "R1", x: -150, y: -250, diameter: 25 },
      { id: "R2", x: 150, y: -250, diameter: 25 },
      { id: "R3", x: -150, y: 250, diameter: 25 },
      { id: "R4", x: 150, y: 250, diameter: 25 },
    ];
    const materials: MaterialSet = { concrete: { fc: 30, ecu: 0.0033 }, steel: { fy: 400, es: 200000 } };
    const response = sectionResponse(
      { rings: rectangleRings2(polygon), rebars },
      materials,
      designCodes.kds_strength,
      { theta: UNIAXIAL_THETA, c: 200 },
      { transverseReinforcement: "tie" },
    );
    expect(response.mny).toBeCloseTo(0, 9);
    expect(response.mnx).toBeGreaterThan(0);
  });
});
