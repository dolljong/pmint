import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rectangleRings } from "../engine/geometry";
import { generateRectangleRebars } from "../engine/rebarLayout";
import { computeSurface } from "../engine/surface";
import { buildReport, type ReportColumn } from "../report";
import { loadOrWriteGolden } from "../engine/__tests__/golden";
import type { DemandInput } from "../engine/demand";
import type { DesignCodeId, MaterialSet, SectionModel } from "../engine/types";

const GOLDEN_PATH = fileURLToPath(new URL("./fixtures/report-golden.json", import.meta.url));

const materials: MaterialSet = {
  concrete: { fc: 30, ecu: 0.0033 },
  steel: { fy: 400, es: 200000 },
};

const solid: SectionModel = {
  rings: rectangleRings(600, 900),
  rebars: generateRectangleRebars(600, 900, [
    { id: "L1", dc: 60, diameter: 25, top: 4, right: 5, bottom: 4, left: 5 },
  ]),
};

const hollow: SectionModel = {
  rings: rectangleRings(3000, 4000, 400),
  rebars: generateRectangleRebars(3000, 4000, [
    { id: "L1", dc: 100, diameter: 32, top: 8, right: 10, bottom: 8, left: 10 },
  ]),
};

const column: ReportColumn = { title: "테스트 기둥", cover: 60, lu: 4000, kx: 1, ky: 1, tieType: "띠 철근" };

const biaxialDemand: DemandInput = {
  id: "D1",
  label: "LC-2축",
  pu: 3000,
  muxNs: 700,
  muxS: 0,
  muyNs: 400,
  muyS: 0,
  betaDx: 0,
  betaDy: 0,
};

function report(section: SectionModel, designCode: DesignCodeId, demands: DemandInput[], showSimplified = false) {
  const surface = computeSurface(section, materials, { designCode, thetaSteps: 72, cSteps: 60 })!;
  return buildReport({
    surface,
    materials,
    column,
    demands,
    rings: section.rings,
    rebars: section.rebars,
    showSimplified,
  });
}

