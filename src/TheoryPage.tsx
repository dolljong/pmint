import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { axisNormal, clipRingsHalfPlane, normalizeRings, rectangleRings, sectionProjectionRange } from "./engine/geometry";
import { designCodes } from "./engine/designCodes";
import { generateRectangleRebars } from "./engine/rebarLayout";
import {
  plasticCentroid,
  pureCompression,
  pureTension,
  sectionResponse,
  type IntegrationOptions,
  type SectionResponse,
} from "./engine/section";
import { computeSurface, momentContour, type InteractionSurface } from "./engine/surface";
import type { MaterialSet, Point, SectionModel } from "./engine/types";
import { fmt, radToDeg } from "./report";

// ---------------------------------------------------------------------------
// 설명용 예제 단면: 400 x 700 직사각형, D25 10개, fck 30 / fy 400, 강도설계법 + 등가블록.
// 세장한 단면이라 2축에서 θ 와 α_e 가 벌어지는 모습이 잘 보인다.
// ---------------------------------------------------------------------------

const DEMO_B = 400;
const DEMO_H = 700;
const demoRings = normalizeRings(rectangleRings(DEMO_B, DEMO_H));
const demoRebars = generateRectangleRebars(DEMO_B, DEMO_H, [
  { id: "L1", dc: 60, diameter: 25, top: 3, right: 4, bottom: 3, left: 4 },
]);
const demoSection: SectionModel = { rings: demoRings, rebars: demoRebars };
const demoMaterials: MaterialSet = { concrete: { fc: 30, ecu: 0.0033 }, steel: { fy: 400, es: 200000 } };
const demoCode = designCodes.kds_strength;
const demoIntegration: IntegrationOptions = {
  transverseReinforcement: "tie",
  method: "equivalent_block",
  reference: plasticCentroid(demoSection, demoMaterials, demoCode, "equivalent_block"),
};
const EPS_Y = demoMaterials.steel.fy / demoMaterials.steel.es;
const ECU = demoMaterials.concrete.ecu;
const BETA1 = demoCode.stressBlock(demoMaterials.concrete.fc).beta;
const UNI_THETA = Math.PI / 2;

function respond(theta: number, c: number): SectionResponse {
  return sectionResponse(demoSection, demoMaterials, demoCode, { theta, c }, demoIntegration);
}

function depthAt(theta: number) {
  const { nx, ny } = axisNormal(theta);
  const { sMin, sMax } = sectionProjectionRange(demoRings, nx, ny);
  return { sMin, sMax, depth: sMax - sMin };
}

