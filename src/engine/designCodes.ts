import type { DesignCodeId, IntegrationMethod, TransverseReinforcement } from "./types";

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
  /**
   * 등가직사각형 응력블록 계수. **fck 로 조회한다** (fcd 가 아니다).
   * KDS 14 20 20 의 eta / beta1 표는 재료계수를 적용하기 전 기준강도의 함수다.
   * 응력 자체는 alpha * fcd 로 계산한다.
   */
  stressBlock(fck: number): StressBlock;
  materialFactors: {
    concrete: number;
    steel: number;
  };
  /**
   * 이 설계법의 기본 압축영역 적분 방식.
   *
   * 등가직사각형 블록의 계수(eta, beta1)는 **폭이 일정한 압축영역**을 전제로 보정된 값이라
   * 2축(사다리꼴/삼각형 압축영역) + 고강도에서 압축력을 크게 과대평가한다.
   * 한계상태설계법은 코드 자체가 포물선-직선 f-e 곡선을 강도 산정의 기준으로 삼으므로
   * (KDS 24 14 21 / KDS 14 20 20 4.1.1) 파이버 적분을 기본으로 둔다.
   * 사용자가 options.method 로 명시하면 그쪽이 우선한다.
   */
  defaultIntegration: IntegrationMethod;
  phi(ctx: PhiContext): number;
  /**
   * 최대 설계축력 계수. Pn0 에 곱해 곡면 상단을 절단한다.
   * 강도설계법에서 최소편심 조항을 대체하는 장치(띠철근 0.80 / 나선철근 0.85).
   * 한계상태설계법은 이 장치를 쓰지 않고 최소모멘트로 검토하므로 1 을 반환한다.
   */
  axialLimitFactor(transverse: TransverseReinforcement): number;
}

function equivalentStressBlock(fck: number): StressBlock {
  const table = [
    { fck: 40, eta: 1.0, beta: 0.80 },
    { fck: 50, eta: 0.97, beta: 0.80 },
    { fck: 60, eta: 0.95, beta: 0.76 },
    { fck: 70, eta: 0.91, beta: 0.74 },
    { fck: 80, eta: 0.87, beta: 0.72 },
    { fck: 90, eta: 0.84, beta: 0.70 },
  ];
  if (fck <= 40) return { alpha: 0.85, beta: 0.80 };
  if (fck >= 90) return { alpha: 0.85 * 0.84, beta: 0.70 };

  for (let i = 1; i < table.length; i += 1) {
    const lower = table[i - 1];
    const upper = table[i];
    if (fck <= upper.fck) {
      const t = (fck - lower.fck) / (upper.fck - lower.fck);
      const eta = lower.eta + (upper.eta - lower.eta) * t;
      const beta = lower.beta + (upper.beta - lower.beta) * t;
      return { alpha: 0.85 * eta, beta };
    }
  }

  return { alpha: 0.85, beta: 0.80 };
}

/**
 * KDS 24 14 21(도로교 한계상태설계법) 재료 저항계수.
 *
 * 이 코드는 EC2 계열의 **재료계수 나눗셈**(fcd = fck/gamma) 이 아니라
 * **저항계수 곱셈**(fcd = phi_c * fck) 으로 쓴다. 엔진 내부는 나눗셈 규약이므로
 * 역수를 재료계수로 넣는다.
 *   phi_c = 0.65  ->  gamma_c = 1/0.65 = 1.538...
 *   phi_s = 0.90  ->  gamma_s = 1/0.90 = 1.111...
 * (이전 값 1.5 / 1.15 는 EC2 건축계열 값이라 fyd 가 521.7 MPa 로 3.4% 낮게 나왔다.)
 */
export const BRIDGE_LSD_PHI_C = 0.65;
export const BRIDGE_LSD_PHI_S = 0.90;

export const designCodes: Record<DesignCodeId, DesignCodeStrategy> = {
  kds_strength: {
    id: "kds_strength",
    label: "한국 강도설계법",
    designBasis: "strength_reduction",
    materialFactors: { concrete: 1, steel: 1 },
    defaultIntegration: "equivalent_block",
    stressBlock: (fck) => equivalentStressBlock(fck),
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
    materialFactors: { concrete: 1 / BRIDGE_LSD_PHI_C, steel: 1 / BRIDGE_LSD_PHI_S },
    defaultIntegration: "fiber",
    stressBlock: (fck) => equivalentStressBlock(fck),
    phi: () => 1,
    axialLimitFactor: () => 1,
  },
};
