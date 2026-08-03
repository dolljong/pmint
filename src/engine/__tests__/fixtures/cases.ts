import { rectangleRings } from "../../geometry";
import { generateRectangleRebars, type RectRebarLayer } from "../../rebarLayout";
import type { MaterialSet, PMOptions, Rebar, SectionModel } from "../../types";

/**
 * 골든 스냅샷용 기준 케이스.
 *
 * App.tsx 의 기본값 / B5-I 프리셋과 **수치가 동일해야 한다**.
 * 리팩터링 과정에서 이 두 케이스의 계산 결과가 변하면 회귀다.
 */
export interface GoldenCase {
  name: string;
  section: SectionModel;
  materials: MaterialSet;
  options: PMOptions;
}

const defaultRebars: Rebar[] = [
  { id: "R1", x: -150, y: -250, diameter: 25 },
  { id: "R2", x: 150, y: -250, diameter: 25 },
  { id: "R3", x: -150, y: 250, diameter: 25 },
  { id: "R4", x: 150, y: 250, diameter: 25 },
];

const b5iLayers: RectRebarLayer[] = [
  { id: "L1", dc: 90, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
  { id: "L2", dc: 120, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
];

export const defaultCase: GoldenCase = {
  name: "default-400x600",
  section: {
    rings: rectangleRings(400, 600),
    rebars: defaultRebars,
  },
  materials: {
    concrete: { fc: 30, ecu: 0.0033 },
    steel: { fy: 400, es: 200000 },
  },
  options: {
    designCode: "kds_strength",
    points: 70,
    minEccentricity: undefined,
    transverseReinforcement: "tie",
  },
};

export const b5iCase: GoldenCase = {
  name: "b5i-1100x1100",
  section: {
    rings: rectangleRings(1100, 1100),
    rebars: generateRectangleRebars(1100, 1100, b5iLayers),
  },
  materials: {
    concrete: { fc: 80, ecu: 0.003, ec: 37490 },
    steel: { fy: 600, es: 200000 },
  },
  options: {
    designCode: "kds_strength",
    points: 70,
    minEccentricity: 57.01,
    transverseReinforcement: "tie",
  },
};

/** bridge_lsd(재료계수) 경로도 골든으로 고정한다. 설계법 분기 회귀 방지. */
export const bridgeLsdCase: GoldenCase = {
  name: "bridge-lsd-400x600",
  section: {
    rings: rectangleRings(400, 600),
    rebars: defaultRebars,
  },
  materials: {
    concrete: { fc: 30, ecu: 0.0033 },
    steel: { fy: 400, es: 200000 },
  },
  options: {
    designCode: "bridge_lsd",
    points: 70,
    minEccentricity: undefined,
    transverseReinforcement: "tie",
  },
};

/** 비대칭 배근 — 소성중심 도입 시 값이 **바뀌어야 하는** 케이스. */
export const asymmetricCase: GoldenCase = {
  name: "asymmetric-400x600",
  section: {
    rings: rectangleRings(400, 600),
    rebars: [
      { id: "R1", x: -150, y: -250, diameter: 16 },
      { id: "R2", x: 150, y: -250, diameter: 16 },
      { id: "R3", x: -150, y: 250, diameter: 32 },
      { id: "R4", x: 150, y: 250, diameter: 32 },
      { id: "R5", x: 0, y: 250, diameter: 32 },
    ],
  },
  materials: {
    concrete: { fc: 30, ecu: 0.0033 },
    steel: { fy: 400, es: 200000 },
  },
  options: {
    designCode: "kds_strength",
    points: 70,
    minEccentricity: undefined,
    transverseReinforcement: "tie",
  },
};

export const goldenCases: GoldenCase[] = [defaultCase, b5iCase, bridgeLsdCase, asymmetricCase];