/** θ 고정, Pn(c) = p 인 c. Pn 은 c 에 대해 단조 증가하므로 이분법이면 충분하다. */
function solveC(theta: number, p: number): number {
  const { depth } = depthAt(theta);
  let lo = 0.005 * depth;
  let hi = 60 * depth;
  if (respond(theta, lo).pn >= p) return lo;
  if (respond(theta, hi).pn <= p) return hi;
  for (let i = 0; i < 60; i += 1) {
    const mid = Math.sqrt(lo * hi);
    if (respond(theta, mid).pn < p) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

// ---------------------------------------------------------------------------
// 페이지
// ---------------------------------------------------------------------------

export default function TheoryPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="th-page">
      <header className="th-top">
        <button className="report-button" onClick={onBack}><ArrowLeft size={16} />계산기로</button>
        <span className="th-top-title">P-M 상관도 작도 원리</span>
      </header>

      <article className="th-article">
        <p className="eyebrow">RC Section · Theory</p>
        <h1>P-M 상관도는 어떻게 그려지는가</h1>
        <p className="th-lead">
          P-M 상관도는 철근콘크리트 단면이 파괴 직전에 버틸 수 있는 <b>축력 P 와 모멘트 M 의 조합</b>을 모은 경계다.
          곡선(또는 곡면) 위의 점 하나는 <b>극한 변형률 상태 하나</b>에 대응한다. 따라서 상관도를 그린다는 것은
          "가능한 모든 극한 변형률 분포를 차례로 가정하고, 그때마다 단면 내력을 적분해 점을 찍는 일"이다.
          1축은 그 가정을 숫자 하나(중립축 깊이 <i>c</i>)로, 2축은 숫자 둘(중립축 각도 <i>θ</i> 와 깊이 <i>c</i>)로 한다.
        </p>

        <nav className="th-toc">
          <a href="#theory-common">0. 공통 가정</a>
          <a href="#theory-uniaxial">1. 1축 (Uniaxial)</a>
          <a href="#theory-biaxial">2. 2축 (Biaxial)</a>
          <a href="#theory-compare">3. 1축 vs 2축 정리</a>
        </nav>

        <Section id="theory-common" title="0. 공통 가정 — 한 점을 계산하는 규칙">
          <p>1축이든 2축이든 상관도의 점 하나는 아래 규칙으로 계산한다. 차이는 변형률 분포를 몇 개의 변수로 정하느냐뿐이다.</p>
          <ol className="th-list">
            <li><b>평면유지</b> — 변형 후에도 단면은 평면이다. 변형률은 단면 위에서 직선(1축) 또는 평면(2축)으로 분포한다.</li>
            <li><b>극한상태 정의</b> — 최압축 연단의 콘크리트 변형률이 <i>ε<sub>cu</sub></i>(fck ≤ 40 MPa 이면 0.0033)에 도달한 순간을 파괴로 본다.</li>
            <li><b>콘크리트</b> — 인장은 무시한다. 압축은 등가직사각형 응력블록(응력 <i>α·f<sub>cd</sub></i>, 깊이 <i>a = β₁c</i>) 또는 포물선-직선 응력법칙을 밴드로 적분(파이버)한다.</li>
            <li><b>철근</b> — 탄성-완전소성. <i>f<sub>s</sub> = E<sub>s</sub>·ε<sub>s</sub></i>, |<i>f<sub>s</sub></i>| ≤ <i>f<sub>y</sub></i>. 압축측 철근은 그 자리의 콘크리트 응력을 공제한다(<i>f<sub>s</sub> − α·f<sub>cd</sub></i>).</li>
            <li><b>모멘트 기준점은 소성중심</b> — KDS 14 20 20: 편심은 소성중심에서 잰다. 이 점을 기준으로 해야 순압축점이 정확히 M = 0 에 놓인다.</li>
            <li><b>부호</b> — 압축 +, 인장 −.</li>
          </ol>
          <Formula>{`변형률 상태 가정  →  각 위치의 변형률 ε  →  응력 σ(ε)  →  합력 Pn, 모멘트 Mn  →  상관도 위 한 점`}</Formula>
        </Section>

        <Section id="theory-uniaxial" title="1. 1축 P-M 상관도 — 미지수는 c 하나">
          <h3>1.1 변형률 분포</h3>
          <p>
            1축에서는 중립축이 항상 수평(모멘트 축과 평행)이라고 가정한다. 그러면 변형률 직선은 최압축 연단의 <i>ε<sub>cu</sub></i> 와
            중립축 깊이 <i>c</i> 만으로 완전히 결정된다.
          </p>
          <Formula>{`ε(y) = ε_cu · ( y − (y_max − c) ) / c        y_max = 최압축 연단 좌표`}</Formula>

          <h3>1.2 내력 적분</h3>
          <p>c 가 정해지면 콘크리트 압축력과 각 철근의 힘을 구해 더한다.</p>
          <Formula>{`Cc  = α·f_cd · A_c(a)            A_c(a) = 연단에서 깊이 a = β₁·c 까지의 콘크리트 면적
Fs_i = A_s,i · f_s(ε_i)          (압축측이면 f_s − α·f_cd)

Pn = Cc + Σ Fs_i
Mn = Cc·(y_c − y_pc) + Σ Fs_i·(y_i − y_pc)     y_pc = 소성중심`}</Formula>

          <h3>1.3 c 를 훑으면 곡선이 된다</h3>
          <p>
            c 를 아주 작은 값(중립축이 압축연단 바로 아래)에서 무한대(전 단면 압축)까지 늘려 가며 위 계산을 반복하면,
            (Mn, Pn) 점들이 이어져 상관도 곡선이 된다. 곡선 위에는 의미 있는 특성점이 있다.
          </p>
          <table className="th-table">
            <thead><tr><th>특성점</th><th>변형률 상태</th><th>의미</th></tr></thead>
            <tbody>
              <tr><td>순압축 P₀</td><td>c → ∞, 전 단면 ε<sub>cu</sub></td><td>곡선 최상단, M = 0 (소성중심 기준)</td></tr>
              <tr><td>평형점 (Pb, Mb)</td><td>최외단 인장철근 ε<sub>t</sub> = ε<sub>y</sub></td><td>압축지배 ↔ 인장 측 경계, 대체로 모멘트 최대</td></tr>
              <tr><td>인장지배 한계</td><td>ε<sub>t</sub> = 0.005</td><td>여기부터 φ = 0.85</td></tr>
              <tr><td>순휨</td><td>Pn = 0 이 되는 c</td><td>보(beam)의 휨강도</td></tr>
              <tr><td>순인장</td><td>콘크리트 없음, 전 철근 −f<sub>y</sub></td><td>곡선 최하단</td></tr>
            </tbody>
          </table>

          <h3>1.4 직접 움직여 보기</h3>
          <p className="th-note">
            예제 단면: {DEMO_B}×{DEMO_H} mm, D25 {demoRebars.length}개, f<sub>ck</sub> {demoMaterials.concrete.fc} MPa,
            f<sub>y</sub> {demoMaterials.steel.fy} MPa, 강도설계법 · 등가블록 (β₁ = {fmt(BETA1)}). 슬라이더로 c 를 바꾸면
            왼쪽의 변형률·응력 상태와 오른쪽 곡선 위의 점이 함께 움직인다.
          </p>
          <UniaxialDemo />

          <h3>1.5 공칭강도에서 설계강도로</h3>
          <p>
            위 곡선은 <b>공칭강도</b>(Pn, Mn)다. 강도설계법은 각 점에 강도감소계수 φ 를 곱해 설계강도 곡선을 만든다.
            φ 는 그 점의 최외단 인장철근 변형률 ε<sub>t</sub> 로 정해지므로 곡선을 따라 변한다.
          </p>
          <Formula>{`ε_t ≤ ε_y          → φ = 0.65 (띠) / 0.70 (나선)     압축지배
ε_y < ε_t < 0.005  → 선형 보간                          변화구간
ε_t ≥ 0.005        → φ = 0.85                           인장지배

φPn ≤ α·φ·Pn0      α = 0.80 (띠) / 0.85 (나선)       ← 곡선 상단을 수평으로 자름 (최소편심 대체)`}</Formula>
          <p>
            한계상태설계법(교량)은 φ 를 곱하는 대신 재료저항계수(φ<sub>c</sub> = 0.65, φ<sub>s</sub> = 0.90)를
            f<sub>cd</sub>, f<sub>yd</sub> 에 미리 반영해 곡선을 그리므로, 그려진 곡선 자체가 설계강도다. 최소편심은 곡선을 자르는 대신
            작용모멘트를 e₀ = max(h/30, 20 mm) 로 하한 처리해 반영한다.
          </p>
        </Section>

        <Section id="theory-biaxial" title="2. 2축 P-M 상관도 — 미지수는 (θ, c) 둘">
          <h3>2.1 무엇이 달라지나</h3>
          <p>
            Mx 와 My 가 동시에 작용하면 중립축이 더 이상 수평이 아니다. 중립축은 임의 각도로 기울고,
            결과물은 (M, P) 평면의 곡선이 아니라 <b>(Mx, My, P) 공간의 곡면</b>이 된다.
            1축 계산은 이 곡면을 θ = 90° 로 자른 단면에 불과하다.
          </p>

          <h3>2.2 변형률 평면 — 법선 방향 좌표 s</h3>
          <p>
            중립축의 법선 단위벡터 n̂ = (cos θ, sin θ) 를 압축측으로 잡고, 단면 위 점을 그 방향으로 투영한 좌표 s 를 쓴다.
            그러면 1축의 y 자리에 s 를 넣는 것만으로 식이 그대로 일반화된다.
          </p>
          <Formula>{`s(x, y) = x·cos θ + y·sin θ          s_max = 최압축 연단(모서리)의 s
ε(x, y) = ε_cu · ( s − (s_max − c) ) / c

θ = 90°  →  s = y  →  1축 식과 동일`}</Formula>
          <p>압축영역은 반평면 {"{ s ≥ s_max − β₁c }"} 로 단면 다각형을 잘라 얻는다. 모서리가 먼저 눌리므로 압축영역은 삼각형·오각형 같은 임의 다각형이 된다.</p>
          <Formula>{`Pn  = Cc + Σ Fs_i
Mnx = Cc·(y_c − y_pc) + Σ Fs_i·(y_i − y_pc)  = Pn · e_y      (x축 회전)
Mny = Cc·(x_c − x_pc) + Σ Fs_i·(x_i − x_pc)  = Pn · e_x      (y축 회전)

편심(모멘트) 방향  α_e = atan2(Mnx, Mny)`}</Formula>

          <h3>2.3 곡면을 만드는 방법 — 자오선과 등고선</h3>
          <ul className="th-list">
            <li><b>자오선(meridian)</b> — θ 하나를 고정하고 c 를 훑으면 공간 곡선 하나가 나온다. 1축 곡선과 같은 방식이다.</li>
            <li><b>곡면</b> — θ 를 0°~360° 로 돌려 가며 자오선을 모으면 곡면이 된다. 이 프로그램은 72방향(5°) × 60점으로 그린다. 비대칭 단면·배근이면 반대 방향이 다른 값을 주므로 반드시 360° 전체를 훑는다.</li>
            <li><b>Mx-My 등고선(load contour)</b> — 곡면을 축력 P = 일정한 평면으로 수평 절단한 폐곡선. 각 자오선에서 Pn = P 인 점을 찾아 잇는다.</li>
            <li><b>방향 슬라이스</b> — 곡면을 모멘트 방향 α_e = 일정한 평면으로 수직 절단하면 그 방향의 P-M 곡선이 된다. 하중 검토는 이 곡선과 비교하는 것이다.</li>
          </ul>

          <h3>2.4 핵심 함정 — 중립축 방향 θ ≠ 모멘트 방향 α_e</h3>
          <p>
            중립축을 θ 방향으로 기울였다고 모멘트 벡터가 같은 방향으로 나오지 않는다. 대칭 단면을 정확히 주축 방향(θ = 0°, 90°, …)으로
            자를 때만 θ = α_e 이고, 그 사이에서는 두 각도가 벌어진다. 세장한 직사각형일수록 차이가 커서 10~30° 에 이른다.
            약축 쪽으로 편심이 조금만 기울어도 중립축은 훨씬 덜 기울기 때문이다.
          </p>
          <div className="th-callout">
            <b>틀린 방법</b>: 하중의 편심 방향 α_e 만큼 단면을 돌린 뒤 1축 계산을 그대로 돌린다.<br />
            <b>올바른 방법</b>: 주어진 (Pu, α_e) 를 만족하는 (θ, c) 를 <b>역으로 찾는다</b> (2.6).
          </div>

          <h3>2.5 직접 움직여 보기</h3>
          <p className="th-note">
            같은 예제 단면을 쓴다. 중립축 각도 θ 와 축력 P 를 정하면 Pn(c) = P 가 되는 c 를 찾아 단면 상태를 그린다.
            등고선 위에서 <span className="th-key theta">점선(θ 방향)</span>과 <span className="th-key alpha">실제 점(α_e 방향)</span>이 어긋나는 것을 확인해 보자.
          </p>
          <BiaxialDemo />

          <h3>2.6 검토 — 2중 반복 역해석</h3>
          <p>하중 (Pu, Mux, Muy) 가 주어지면 순방향 계산이 아니라 역문제를 푼다.</p>
          <Formula>{`목표:  Pn(θ, c) = Pu   그리고   α_e(θ, c) = atan2(Mux, Muy)

inner loop (θ 고정):  Pn(c) = Pu 인 c 를 이분법으로    ← Pn 은 c 에 대해 단조 증가, 항상 수렴
outer loop:           α_e(θ) − α_e,target 의 부호가 바뀌는 θ 구간을 모두 찾아 정밀화
                      (비대칭 배근·L형 단면은 α_e(θ) 가 비단조일 수 있음 → 해가 여럿이면 바깥쪽 해)

사용률 = |Mu| / |φMn(Pu, α_e)|      ≤ 1.0 이면 O.K`}</Formula>
          <p>
            즉 "같은 축력, 같은 모멘트 방향에서 곡면까지의 거리"와 하중 크기를 비교한다. φ 가 (θ, c) 에 따라 변해 설계곡면은 볼록성이
            깨질 수 있으므로, 원점 기준 볼록 껍질 같은 지름길이 아니라 실제 곡면과의 교점을 찾아야 한다.
          </p>

          <h3>2.7 간이법과의 관계</h3>
          <p>
            Bresler 역수법(1/Pn ≈ 1/Pnx + 1/Pny − 1/P₀)이나 하중등고선법((Mx/Mx0)<sup>α</sup> + (My/My0)<sup>α</sup> ≤ 1)은
            두 주축 방향의 1축 곡선만으로 이 곡면을 근사하는 방법이다. 곡면을 직접 계산할 수 있으면 대조용으로만 쓴다.
          </p>
        </Section>

        <Section id="theory-compare" title="3. 1축 vs 2축 정리">
          <table className="th-table">
            <thead><tr><th>항목</th><th>1축</th><th>2축</th></tr></thead>
            <tbody>
              <tr><td>변형률 분포</td><td>직선, 변수 c</td><td>평면, 변수 (θ, c)</td></tr>
              <tr><td>중립축</td><td>수평 고정</td><td>임의 각도 θ</td></tr>
              <tr><td>압축영역</td><td>사각형·사다리꼴</td><td>삼각형·오각형 등 임의 다각형</td></tr>
              <tr><td>모멘트</td><td>Mn 하나</td><td>Mnx, Mny 두 성분</td></tr>
              <tr><td>결과물</td><td>(M, P) 곡선</td><td>(Mx, My, P) 곡면</td></tr>
              <tr><td>작도</td><td>c 를 1회 sweep</td><td>θ × c 격자 sweep (자오선 다발)</td></tr>
              <tr><td>검토</td><td>Pu 에서의 M 강도와 비교</td><td>(Pu, α_e) 역해석 후 비교</td></tr>
              <tr><td>각도 관계</td><td>θ = α_e (대칭)</td><td>일반적으로 θ ≠ α_e</td></tr>
            </tbody>
          </table>
          <p className="th-note">
            이 프로그램은 1축 전용 경로를 따로 두지 않는다. Muy = 0 이면 2축 엔진이 자동으로 θ = 90° 해를 찾아 1축과 같은 결과를 낸다.
          </p>
        </Section>
      </article>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="th-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Formula({ children }: { children: string }) {
  return <pre className="th-formula">{children}</pre>;
}

// ---------------------------------------------------------------------------
// 1축 데모
// ---------------------------------------------------------------------------

interface CurvePoint {
  c: number;
  pn: number;
  mn: number;
  pd: number;
  md: number;
}

function toCurvePoint(c: number, r: SectionResponse): CurvePoint {
  return { c, pn: r.pn, mn: r.mnx, pd: r.pd, md: r.mdx };
}

/** c 슬라이더 위치(0~1) → c. 작은 c 쪽을 촘촘히 보도록 지수 매핑. */
const C_MIN_RATIO = 0.03;
const C_MAX_RATIO = 2.5;
function sliderToC(t: number, depth: number): number {
  return depth * C_MIN_RATIO * Math.pow(C_MAX_RATIO / C_MIN_RATIO, t);
}
function cToSlider(c: number, depth: number): number {
  return Math.log(c / depth / C_MIN_RATIO) / Math.log(C_MAX_RATIO / C_MIN_RATIO);
}

function UniaxialDemo() {
  const { sMax, depth } = depthAt(UNI_THETA);
  const minBarY = Math.min(...demoRebars.map((b) => b.y));
  const d = sMax - minBarY;
  const cBalanced = (ECU / (ECU + EPS_Y)) * d;
  const cTension = (ECU / (ECU + 0.005)) * d;

  const data = useMemo(() => {
    const curve: CurvePoint[] = [];
    const tension = pureTension(demoSection, demoMaterials, demoCode, demoIntegration);
    const compression = pureCompression(demoSection, demoMaterials, demoCode, demoIntegration);
    curve.push(toCurvePoint(0, tension));
    const n = 120;
    for (let i = 0; i <= n; i += 1) {
      const c = depth * 0.005 * Math.pow(6 / 0.005, i / n);
      curve.push(toCurvePoint(c, respond(UNI_THETA, c)));
    }
    curve.push(toCurvePoint(Number.POSITIVE_INFINITY, compression));
    const cPureBending = solveC(UNI_THETA, 0);
    const axialCap = demoCode.axialLimitFactor("tie") * compression.phi * compression.pn;
    return {
      curve,
      p0: toCurvePoint(Number.POSITIVE_INFINITY, compression),
      pt: toCurvePoint(0, tension),
      balanced: toCurvePoint(cBalanced, respond(UNI_THETA, cBalanced)),
      tensionLimit: toCurvePoint(cTension, respond(UNI_THETA, cTension)),
      pureBending: toCurvePoint(cPureBending, respond(UNI_THETA, cPureBending)),
      axialCap,
    };
  }, [depth, cBalanced, cTension]);

  const [t, setT] = useState(() => cToSlider(cBalanced, depth));
  const c = sliderToC(t, depth);
  const r = respond(UNI_THETA, c);
  const epsT = r.maxTensileStrain;
  const regime = epsT <= EPS_Y ? "압축지배" : epsT >= 0.005 ? "인장지배" : "변화구간";

  const jump = (target: number) => setT(Math.min(1, Math.max(0, cToSlider(target, depth))));

  return (
    <div className="th-demo">
      <div className="th-controls">
        <label className="th-slider">
          <span>중립축 깊이 c</span>
          <input type="range" min="0" max="1" step="0.001" value={t} onChange={(e) => setT(Number(e.target.value))} />
          <span className="th-value">{fmt(c)} mm ({fmt(c / depth)}h)</span>
        </label>
        <div className="th-chips">
          <button onClick={() => jump(data.pureBending.c)}>순휨</button>
          <button onClick={() => jump(cTension)}>ε<sub>t</sub> = 0.005</button>
          <button onClick={() => jump(cBalanced)}>평형점</button>
          <button onClick={() => jump(depth * 1.2)}>c = 1.2h</button>
        </div>
      </div>
      <div className="th-demo-grid">
        <figure className="th-figure">
          <UniaxialStateSvg response={r} c={c} />
          <figcaption>단면 · 변형률 · 응력/합력 (c = {fmt(c)} mm)</figcaption>
        </figure>
        <figure className="th-figure">
          <UniaxialCurveSvg data={data} current={toCurvePoint(c, r)} />
          <figcaption>c 를 0 → ∞ 로 훑은 결과가 P-M 곡선</figcaption>
        </figure>
      </div>
      <div className="th-readout">
        <Readout k="a = β₁c" v={`${fmt(Math.min(BETA1 * c, depth))} mm`} />
        <Readout k="최외단 ε_t" v={epsT.toFixed(5)} />
        <Readout k="상태" v={regime} />
        <Readout k="φ" v={r.phi.toFixed(3)} />
        <Readout k="Pn" v={`${fmt(r.pn)} kN`} />
        <Readout k="Mn" v={`${fmt(r.mnx)} kN·m`} />
        <Readout k="φPn" v={`${fmt(r.pd)} kN`} />
        <Readout k="φMn" v={`${fmt(r.mdx)} kN·m`} />
      </div>
    </div>
  );
}

function Readout({ k, v }: { k: string; v: string }) {
  return (
    <div className="th-readout-item">
      <span>{k}</span>
      <strong>{v}</strong>
    </div>
  );
}

function UniaxialStateSvg({ response, c }: { response: SectionResponse; c: number }) {
  const W = 560;
  const H = 330;
  const top = 30;
  const scale = 260 / DEMO_H;
  const secX0 = 30;
  const secW = DEMO_B * scale;
  const yOf = (y: number) => top + (DEMO_H / 2 - y) * scale;
  const xOf = (x: number) => secX0 + (x + DEMO_B / 2) * scale;
  const naY = DEMO_H / 2 - c;
  const blockBottom = Math.max(-DEMO_H / 2, DEMO_H / 2 - BETA1 * c);

  // 변형률 다이어그램
  const strainX0 = 270;
  const epsBottom = ECU * (1 - DEMO_H / c);
  const epsScale = 80 / Math.max(ECU, Math.abs(epsBottom), 1e-9);
  const ex = (e: number) => strainX0 + e * epsScale;

  // 합력 다이어그램: 콘크리트 블록 + 철근 층별 합력
  const forceX0 = 450;
  const layers = new Map<number, number>();
  for (const bar of response.bars) layers.set(bar.y, (layers.get(bar.y) ?? 0) + bar.force);
  const maxForce = Math.max(Math.abs(response.concrete.force), ...[...layers.values()].map(Math.abs), 1);
  const fScale = 85 / maxForce;
  const cc = response.concrete.force;
  const ccY = response.concrete.area > 1e-9 ? response.concrete.centroid.y : DEMO_H / 2;

  return (
    <svg className="th-svg" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <marker id="th-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="th-arrowhead" />
        </marker>
      </defs>
      <text className="th-svg-title" x={secX0} y={16}>단면</text>
      <text className="th-svg-title" x={strainX0 - 30} y={16}>변형률 ε</text>
      <text className="th-svg-title" x={forceX0 - 40} y={16}>힘 (kN)</text>

      {/* 단면 */}
      <rect className="th-sec" x={secX0} y={yOf(DEMO_H / 2)} width={secW} height={DEMO_H * scale} />
      <rect className="th-block" x={secX0} y={yOf(DEMO_H / 2)} width={secW} height={(DEMO_H / 2 - blockBottom) * scale} />
      {naY > -DEMO_H / 2 && (
        <g>
          <line className="th-na" x1={secX0 - 12} x2={W - 10} y1={yOf(naY)} y2={yOf(naY)} />
          <text className="th-na-label" x={secX0 + secW + 4} y={yOf(naY) - 4}>중립축</text>
        </g>
      )}
      {response.bars.map((bar) => (
        <circle key={bar.id} cx={xOf(bar.x)} cy={yOf(bar.y)} r={Math.max(3, 12.5 * scale + 1.5)}
          className={bar.compression ? "th-bar comp" : "th-bar tens"} />
      ))}
      <Dim x={secX0 - 14} y1={yOf(DEMO_H / 2)} y2={yOf(Math.max(naY, -DEMO_H / 2))} label="c" />

      {/* 변형률 */}
      <line className="th-axis" x1={strainX0} x2={strainX0} y1={yOf(DEMO_H / 2) - 6} y2={yOf(-DEMO_H / 2) + 6} />
      <polygon className="th-strain"
        points={`${strainX0},${yOf(DEMO_H / 2)} ${ex(ECU)},${yOf(DEMO_H / 2)} ${ex(epsBottom)},${yOf(-DEMO_H / 2)} ${strainX0},${yOf(-DEMO_H / 2)}`} />
      <text className="th-small" x={ex(ECU) + 4} y={yOf(DEMO_H / 2) + 4}>ε_cu</text>
      {[...new Set(response.bars.map((b) => b.y))].map((y) => {
        const bar = response.bars.find((b) => b.y === y)!;
        return <circle key={y} cx={ex(bar.strain)} cy={yOf(y)} r={3} className={bar.compression ? "th-bar comp" : "th-bar tens"} />;
      })}
      <text className="th-small" x={strainX0 + 4} y={H - 8}>압축 →</text>
      <text className="th-small" x={strainX0 - 52} y={H - 8}>← 인장</text>

      {/* 합력 */}
      <line className="th-axis" x1={forceX0} x2={forceX0} y1={yOf(DEMO_H / 2) - 6} y2={yOf(-DEMO_H / 2) + 6} />
      <rect className="th-block" x={forceX0} y={yOf(DEMO_H / 2)} width={22} height={(DEMO_H / 2 - blockBottom) * scale} />
      {Math.abs(cc) > 1e-6 && (
        <g>
          <line className="th-force conc" x1={forceX0 + cc * fScale} x2={forceX0 + 1} y1={yOf(ccY)} y2={yOf(ccY)} markerEnd="url(#th-arrow)" />
          <text className="th-small" x={forceX0 + Math.min(cc * fScale, 85) - 30} y={yOf(ccY) - 5}>Cc {fmt(cc)}</text>
        </g>
      )}
      {[...layers.entries()].map(([y, f]) =>
        Math.abs(f) < 1e-6 ? null : (
          <g key={y}>
            {f > 0 ? (
              <line className="th-force comp" x1={forceX0 + f * fScale} x2={forceX0 + 1} y1={yOf(y)} y2={yOf(y)} markerEnd="url(#th-arrow)" />
            ) : (
              <line className="th-force tens" x1={forceX0} x2={forceX0 + f * fScale} y1={yOf(y)} y2={yOf(y)} markerEnd="url(#th-arrow)" />
            )}
            <text className="th-small" x={f > 0 ? forceX0 + 4 : forceX0 + f * fScale - 4} y={yOf(y) + 13}
              textAnchor={f > 0 ? "start" : "end"}>{fmt(f)}</text>
          </g>
        ),
      )}
    </svg>
  );
}

function Dim({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
  if (Math.abs(y2 - y1) < 2) return null;
  return (
    <g className="th-dim">
      <line x1={x} x2={x} y1={y1} y2={y2} />
      <line x1={x - 4} x2={x + 4} y1={y1} y2={y1} />
      <line x1={x - 4} x2={x + 4} y1={y2} y2={y2} />
      <text x={x - 6} y={(y1 + y2) / 2 + 4} textAnchor="end">{label}</text>
    </g>
  );
}

function UniaxialCurveSvg({
  data,
  current,
}: {
  data: {
    curve: CurvePoint[];
    p0: CurvePoint;
    pt: CurvePoint;
    balanced: CurvePoint;
    tensionLimit: CurvePoint;
    pureBending: CurvePoint;
    axialCap: number;
  };
  current: CurvePoint;
}) {
  const W = 460;
  const H = 360;
  const pad = { l: 58, r: 18, t: 16, b: 34 };
  const mMax = Math.max(...data.curve.map((p) => p.mn)) * 1.15;
  const pMax = data.p0.pn * 1.08;
  const pMin = data.pt.pn * 1.15;
  const x = (m: number) => pad.l + (m / mMax) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + ((pMax - p) / (pMax - pMin)) * (H - pad.t - pad.b);

  const nominal = data.curve.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.mn)} ${y(p.pn)}`).join(" ");
  const design = data.curve.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.md)} ${y(Math.min(p.pd, data.axialCap))}`).join(" ");
  const ticksP = niceTicks(pMin, pMax, 6);
  const ticksM = niceTicks(0, mMax, 5);

  const marks: { p: CurvePoint; label: string; dx: number; dy: number }[] = [
    { p: data.p0, label: "순압축 P₀", dx: 8, dy: 4 },
    { p: data.balanced, label: "평형점", dx: 8, dy: -6 },
    { p: data.tensionLimit, label: "ε_t=0.005", dx: 8, dy: 4 },
    { p: data.pureBending, label: "순휨", dx: 8, dy: 14 },
    { p: data.pt, label: "순인장", dx: 8, dy: 4 },
  ];

  return (
    <svg className="th-svg" viewBox={`0 0 ${W} ${H}`}>
      {ticksP.map((p) => (
        <g key={`p${p}`}>
          <line className="th-grid" x1={pad.l} x2={W - pad.r} y1={y(p)} y2={y(p)} />
          <text className="th-tick" x={pad.l - 6} y={y(p) + 4} textAnchor="end">{tickFmt(p)}</text>
        </g>
      ))}
      {ticksM.map((m) => (
        <g key={`m${m}`}>
          <line className="th-grid" x1={x(m)} x2={x(m)} y1={pad.t} y2={H - pad.b} />
          <text className="th-tick" x={x(m)} y={H - pad.b + 14} textAnchor="middle">{tickFmt(m)}</text>
        </g>
      ))}
      <line className="th-axis" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
      <line className="th-axis" x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} />
      <line className="th-cap" x1={pad.l} x2={W - pad.r} y1={y(data.axialCap)} y2={y(data.axialCap)} />
      <text className="th-small cap" x={W - pad.r - 4} y={y(data.axialCap) - 4} textAnchor="end">0.80·φ·P₀</text>
      <path d={nominal} className="th-curve nominal" />
      <path d={design} className="th-curve design" />
      {marks.map((m) => (
        <g key={m.label}>
          <circle cx={x(m.p.mn)} cy={y(m.p.pn)} r={3.5} className="th-mark" />
          <text className="th-small" x={x(m.p.mn) + m.dx} y={y(m.p.pn) + m.dy}>{m.label}</text>
        </g>
      ))}
      <line className="th-ecc" x1={x(0)} y1={y(0)} x2={x(current.mn)} y2={y(current.pn)} />
      <circle cx={x(current.mn)} cy={y(current.pn)} r={6} className="th-current" />
      <circle cx={x(current.md)} cy={y(Math.min(current.pd, data.axialCap))} r={4} className="th-current design" />
      <text className="th-axis-label" x={W - pad.r} y={H - 4} textAnchor="end">M (kN·m)</text>
      <text className="th-axis-label" x={8} y={12}>P (kN)</text>
      <g transform={`translate(${W - 150}, ${pad.t + 34})`}>
        <line className="th-curve nominal" x1={0} x2={18} y1={0} y2={0} /><text className="th-small" x={24} y={4}>공칭 (Mn, Pn)</text>
        <line className="th-curve design" x1={0} x2={18} y1={16} y2={16} /><text className="th-small" x={24} y={20}>설계 (φMn, φPn)</text>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 2축 데모