describe("보고서", () => {
  const strength = report(solid, "kds_strength", [biaxialDemand]);
  const lsd = report(solid, "bridge_lsd", [biaxialDemand]);

  it("2축 항목이 모두 포함된다", () => {
    for (const heading of [
      "① 작용하중",
      "② 장주효과",
      "③ 우발편심 처리",
      "④ 편심",
      "⑤ 중립축 해",
      "⑥ 단면력 분해",
      "⑦ 변형률 및 지배단면",
      "⑧ 설계강도",
      "⑨ 판정",
    ]) {
      expect(strength, heading).toContain(heading);
    }
  });

  it("Mux / Muy 를 분리해 출력한다", () => {
    expect(strength).toMatch(/계수모멘트\(X\) : Mux/);
    expect(strength).toMatch(/계수모멘트\(Y\) : Muy/);
    expect(strength).toMatch(/phi Mnx/);
    expect(strength).toMatch(/phi Mny/);
  });

  it("★ theta 와 alpha_e 의 차이를 명시한다 (2축 효과의 크기)", () => {
    expect(strength).toContain("2축 효과의 크기");
    const match = strength.match(/theta 와 alpha_e 의 차이 = ([\d.]+) deg/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(1);
  });

  it("소성중심과 기하도심을 함께 출력한다", () => {
    expect(strength).toContain("소 성 중 심");
    expect(strength).toContain("기하 도심");
    expect(strength).toContain("도심-소성중심 차");
  });

  it("링 구성과 순 단면적을 출력한다", () => {
    const hollowReport = report(hollow, "bridge_lsd", [{ ...biaxialDemand, pu: 20000, muxNs: 9000, muyNs: 6000 }]);
    expect(hollowReport).toContain("단면 링 구성");
    expect(hollowReport).toMatch(/O1 \(외곽\)/);
    expect(hollowReport).toMatch(/H1 \(중공\)/);
    expect(hollowReport).toContain("순 단면적 Ac");
  });

  it("강도설계법은 축력 cutoff 분기를 쓴다", () => {
    expect(strength).toContain("강도설계법 -> 축력 cutoff");
    expect(strength).toContain("최소모멘트를 별도로 중복 적용하지 않는다");
    expect(strength).not.toContain("최소모멘트로 하한 처리");
  });

  it("한계상태설계법은 최소모멘트 분기를 쓴다", () => {
    expect(lsd).toContain("최소모멘트 검토");
    expect(lsd).toContain("e0 = max(h/30, 20mm)");
    expect(lsd).not.toContain("축력 cutoff");
  });

  it("최소모멘트가 편심 방향을 회전시키면 그 사실을 기록한다", () => {
    const oneAxis = report(solid, "bridge_lsd", [
      { id: "D1", label: "1축", pu: 4000, muxNs: 1500, muxS: 0, muyNs: 0, muyS: 0 },
    ]);
    expect(oneAxis).toContain("편심 방향이");
    expect(oneAxis).toContain("회전하였다");
    expect(oneAxis).toContain("반드시 하한 처리 후에 산정");
  });

  it("★ 최소편심이 지배하면 파생 케이스를 추가로 검토한다", () => {
    // Muy = 0 -> e0x 하한(20mm)에 걸린다. 원 케이스 + 파생 케이스 2건이 나와야 한다.
    const withDerived = report(solid, "bridge_lsd", [
      { id: "D1", label: "1축", pu: 4000, muxNs: 1500, muxS: 0, muyNs: 0, muyS: 0 },
    ]);
    expect(withDerived).toContain("(1) 1축");
    expect(withDerived).toContain("(2) 1축 (최소편심)");
    expect(withDerived).toContain("D1 의 최소편심 파생 케이스");
    expect(withDerived).toContain("별도의 최소편심 케이스(D1-e0)");
  });

  it("원 케이스의 검토 모멘트는 입력값 그대로다 (덮어쓰지 않는다)", () => {
    const withDerived = report(solid, "bridge_lsd", [
      { id: "D1", label: "1축", pu: 4000, muxNs: 1500, muxS: 0, muyNs: 0, muyS: 0 },
    ]);
    // 원 케이스 절에는 Muy,chk 가 0 인 "(입력값)" 줄이 있어야 한다.
    expect(withDerived).toMatch(/Muy,chk = +0\.00 +kN-m +\(입력값\)/);
  });

  it("두 축 모두 여유가 있으면 파생 케이스를 만들지 않는다", () => {
    const noDerived = report(solid, "bridge_lsd", [
      { id: "D1", label: "여유", pu: 1000, muxNs: 900, muxS: 0, muyNs: 700, muyS: 0 },
    ]);
    expect(noDerived).toContain("파생 케이스 없음");
    expect(noDerived).not.toContain("(최소편심)");
  });

  it("강도설계법은 최소편심 파생 케이스를 만들지 않는다", () => {
    const strengthOneAxis = report(solid, "kds_strength", [
      { id: "D1", label: "1축", pu: 4000, muxNs: 1500, muxS: 0, muyNs: 0, muyS: 0 },
    ]);
    expect(strengthOneAxis).not.toContain("(최소편심)");
    expect(strengthOneAxis).toContain("최소모멘트를 별도로 중복 적용하지 않는다");
  });

  it("간이법 대조는 옵션일 때만 나온다", () => {
    expect(strength).not.toContain("Bresler 역수법");
    const withSimplified = report(solid, "kds_strength", [biaxialDemand], true);
    expect(withSimplified).toContain("⑩ 간이법 대조");
    expect(withSimplified).toContain("Bresler 역수법");
    expect(withSimplified).toContain("EC2 5.8.9 지수법");
  });

  it("2축 함정을 경고문으로 남긴다", () => {
    expect(strength).toContain("편심 방향으로 단면을 회전시켜 1축 계산하는 방법은");
  });

  it("골든 스냅샷과 일치한다", () => {
    const actual = {
      "kds_strength": strength.split("\n"),
      "bridge_lsd": lsd.split("\n"),
    };
    const expected = loadOrWriteGolden<typeof actual>(GOLDEN_PATH, actual);
    expect(actual["kds_strength"]).toEqual(expected["kds_strength"]);
    expect(actual["bridge_lsd"]).toEqual(expected["bridge_lsd"]);
  });
});
