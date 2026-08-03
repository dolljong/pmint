import type { DesignCodeId, TransverseReinforcement } from "./types";

export interface StressBlock {
  alpha: number;
  beta: number;
}

/** 강도감소계수 산정에 필요한 상태량. */
export interface PhiContext {
  /** 최외단 인장철근의 순인장변형률. 2축에서는 중립축에서 인장측으로 가장 먼 철근의 값. */
  maxTensileStrain: number;
  transverseReinforcement: TransverseReinforcement;
  /** 철근 항복변형률 ey = fy / Es (재료계수 미적용 원래 값) */
  yieldStrain: number;
}

export interface DesignCodeStrategy {
  id: DesignCodeId;
  label: string;
  designBasis: "strength_reduction" | "material_factor";
  stressBlock(fc: number): StressBlock;
  materialFactors: {
    concrete: number;
    steel: number;
  };
  phi(ctx: PhiContext): number;
  /**
   * 최대 설계축력 계수. Pn0 에 곱해 곡면 상단을 절단한다.
   * 강도설계법에서 최소편심 조항을 대체하는 장치(띠철근 0.80 / 나선철근 0.85).
   * 한계상태설계법은 이 장치를 쓰지 않고 최소모멘트로 검토하므로 1 을 반환한다.
   */
  axialLimitFactor(transverse: TransverseReinforcement): number;
}

function equivalentStressBlock(fc: number): StressBlock {
  const table = [
    { fc: 40, eta: 1.0, beta: 0.80 },
    { fc: 50, eta: 0.97, beta: 0.80 },
    { fc: 60, eta: 0.95, beta: 0.76 },
    { fc: 70, eta: 0.91, beta: 0.74 },
    { fc: 80, eta: 0.87, beta: 0.72 },
    { fc: 90, eta: 0.84, beta: 0.70 },
  ];
  if (fc <= 40) return { alpha: 0.85, beta: 0.80 };
  if (fc >= 90) return { alpha: 0.85 * 0.84, beta: 0.70 };

  for (let i = 1; i < table.length; i += 1) {
    const lower = table[i - 1];
    const upper = table[i];
    if (fc <= upper.fc) {
      const t = (fc - lower.fc) / (upper.fc - lower.fc);
      const eta = lower.eta + (upper.eta - lower.eta) * t;
      const beta = lower.beta + (upper.beta - lower.beta) * t;
      return { alpha: 0.85 * eta, beta };
    }
  }

  return { alpha: 0.85, beta: 0.80 };
}

export const designCodes: Record<DesignCodeId, DesignCodeStrategy> = {
  kds_strength: {
    id: "kds_strength",
    label: "한국 강도설계법",
    designBasis: "strength_reduction",
    materialFactors: { concrete: 1, steel: 1 },
    stressBlock: (fc) => equivalentStressBlock(fc),
    phi: ({ maxTensileStrain, transverseReinforcement, yieldStrain }) => {
      const minPhi = transverseReinforcement === "spiral" ? 0.70 : 0.65;
      if (maxTensileStrain <= yieldStrain) return minPhi;
      if (maxTensileStrain >= 0.005) return 0.85;
      return minPhi + ((maxTensileStrain - yieldStrain) / (0.005 - yieldStrain)) * (0.85 - minPhi);
    },
    axialLimitFactor: (transverse) => (transverse === "spiral" ? 0.85 : 0.80),
  },
  bridge_lsd: {
    id: "bridge_lsd",
    label: "한계상태설계법(교량)",
    designBasis: "material_factor",
    materialFactors: { concrete: 1.5, steel: 1.15 },
    stressBlock: (fc) => equivalentStressBlock(fc),
    phi: () => 1,
    axialLimitFactor: () => 1,
  },
};