// ---------------------------------------------------------------------------

function BiaxialDemo() {
  const surface = useMemo(
    () =>
      computeSurface(demoSection, demoMaterials, {
        designCode: "kds_strength",
        method: "equivalent_block",
        thetaSteps: 72,
        cSteps: 48,
      }),
    [],
  );
  const [thetaDeg, setThetaDeg] = useState(60);
  const [pRatio, setPRatio] = useState(0.3);
  const [azimuth, setAzimuth] = useState(35);

  if (!surface) return null;
  const theta = (thetaDeg * Math.PI) / 180;
  const p = pRatio * surface.pn0;
  const c = solveC(theta, p);
  const r = respond(theta, c);
  const alphaE = Math.atan2(r.mnx, r.mny);
  const diff = wrapDeg(radToDeg(alphaE) - thetaDeg);

  return (
    <div className="th-demo">
      <div className="th-controls">
        <label className="th-slider">
          <span>중립축 각도 θ</span>
          <input type="range" min="0" max="359" step="1" value={thetaDeg} onChange={(e) => setThetaDeg(Number(e.target.value))} />
          <span className="th-value">{thetaDeg}°</span>
        </label>
        <label className="th-slider">
          <span>축력 P</span>
          <input type="range" min="-0.1" max="0.85" step="0.01" value={pRatio} onChange={(e) => setPRatio(Number(e.target.value))} />
          <span className="th-value">{fmt(p)} kN ({fmt(pRatio)}P₀)</span>
        </label>
        <div className="th-chips">
          <button onClick={() => setThetaDeg(90)}>θ = 90° (1축, 강축)</button>
          <button onClick={() => setThetaDeg(0)}>θ = 0° (1축, 약축)</button>
          <button onClick={() => setThetaDeg(60)}>θ = 60°</button>
        </div>
      </div>
      <div className="th-demo-grid">
        <figure className="th-figure">
          <BiaxialSectionSvg response={r} theta={theta} alphaE={alphaE} />
          <figcaption>기운 중립축과 압축영역 (c = {fmt(c)} mm)</figcaption>
        </figure>
        <figure className="th-figure">
          <ContourDemoSvg surface={surface} p={p} theta={theta} response={r} />
          <figcaption>P = {fmt(p)} kN 에서의 Mx-My 등고선</figcaption>
        </figure>
        <figure className="th-figure">
          <AlphaGapSvg surface={surface} p={p} thetaDeg={thetaDeg} />
          <figcaption>같은 축력에서 θ 에 따른 (α_e − θ)</figcaption>
        </figure>
        <figure className="th-figure">
          <Surface3dSvg surface={surface} p={p} theta={theta} azimuthDeg={azimuth} />
          <figcaption>
            자오선 다발로 그린 강도곡면 (공칭)
            <span className="th-mini-label">시점 회전</span>
            <input className="th-mini-range" type="range" min="0" max="359" value={azimuth} onChange={(e) => setAzimuth(Number(e.target.value))} title="시점 회전" />
          </figcaption>
        </figure>
      </div>
      <div className="th-readout">
        <Readout k="θ (중립축 법선)" v={`${thetaDeg}°`} />
        <Readout k="α_e (모멘트 방향)" v={`${fmt(normDeg(radToDeg(alphaE)))}°`} />
        <Readout k="α_e − θ" v={`${diff >= 0 ? "+" : ""}${fmt(diff)}°`} />
        <Readout k="Pn" v={`${fmt(r.pn)} kN`} />
        <Readout k="Mnx" v={`${fmt(r.mnx)} kN·m`} />
        <Readout k="Mny" v={`${fmt(r.mny)} kN·m`} />
        <Readout k="|Mn|" v={`${fmt(Math.hypot(r.mnx, r.mny))} kN·m`} />
        <Readout k="φ" v={r.phi.toFixed(3)} />
      </div>
    </div>
  );
}

