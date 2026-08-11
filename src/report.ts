import {
  outerBounds,
  principalAxes,
  rebarArea,
  sectionArea,
  sectionCentroid,
  sectionSecondMoments,
  signedArea,
} from "./engine/geometry";
import {
  checkDemand,
  concreteElasticModulus,
  expandDemands,
  MIN_ECCENTRICITY_ID_SUFFIX,
  type ColumnGeometry,
  type DemandInput,
} from "./engine/demand";
import { parabolicRectangularLaw } from "./engine/concreteLaw";
import { breslerReciprocal, ec2BiaxialCheck } from "./engine/simplified";
import { capacityAt } from "./engine/solve";
import { referenceConcreteStress, type SectionResponse } from "./engine/section";
import type { InteractionSurface } from "./engine/surface";
import type { MaterialSet, Rebar, Ring } from "./engine/types";

export interface ReportColumn extends ColumnGeometry {
  title: string;
  cover: number;
  tieType: string;
}

export interface ReportInput {
  surface: InteractionSurface;
  materials: MaterialSet;
  column: ReportColumn;
  demands: DemandInput[];
  rings: Ring[];
  rebars: Rebar[];
  showSimplified: boolean;
}

export function buildReport(input: ReportInput): string {
  const { surface, materials, column, demands, rings, rebars } = input;
  const code = surface.code;
  const area = sectionArea(rings);
  const box = outerBounds(rings);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const totalSteelArea = rebars.reduce((sum, bar) => sum + rebarArea(bar.diameter), 0);
  const steelRatio = area > 0 ? totalSteelArea / area : 0;
  const moments = sectionSecondMoments(rings);
  const principal = principalAxes(moments);
  const geoCentroid = sectionCentroid(rings);
  const ec = concreteElasticModulus(materials);
  const fcd = materials.concrete.fc / code.materialFactors.concrete;
  const fyd = materials.steel.fy / code.materialFactors.steel;
  const block = code.stressBlock(materials.concrete.fc);
  const rx = area > 0 ? Math.sqrt(Math.abs(moments.ix) / area) : 0;
  const ry = area > 0 ? Math.sqrt(Math.abs(moments.iy) / area) : 0;
  const usesAxialCutoff = code.designBasis === "strength_reduction";
  const method = surface.integration.method ?? code.defaultIntegration;
  const law = parabolicRectangularLaw(materials.concrete.fc);

  const ringRows = rings.map(
    (ring) =>
      `         -. ${ring.id} (${ring.kind === "outer" ? "외곽" : "중공"}) : 절점 ${String(ring.points.length).padStart(3, " ")}개, 면적 ${sci(Math.abs(signedArea(ring.points)))} mm2`,
  );
  const barGroups = summarizeBarGroups(rebars, box);
  const barGroupRows = barGroups.map(
    (group, index) =>
      `         -. ${index + 1}단 철근 : H${fmt(group.diameter)} x ${String(group.count).padStart(3, " ")}ea = ${fmt(group.area)} mm2  (dc = ${fmt(group.dc)} mm)`,
  );

  // 한계상태설계법이면 최소편심 파생 케이스가 원 케이스 뒤에 끼어든다.
  const reviewedDemands = expandDemands(surface, materials, column, demands);
  const demandSections = reviewedDemands.map((demand, index) =>
    buildDemandReview(index + 1, demand, input),
  );

  return [
    `${column.title} P - M 상관분석 (2축)`,
    "",
    `    1) 검토 제목 : ${column.title}`,
    "",
    "    2) 설계조건",
    "",
    `        적용 설계법   : ${code.label}`,
    `        설계 기준강도 : fck = ${pad(fmt(materials.concrete.fc), 8)} MPa,  fy  = ${pad(fmt(materials.steel.fy), 8)} MPa`,
    `        계산용 강도   : fcd = ${pad(fmt(fcd), 8)} MPa,  fyd = ${pad(fmt(fyd), 8)} MPa`,
    `        재료 탄성계수 : Ec  = ${pad(fmt(ec), 8)} MPa,  Es  = ${pad(fmt(materials.steel.es), 8)} MPa`,
    ...(usesAxialCutoff
      ? [`        재료계수      : gamma_c = ${fmt(code.materialFactors.concrete)}, gamma_s = ${fmt(code.materialFactors.steel)}`]
      : [
          `        재료 저항계수 : phi_c = ${fmt(1 / code.materialFactors.concrete)}, phi_s = ${fmt(1 / code.materialFactors.steel)}` +
            `   (fcd = phi_c*fck, fyd = phi_s*fy)`,
        ]),
    `        압축영역 적분 : ${method === "fiber" ? "포물선-직선 (파이버)" : "등가직사각형 응력블록"}`,
    ...(method === "fiber"
      ? [
          `        f-e 곡선계수  : n = ${fmt(law.n)}, eco = ${strain(law.ec0)}, ecu = ${strain(law.ecu)}` +
            `,  정점응력 = ${fmt(referenceConcreteStress(materials, code, method))} MPa`,
        ]
      : [`        등가응력블록  : 0.85*eta = ${fmt(block.alpha)}, beta1 = ${fmt(block.beta)}`]),
    `        극한변형률    : ecu = ${strain(materials.concrete.ecu)},  ey = ${strain(materials.steel.fy / materials.steel.es)}`,
    "",
    "    3) 단면 제원",
    "",
    `        단 면 폭     (B ) : ${pad(fmt(width), 10)} mm`,
    `        단 면 높 이  (H ) : ${pad(fmt(height), 10)} mm`,
    `        철근 피복두께(d') : ${pad(fmt(column.cover), 10)} mm`,
    `        비지지 길이  (Lu) : ${pad(fmt(column.lu), 10)} mm`,
    `        유효길이계수 (Kx) : ${pad(fmt(column.kx), 10)}`,
    `        유효길이계수 (Ky) : ${pad(fmt(column.ky), 10)}`,
    `        횡방향 철근 형태  : ${column.tieType}`,
    "",
    "       (1) 단면 링 구성 (중공 공제)",
    "",
    ...(ringRows.length > 0 ? ringRows : ["         -. 링 없음"]),
    `         -. 순 단면적 Ac   : ${pad(sci(area), 12)} mm2`,
    "",
    "       (2) 단면 상수",
    "",
    `         -. 기하 도심      : x = ${fmt(geoCentroid.x)} mm, y = ${fmt(geoCentroid.y)} mm`,
    `         -. 소 성 중 심    : x = ${fmt(surface.reference.x)} mm, y = ${fmt(surface.reference.y)} mm  <- 모멘트 기준점 (KDS 14 20 20)`,
    `         -. 도심-소성중심 차 : dx = ${fmt(surface.reference.x - geoCentroid.x)} mm, dy = ${fmt(surface.reference.y - geoCentroid.y)} mm`,
    `         -. Ix / Iy / Ixy  : ${sci(moments.ix)} / ${sci(moments.iy)} / ${sci(moments.ixy)} mm4`,
    `         -. 주축 각도      : ${fmt(radToDeg(principal.angle))} deg  (I1 = ${sci(principal.i1)}, I2 = ${sci(principal.i2)} mm4)`,
    `         -. 회전반경 rx, ry: ${fmt(rx)} mm, ${fmt(ry)} mm`,
    "",
    "    4) 사용 강재량",
    "",
    ...(barGroupRows.length > 0 ? barGroupRows : ["         -. 철근 없음"]),
    `         -. 총 사용 철근량 : Ast    = ${pad(fmt(totalSteelArea), 10)} mm2`,
    `         -. 사 용 철 근 비 : rho    = ${pad(fmt(steelRatio), 8)} (${fmt(steelRatio * 100)} %)`,
    `         -. rho_min (0.0100) <= rho <= rho_max (0.0800)  ${steelRatio >= 0.01 && steelRatio <= 0.08 ? "∴ O.K" : "∴ N.G"}`,
    "",
    "    5) 강도곡면 요약",
    "",
    `        순압축강도    : Pn0     = ${pad(fmt(surface.pn0), 10)} kN`,
    `        순인장강도    : Pnt     = ${pad(fmt(surface.pureTension.pn), 10)} kN`,
    `        중립축 분할   : theta ${surface.thetas.length} 방향 x c ${surface.meridians[0]?.length ?? 0} 단계`,
    ...(usesAxialCutoff
      ? [
          "",
          "       [우발편심 처리] 강도설계법 -> 축력 cutoff",
          `        축력 상한계수 : alpha   = ${fmt(surface.axialLimitFactor)} (${column.tieType})`,
          `        설계 축력상한 : alpha*phi*Pn0 = ${pad(fmt(surface.axialCap), 10)} kN  <- 곡면 상단을 이 평면으로 절단`,
          "        ※ ACI 318-02 이후 최소편심 조항을 축력 상한으로 대체하였으므로",
          "           최소모멘트를 별도로 중복 적용하지 않는다.",
        ]
      : [
          "",
          "       [우발편심 처리] 한계상태설계법 -> 최소모멘트 검토",
          "        e0 = max(h/30, 20mm) 로 작용모멘트를 축별 하한 처리한다 (EC2 6.1(4)).",
          "        h 는 그 모멘트가 도는 방향의 단면 치수다 (Mux <-> y방향 깊이, Muy <-> x방향 폭).",
          "        입력 케이스는 그대로 두고, 하한이 지배하면 최소편심 케이스를 **추가**해 둘 다 검토한다.",
          "        강도곡면 자체는 수정하지 않으며, 재료계수만 반영한 순수 단면저항을 나타낸다.",
        ]),
    "",
    "    6) 하중케이스별 검토",
    "",
    ...(demandSections.length > 0 ? demandSections : ["       입력된 Load Case 가 없습니다."]),
    "",
    "[산출식]",
    "- 중립축 법선 n = (cos θ, sin θ) 를 압축측으로 두고, s = x·nx + y·ny 를 법선방향 좌표로 한다.",
    "- 최압축 연단 sMax 로부터 깊이 c 를 잡아 변형률 ε(x,y) = ecu · (s - (sMax - c)) / c 를 준다.",
    "- 압축영역은 링별로 반평면 { s >= sMax - beta1·c } 절단 후 부호면적 합산으로 구한다.",
    "  (외곽 링 CCW(+), 중공 링 CW(-) -> (외곽 ∩ HP) \\ (중공 ∩ HP) 가 자동 성립)",
    "- 콘크리트 압축력 Cc = (0.85·eta)·fcd·Ac,comp / 1000  [kN]",
    "- 철근 응력 fs = clamp(Es·es, -fyd, +fyd), 압축측 철근은 콘크리트 치환 공제 (fs - 0.85·eta·fcd)",
    "- Pn = Cc + Σ Fs,  Mnx = Σ F·(y - y_pc)/1000,  Mny = Σ F·(x - x_pc)/1000   [kN-m]",
    "- 모멘트 기준점은 **소성중심** (x_pc, y_pc) 이다 (KDS 14 20 20).",
    "- 편심벡터 방향 α_e = atan2(Mnx, Mny). 일반 단면에서 α_e ≠ θ 이며, 이 차이가 2축 효과다.",
    "- 검토는 α_e(θ,c) = α_e,수요 이고 P(θ,c) = Pu 인 (θ, c) 를 찾는 2중 반복(역해석)이다.",
    "- 사용률 = |Mu| / |φMn| (동일 축력, 동일 편심 방향에서의 곡면 교점 기준)",
    "",
    "[주의]",
    "- 편심 방향으로 단면을 회전시켜 1축 계산하는 방법은 α_e ≠ θ 이므로 틀린다.",
    "- 설계곡면은 φ 가 변하므로 볼록하지 않을 수 있다. 판정은 곡면과의 실제 교점으로만 한다.",
  ].join("\n");
}

