/**
 * 콘크리트 압축 응력-변형률 법칙.
 *
 * 등가직사각형 응력블록(Whitney)은 **폭이 일정한 압축영역**을 전제로 보정된 계수다.
 * 2축에서는 모서리 압축으로 압축영역이 삼각형이 되는 경우가 흔한데, 이때 실제 포물선
 * 응력분포는 폭이 좁은 최압축 연단에서 최대응력을, 폭이 넓은 쪽에서 낮은 응력을 갖는다.
 * 등가블록은 이를 균일 응력으로 뭉개므로 **압축력을 과대평가**한다.
 *
 * Eurocode 2 §3.1.7(3): 압축 연단 방향으로 폭이 감소하는 단면에서는 η·fcd 를 10% 저감한다.
 *
 * 여기서는 두 가지를 제공한다.
 *   equivalent_block  기존 등가블록 (+ 선택적 테이퍼 10% 저감)
 *   fiber             포물선-직선 법칙을 밴드 적분
 */

export interface ParabolicRectangularLaw {
  /** 정점 변형률 (포물선 -> 직선 전이점) */
  ec0: number;
  /** 극한 변형률 */
  ecu: number;
  /** 포물선 차수 */
  n: number;
}

/**
 * KDS / EC2 계열의 포물선-직선 계수. fck 에 따라 변한다.
 * fck <= 40MPa 이면 n=2, ec0=0.002, ecu=0.0033 의 고전적 값.
 */
export function parabolicRectangularLaw(fck: number): ParabolicRectangularLaw {
  if (fck <= 40) return { ec0: 0.002, ecu: 0.0033, n: 2 };
  return {
    n: Math.min(2, 1.2 + 1.5 * ((100 - fck) / 60) ** 4),
    ec0: (0.002 + (fck - 40) * 0.0000025),
    ecu: (0.0033 - (fck - 40) * 0.0000125),
  };
}

/** 압축 변형률 -> 응력 (압축 +). 인장은 0. */
export function parabolicRectangularStress(strain: number, fcd: number, law: ParabolicRectangularLaw): number {
  if (strain <= 0) return 0;
  if (strain >= law.ecu) return fcd;
  if (strain >= law.ec0) return fcd;
  return fcd * (1 - (1 - strain / law.ec0) ** law.n);
}
