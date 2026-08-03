import { describe, expect, it } from "vitest";
import { generateCircleRebars, generateRectangleRebars } from "../rebarLayout";
import { rebarArea } from "../geometry";

describe("배근 생성기", () => {
  it("사각형 한 겹은 모서리 중복을 제거한다", () => {
    // 각 변 10개(끝점 포함) x 4변 = 40, 모서리 4개 중복 제거 -> 36
    const bars = generateRectangleRebars(1100, 1100, [
      { id: "L1", dc: 90, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
    ]);
    expect(bars).toHaveLength(36);
  });

  it("B5-I 2겹 배근은 72본이다", () => {
    const bars = generateRectangleRebars(1100, 1100, [
      { id: "L1", dc: 90, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
      { id: "L2", dc: 120, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
    ]);
    expect(bars).toHaveLength(72);
    expect(bars.map((b) => b.id)).toEqual(bars.map((_, i) => `R${i + 1}`));
    // 1겹은 dc=90 -> 반폭 550-90 = 460
    expect(Math.max(...bars.map((b) => Math.abs(b.x)))).toBeCloseTo(460, 9);
  });

  it("원형 배근은 피복과 철근 반경을 뺀 반경 위에 놓인다", () => {
    const bars = generateCircleRebars(1000, { cover: 50, diameter: 25, count: 12 });
    expect(bars).toHaveLength(12);
    const expectedRadius = 1000 / 2 - 50 - 25 / 2;
    for (const bar of bars) {
      expect(Math.hypot(bar.x, bar.y)).toBeCloseTo(expectedRadius, 2);
    }
  });

  it("공칭 단면적표가 적용된다", () => {
    expect(rebarArea(32)).toBe(794.2);
    expect(rebarArea(25)).toBe(506.7);
  });
});