function wrapDeg(value: number): number {
  let v = value % 360;
  if (v > 180) v -= 360;
  if (v <= -180) v += 360;
  return v;
}

function normDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

function BiaxialSectionSvg({ response, theta, alphaE }: { response: SectionResponse; theta: number; alphaE: number }) {
  const W = 360;
  const H = 390;
  const scale = 300 / DEMO_H;
  const cx = W / 2;
  const cy = 168;
  const X = (x: number) => cx + x * scale;
  const Y = (y: number) => cy - y * scale;
  const { nx, ny } = axisNormal(theta);
  const { sMax } = response.neutralAxis;
  const sNa = sMax - response.neutralAxis.c;
  const base: Point = { x: nx * sNa, y: ny * sNa };
  const L = 1000;
  const ref = response.reference;
  const arrowLen = 120 / scale;
  const outline = demoRings[0].points.map((pt) => `${X(pt.x)},${Y(pt.y)}`).join(" ");
  const compression = clipRingsHalfPlane(demoRings, nx, ny, response.neutralAxis.blockLimit);

  return (
    <svg className="th-svg" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <clipPath id="th-sec-clip"><rect x={8} y={8} width={W - 16} height={H - 64} /></clipPath>
        <marker id="th-arrow-t" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="th-arrowhead theta" />
        </marker>
        <marker id="th-arrow-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="th-arrowhead alpha" />
        </marker>
      </defs>
      <polygon className="th-sec" points={outline} />
      {compression.map((ring) => (
        <polygon key={ring.id} className="th-block" points={ring.points.map((pt) => `${X(pt.x)},${Y(pt.y)}`).join(" ")} />
      ))}
      <g clipPath="url(#th-sec-clip)">
        <line className="th-na" x1={X(base.x - ny * L)} y1={Y(base.y + nx * L)} x2={X(base.x + ny * L)} y2={Y(base.y - nx * L)} />
      </g>
      {response.bars.map((bar) => (
        <circle key={bar.id} cx={X(bar.x)} cy={Y(bar.y)} r={12.5 * scale + 1.5} className={bar.compression ? "th-bar comp" : "th-bar tens"} />
      ))}
      <line className="th-vec theta" x1={X(ref.x)} y1={Y(ref.y)} x2={X(ref.x + nx * arrowLen)} y2={Y(ref.y + ny * arrowLen)} markerEnd="url(#th-arrow-t)" />
      <line className="th-vec alpha" x1={X(ref.x)} y1={Y(ref.y)}
        x2={X(ref.x + Math.cos(alphaE) * arrowLen)} y2={Y(ref.y + Math.sin(alphaE) * arrowLen)} markerEnd="url(#th-arrow-a)" />
      <circle cx={X(ref.x)} cy={Y(ref.y)} r={3} className="th-mark" />
      <text className="th-small theta" x={X(ref.x + nx * arrowLen * 1.12)} y={Y(ref.y + ny * arrowLen * 1.12)}>n̂ (θ)</text>
      <text className="th-small alpha" x={X(ref.x + Math.cos(alphaE) * arrowLen * 1.12)} y={Y(ref.y + Math.sin(alphaE) * arrowLen * 1.12) + 12}>e (α_e)</text>
      <text className="th-small" x={12} y={H - 26}>음영 = 등가블록 압축영역 (s ≥ s_max − β₁c)</text>
      <text className="th-small" x={12} y={H - 10}>● 압축 철근  ● 인장 철근  · 소성중심</text>
    </svg>
  );
}