function buildDemandReview(index: number, demand: DemandInput, input: ReportInput): string {
  const { surface, materials, column } = input;
  const result = checkDemand(surface, materials, column, demand, true);
  const d = result.demand;
  const capacity = result.capacity;
  const usesAxialCutoff = surface.code.designBasis === "strength_reduction";
  const ey = materials.steel.fy / materials.steel.es;

  const lines: string[] = [
    `       (${index}) ${demand.label}`,
    "",
    "          ① 작용하중",
    "",
    `            계수축하중    : Pu     = ${pad(fmt(demand.pu), 12)} kN`,
    `            계수모멘트(X) : Mux    = ${pad(fmt(demand.muxNs + demand.muxS), 12)} kN-m   (ns=${fmt(demand.muxNs)}, s=${fmt(demand.muxS)})`,
    `            계수모멘트(Y) : Muy    = ${pad(fmt(demand.muyNs + demand.muyS), 12)} kN-m   (ns=${fmt(demand.muyNs)}, s=${fmt(demand.muyS)})`,
    "",
    "          ② 장주효과",
    "",
    `            세장비        : lambda_x = ${pad(fmt(d.lambdaX), 8)},  lambda_y = ${pad(fmt(d.lambdaY), 8)}`,
    `            임계좌굴하중  : Pc_x = ${pad(fmt(d.pcx), 10)} kN,  Pc_y = ${pad(fmt(d.pcy), 10)} kN`,
    `            지속하중비    : beta_dx = ${fmt(demand.betaDx ?? 0)},  beta_dy = ${fmt(demand.betaDy ?? 0)}`,
    `            확대계수      : delta_x = ${pad(fmt(d.deltaX), 8)},  delta_y = ${pad(fmt(d.deltaY), 8)}`,
    `            확대 후       : Mux* = ${pad(fmt(d.muxMagnified), 10)} kN-m,  Muy* = ${pad(fmt(d.muyMagnified), 10)} kN-m`,
    "",
    "          ③ 우발편심 처리",
    "",
  ];

  if (usesAxialCutoff) {
    lines.push(
      "            강도설계법 -> 축력 cutoff 로 처리한다 (최소모멘트 미적용).",
      `            설계 축력상한 : alpha*phi*Pn0 = ${pad(fmt(surface.axialCap), 10)} kN`,
      `            Pu = ${fmt(demand.pu)} kN ${demand.pu <= surface.axialCap ? "<=" : ">"} 상한  ->  ${demand.pu <= surface.axialCap ? "O.K" : "N.G (축력 상한 초과)"}`,
    );
  } else {
    const mark = (governs: boolean) => (governs ? "[지배]" : "[여유]");
    lines.push(
      "            한계상태설계법 -> 축별 최소모멘트 M >= Pu*e0 을 검토한다.",
      `            e0y (Mux 짝) = ${fmt(d.e0y ?? 0)} mm  ->  Mmin,x = ${fmt(d.minMomentX)} kN-m  ${mark(d.minMomentGovernsX)}`,
      `            e0x (Muy 짝) = ${fmt(d.e0x ?? 0)} mm  ->  Mmin,y = ${fmt(d.minMomentY)} kN-m  ${mark(d.minMomentGovernsY)}`,
    );

    if (d.appliesMinMoment) {
      lines.push(
        `            이 케이스는 ${demand.minEccentricityOf} 의 최소편심 파생 케이스다 -> 하한을 적용한다.`,
        `            검토 모멘트   : Mux,chk = ${pad(fmt(d.mux), 10)} kN-m,  Muy,chk = ${pad(fmt(d.muy), 10)} kN-m`,
      );
      const rotation = radToDeg(d.alphaE - d.alphaEBeforeMinMoment);
      if (Math.abs(rotation) > 1e-6) {
        lines.push(
          `            ※ 하한 처리로 편심 방향이 ${fmt(radToDeg(d.alphaEBeforeMinMoment))} deg -> ${fmt(radToDeg(d.alphaE))} deg 로 ${fmt(Math.abs(rotation))} deg 회전하였다.`,
          "               (α_e 는 반드시 하한 처리 후에 산정해야 한다)",
        );
      }
    } else if (d.minMomentGovernsX || d.minMomentGovernsY) {
      lines.push(
        "            원 케이스는 입력 모멘트 그대로 검토하고, 하한이 지배하는 축은",
        `            별도의 최소편심 케이스(${demand.id}${MIN_ECCENTRICITY_ID_SUFFIX})로 추가해 함께 검토한다.`,
        `            검토 모멘트   : Mux,chk = ${pad(fmt(d.mux), 10)} kN-m,  Muy,chk = ${pad(fmt(d.muy), 10)} kN-m  (입력값)`,
      );
    } else {
      lines.push(
        "            두 축 모두 작용모멘트가 최소모멘트보다 크다 -> 파생 케이스 없음.",
        `            검토 모멘트   : Mux,chk = ${pad(fmt(d.mux), 10)} kN-m,  Muy,chk = ${pad(fmt(d.muy), 10)} kN-m`,
      );
    }
  }

  lines.push(
    "",
    "          ④ 편심",
    "",
    `            e_x = Muy/Pu = ${pad(fmt(d.ex), 10)} mm`,
    `            e_y = Mux/Pu = ${pad(fmt(d.ey), 10)} mm`,
    `            |e|          = ${pad(fmt(Math.hypot(d.ex, d.ey)), 10)} mm`,
    `            편심 방향    : alpha_e = ${fmt(radToDeg(d.alphaE))} deg`,
    "",
    "          ⑤ 중립축 해 (역해석)",
    "",
  );

  if (!capacity) {
    lines.push(
      `            해를 찾지 못했습니다. (${result.status})`,
      `            ${result.message ?? ""}`,
      "",
      `                   ∴ 판정 : N.G`,
    );
    return lines.join("\n");
  }

  const thetaDeg = radToDeg(capacity.theta);
  const alphaDeg = radToDeg(capacity.alphaE);
  const gap = Math.abs(signedDeg(thetaDeg - alphaDeg));
  const parts = capacity.response;

  lines.push(
    `            중립축 각도  : theta   = ${pad(fmt(thetaDeg), 10)} deg`,
    `            중립축 깊이  : c       = ${pad(fmt(capacity.c), 10)} mm  (h_theta = ${fmt(parts.neutralAxis.depth)} mm)`,
    `            등가블록깊이 : a = beta1*c = ${pad(fmt(parts.neutralAxis.a), 10)} mm`,
    `            도달 편심방향: alpha_e = ${pad(fmt(alphaDeg), 10)} deg   (목표 ${fmt(radToDeg(d.alphaE))} deg)`,
    `            ★ theta 와 alpha_e 의 차이 = ${fmt(gap)} deg  <- 2축 효과의 크기`,
    `            반복 횟수    : ${capacity.iterations}`,
    "",
    "          ⑥ 단면력 분해",
    "",
    `            Cc  = ${pad(fmt(parts.concrete.force), 10)} kN     (압축면적 ${sci(parts.concrete.area)} mm2)`,
    `            Cs  = ${pad(fmt(parts.steel.compressionForce), 10)} kN`,
    `            Tt  = ${pad(fmt(parts.steel.tensionForce), 10)} kN`,
    `            Pn  = Cc + Cs + Tt = ${fmt(parts.pn)} kN`,
    "",
    `            Mcx = ${pad(fmt(parts.concrete.mx), 10)},  Msx = ${pad(fmt(parts.steel.compressionMx), 10)},  Mtx = ${pad(fmt(parts.steel.tensionMx), 10)} kN-m`,
    `            Mcy = ${pad(fmt(parts.concrete.my), 10)},  Msy = ${pad(fmt(parts.steel.compressionMy), 10)},  Mty = ${pad(fmt(parts.steel.tensionMy), 10)} kN-m`,
    `            Mnx = ${pad(fmt(parts.mnx), 10)} kN-m,  Mny = ${pad(fmt(parts.mny), 10)} kN-m`,
    "",
    "          ⑦ 변형률 및 지배단면",
    "",
    `            최외단 인장철근 : ${extremeBarLabel(parts)}`,
    `            순인장변형률    : epsilon_t = ${strain(capacity.maxTensileStrain)}`,
    `            항복변형률      : epsilon_y = ${strain(ey)}`,
    `            판정            : epsilon_t ${capacity.maxTensileStrain <= ey ? "<=" : ">"} epsilon_y  ->  ${capacity.maxTensileStrain <= ey ? "압축지배단면" : capacity.maxTensileStrain >= 0.005 ? "인장지배단면" : "전이단면"}`,
    "",
    "          ⑧ 설계강도",
    "",
    `            강도감소계수 : phi = ${fmt(capacity.phi)}`,
    `            phi Pn  = ${pad(fmt(capacity.pd), 10)} kN${capacity.cappedByAxialLimit ? "   [축력 상한 적용]" : ""}`,
    `            phi Mnx = ${pad(fmt(capacity.mdx), 10)} kN-m`,
    `            phi Mny = ${pad(fmt(capacity.mdy), 10)} kN-m`,
    `            |phi Mn| = ${pad(fmt(capacity.md), 10)} kN-m`,
    "",
    "          ⑨ 판정",
    "",
    `            작용 모멘트 |Mu|  = ${pad(fmt(d.mu), 10)} kN-m`,
    `            설계 강도  |phiMn| = ${pad(fmt(capacity.md), 10)} kN-m`,
    `            사 용 률          = ${pad(fmt(result.ratio * 100), 10)} %`,
    `                   ∴ 판정 : ${result.ok ? "O.K" : "N.G"}${result.message ? `  (${result.message})` : ""}`,
  );

  if (input.showSimplified) {
    lines.push("", "          ⑩ 간이법 대조 (참고용, 판정 근거 아님)", "");
    const bresler = breslerReciprocal(surface, d.mux, d.muy, true);
    if (bresler) {
      lines.push(
        `            Bresler 역수법 : 1/Pn = 1/Pnx + 1/Pny - 1/P0`,
        `              Pnx = ${fmt(bresler.pnx)} kN,  Pny = ${fmt(bresler.pny)} kN,  P0 = ${fmt(bresler.p0)} kN`,
        `              -> Pn = ${fmt(bresler.pn)} kN  vs  Pu = ${fmt(demand.pu)} kN  ${bresler.pn >= demand.pu ? "O.K" : "N.G"}`,
        `              적용구간(Pn >= 0.1 fck Ag) : ${bresler.applicable ? "유효" : "범위 밖 — 신뢰 불가"}`,
      );
    } else {
      lines.push("            Bresler 역수법 : 산정 불가 (모멘트 0 또는 곡면 밖)");
    }

    const ec2 = ec2BiaxialCheck(surface, demand.pu, d.mux, d.muy, { useDesign: true });
    if (ec2) {
      lines.push(
        "",
        `            EC2 5.8.9 지수법 : (Mx/Mrx)^a + (My/Mry)^a <= 1`,
        `              NEd/NRd = ${fmt(ec2.axialRatio)}  ->  a = ${fmt(ec2.exponent)}`,
        `              MRdx = ${fmt(ec2.mrdx)} kN-m,  MRdy = ${fmt(ec2.mrdy)} kN-m`,
        `              -> 사용률 = ${fmt(ec2.utilisation)}  ${ec2.ok ? "O.K" : "N.G"}`,
        "              ※ 저축력에서 a -> 1.0 은 직선 상관식이라 볼록한 실제 곡면보다 보수적이다.",
      );
    }
  }

  return lines.join("\n");
}

