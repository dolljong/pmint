export type DesignCodeId = "kds_strength" | "bridge_lsd";

export type ShapeMode = "free" | "rectangle" | "circle";

export type TransverseReinforcement = "tie" | "spiral";

export interface Point {
  x: number;
  y: number;
}

export interface Rebar {
  id: string;
  x: number;
  y: number;
  diameter: number;
}

export interface ConcreteMaterial {
  fc: number;
  ecu: number;
  ec?: number;
}

export interface SteelMaterial {
  fy: number;
  es: number;
}

export interface MaterialSet {
  concrete: ConcreteMaterial;
  steel: SteelMaterial;
}

export type RingKind = "outer" | "hole";

/**
 * 단면 경계 링.
 *
 * 방향 규약(normalizeRings 가 강제): outer = CCW(양의 부호면적), hole = CW(음의 부호면적).
 * 이 규약 덕분에 면적/도심/2차모멘트/반평면 클리핑이 전부 링별 단순 합산이 된다.
 */
export interface Ring {
  id: string;
  kind: RingKind;
  points: Point[];
}

export interface SectionModel {
  rings: Ring[];
  rebars: Rebar[];
}

export interface PMPoint {
  id: string;
  neutralAxisY: number;
  c: number;
  pn: number;
  mn: number;
  phi: number;
  materialFactor: number;
  pd: number;
  md: number;
  maxSteelStrain: number;
  minEccentricity: number;
}

export interface PMOptions {
  designCode: DesignCodeId;
  points: number;
  minEccentricity?: number;
  transverseReinforcement?: TransverseReinforcement;
}