function ContourDemoSvg({
  surface,
  p,
  theta,
  response,
}: {
  surface: InteractionSurface;
  p: number;
  theta: number;
  response: SectionResponse;
}) {
  const W = 360;
  const H = 360;
  const nominal = momentContour(surface, p, false);
  const limit = Math.max(1, ...surface.meridians.flat().map((pt) => Math.max(Math.abs(pt.mnx), Math.abs(pt.mny)))) * 1.08;
  const cx = W / 2;
  const cy = H / 2;
  const s = (W / 2 - 22) / limit;
  const X = (my: number) => cx + my * s;
  const Y = (mx: number) => cy - mx * s;
  const toPath = (pts: { mx: number; my: number }[]) =>
    pts.length > 2 ? `${pts.map((q, i) => `${i === 0 ? "M" : "L"} ${X(q.my)} ${Y(q.mx)}`).join(" ")} Z` : "";
  const R = W / 2 - 16;
  const ticks = niceTicks(-limit, limit, 4);

  return (
    <svg className="th-svg" viewBox={`0 0 ${W} ${H}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="th-grid" x1={X(t)} x2={X(t)} y1={10} y2={H - 10} />
          <line className="th-grid" x1={10} x2={W - 10} y1={Y(t)} y2={Y(t)} />
        </g>
      ))}
      <line className="th-axis" x1={10} x2={W - 10} y1={cy} y2={cy} />
      <line className="th-axis" x1={cx} x2={cx} y1={10} y2={H - 10} />
      {nominal.length > 2 ? <path d={toPath(nominal)} className="th-curve nominal fill" /> : (
        <text className="th-small" x={cx - 80} y={cy - 20}>이 축력에서는 등고선이 없습니다</text>
      )}
      <line className="th-vec theta dashed" x1={cx} y1={cy} x2={cx + Math.cos(theta) * R} y2={cy - Math.sin(theta) * R} />
      <line className="th-vec alpha" x1={cx} y1={cy} x2={X(response.mny)} y2={Y(response.mnx)} />
      <circle cx={X(response.mny)} cy={Y(response.mnx)} r={6} className="th-current" />
      <text className="th-small theta" x={cx + Math.cos(theta) * R * 0.95 + 4} y={cy - Math.sin(theta) * R * 0.95 - 4}>θ</text>
      <text className="th-axis-label" x={W - 12} y={cy - 6} textAnchor="end">Mny</text>
      <text className="th-axis-label" x={cx + 6} y={20}>Mnx</text>
      <text className="th-tick" x={W - 12} y={cy + 16} textAnchor="end">{fmt(limit)}</text>
    </svg>
  );
}

function AlphaGapSvg({ surface, p, thetaDeg }: { surface: InteractionSurface; p: number; thetaDeg: number }) {
  const W = 360;
  const H = 260;
  const pad = { l: 44, r: 12, t: 14, b: 30 };
  const hits = momentContour(surface, p, false)
    .filter((q) => Math.hypot(q.mx, q.my) > 1e-6)
    .map((q) => ({ t: normDeg(radToDeg(q.theta)), d: wrapDeg(radToDeg(Math.atan2(q.mx, q.my)) - radToDeg(q.theta)) }))
    .sort((a, b) => a.t - b.t);
  const dMax = Math.max(10, ...hits.map((h) => Math.abs(h.d))) * 1.15;
  const x = (t: number) => pad.l + (t / 360) * (W - pad.l - pad.r);
  const y = (d: number) => pad.t + ((dMax - d) / (2 * dMax)) * (H - pad.t - pad.b);
  const path = hits.map((h, i) => `${i === 0 ? "M" : "L"} ${x(h.t)} ${y(h.d)}`).join(" ");
  const ticksD = niceTicks(-dMax, dMax, 4);

  return (
    <svg className="th-svg" viewBox={`0 0 ${W} ${H}`}>
      {ticksD.map((d) => (
        <g key={d}>
          <line className="th-grid" x1={pad.l} x2={W - pad.r} y1={y(d)} y2={y(d)} />
          <text className="th-tick" x={pad.l - 6} y={y(d) + 4} textAnchor="end">{tickFmt(d)}°</text>
        </g>
      ))}
      {[0, 90, 180, 270, 360].map((t) => (
        <g key={t}>
          <line className="th-grid" x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} />
          <text className="th-tick" x={x(t)} y={H - pad.b + 14} textAnchor="middle">{t}°</text>
        </g>
      ))}
      <line className="th-axis" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
      {hits.length > 1 && <path d={path} className="th-curve alpha" />}
      <line className="th-vec theta dashed" x1={x(thetaDeg)} x2={x(thetaDeg)} y1={pad.t} y2={H - pad.b} />
      <text className="th-axis-label" x={W - pad.r} y={H - 2} textAnchor="end">θ</text>
      <text className="th-axis-label" x={6} y={11}>α_e − θ</text>
    </svg>
  );
}

function Surface3dSvg({
  surface,
  p,
  theta,
  azimuthDeg,
}: {
  surface: InteractionSurface;
  p: number;
  theta: number;
  azimuthDeg: number;
}) {
  const W = 360;
  const H = 360;
  const mMax = Math.max(1, ...surface.meridians.flat().map((q) => Math.hypot(q.mnx, q.mny)));
  const pTop = surface.pureCompression.pn;
  const pBot = surface.pureTension.pn;
  const pMid = (pTop + pBot) / 2;
  const pHalf = (pTop - pBot) / 2;
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (22 * Math.PI) / 180;
  const R = 118;
  const project = (mx: number, my: number, pn: number) => {
    const X = my / mMax;
    const Yh = mx / mMax;
    const Z = ((pn - pMid) / pHalf) * 1.15;
    const u = X * Math.cos(az) - Yh * Math.sin(az);
    const v = X * Math.sin(az) + Yh * Math.cos(az);
    return { x: W / 2 + u * R, y: H / 2 - (Z * Math.cos(el) + v * Math.sin(el)) * R };
  };
  const line = (pts: { x: number; y: number }[], closed = false) =>
    pts.length > 1 ? `${pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" ")}${closed ? " Z" : ""}` : "";

  const tip = surface.pureCompression;
  const foot = surface.pureTension;
  const meridianPaths = surface.meridians
    .filter((_, i) => i % 3 === 0)
    .map((m) => line([project(foot.mnx, foot.mny, foot.pn), ...m.map((q) => project(q.mnx, q.mny, q.pn)), project(tip.mnx, tip.mny, tip.pn)]));
  const levels = [-0.05, 0.1, 0.25, 0.4, 0.55, 0.7].map((f) => f * surface.pn0);
  const contourPaths = levels.map((lv) => line(momentContour(surface, lv, false).map((q) => project(q.mx, q.my, lv)), true));
  const current = line(momentContour(surface, p, false).map((q) => project(q.mx, q.my, p)), true);

  // 현재 θ 자오선
  const { depth } = depthAt(theta);
  const merid: { x: number; y: number }[] = [project(foot.mnx, foot.mny, foot.pn)];
  for (let i = 0; i <= 40; i += 1) {
    const c = depth * 0.01 * Math.pow(400, i / 40);
    const q = respond(theta, c);
    merid.push(project(q.mnx, q.mny, q.pn));
  }
  merid.push(project(tip.mnx, tip.mny, tip.pn));

  const o = project(0, 0, 0);
  const axisMy = project(0, mMax * 1.25, 0);
  const axisMx = project(mMax * 1.25, 0, 0);
  const axisP = project(0, 0, pTop * 1.12);

  return (
    <svg className="th-svg" viewBox={`0 0 ${W} ${H}`}>
      <line className="th-axis" x1={o.x} y1={o.y} x2={axisMy.x} y2={axisMy.y} />
      <line className="th-axis" x1={o.x} y1={o.y} x2={axisMx.x} y2={axisMx.y} />
      <line className="th-axis" x1={o.x} y1={o.y} x2={axisP.x} y2={axisP.y} />
      <text className="th-axis-label" x={axisMy.x + 4} y={axisMy.y}>My</text>
      <text className="th-axis-label" x={axisMx.x + 4} y={axisMx.y}>Mx</text>
      <text className="th-axis-label" x={axisP.x + 4} y={axisP.y}>P</text>
      {meridianPaths.map((d, i) => <path key={`m${i}`} d={d} className="th-wire" />)}
      {contourPaths.map((d, i) => <path key={`c${i}`} d={d} className="th-wire level" />)}
      <path d={line(merid)} className="th-curve theta-line" />
      {current && <path d={current} className="th-curve alpha-line" />}
      <text className="th-small theta" x={10} y={H - 26}>— θ 자오선 (θ 고정, c 를 훑음)</text>
      <text className="th-small alpha" x={10} y={H - 10}>— P 등고선 (P 고정 수평 절단)</text>
    </svg>
  );
}

function tickFmt(v: number): string {
  return Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1);
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out;
}