function extremeBarLabel(parts: SectionResponse): string {
  let worst = parts.bars[0];
  for (const bar of parts.bars) {
    if (bar.strain < (worst?.strain ?? 0)) worst = bar;
  }
  if (!worst) return "-";
  return `${worst.id} (x=${fmt(worst.x)}, y=${fmt(worst.y)}, D${fmt(Math.sqrt((4 * worst.area) / Math.PI))})`;
}

function summarizeBarGroups(rebars: Rebar[], box: ReturnType<typeof outerBounds>) {
  const groups = new Map<string, { diameter: number; count: number; area: number; dc: number }>();
  for (const bar of rebars) {
    const dc = Math.round(
      Math.min(
        Math.abs(bar.x - box.minX),
        Math.abs(box.maxX - bar.x),
        Math.abs(bar.y - box.minY),
        Math.abs(box.maxY - bar.y),
      ),
    );
    const key = `${bar.diameter}-${dc}`;
    const current = groups.get(key) ?? { diameter: bar.diameter, count: 0, area: 0, dc };
    current.count += 1;
    current.area += rebarArea(bar.diameter);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.dc - b.dc);
}

/** 그래프/요약에 쓰는 최대 설계 휨강도 (모든 방향 중 최대). */
export function maxDesignMoment(surface: InteractionSurface): number {
  let best = 0;
  for (const meridian of surface.meridians) {
    for (const point of meridian) best = Math.max(best, point.md);
  }
  return best;
}

export function balancedPoint(surface: InteractionSurface, theta: number) {
  const meridian = surface.meridians.reduce((best, m) =>
    Math.abs(m[0].theta - theta) < Math.abs(best[0].theta - theta) ? m : best,
  );
  const yieldStrain = surface.materials.steel.fy / surface.materials.steel.es;
  return meridian.reduce((best, point) =>
    Math.abs(point.maxTensileStrain - yieldStrain) < Math.abs(best.maxTensileStrain - yieldStrain) ? point : best,
  );
}

export { capacityAt };

// ---------------------------------------------------------------------------
// 포맷
// ---------------------------------------------------------------------------

export function fmt(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

export function sci(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toExponential(3);
}

export function strain(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(5);
}

export function pad(value: string, width: number): string {
  return value.padStart(width, " ");
}

export function radToDeg(value: number): number {
  return (value * 180) / Math.PI;
}

function signedDeg(value: number): number {
  let d = value;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}
