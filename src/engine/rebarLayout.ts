import type { Point, Rebar } from "./types";

/** 사각형 단면의 한 겹(레이어) 배근 사양. dc = 단면 외곽에서 철근 중심까지의 거리. */
export interface RectRebarLayer {
  id: string;
  dc: number;
  diameter: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CircleRebarSpec {
  cover: number;
  diameter: number;
  count: number;
}

export function generateRectangleRebars(
  width: number,
  height: number,
  layers: RectRebarLayer[],
): Rebar[] {
  const bars: Rebar[] = [];
  for (const layer of layers) {
    const xMin = -width / 2 + layer.dc;
    const xMax = width / 2 - layer.dc;
    const yMin = -height / 2 + layer.dc;
    const yMax = height / 2 - layer.dc;
    const layerBars: Rebar[] = [];

    addSideBars(layerBars, { x: xMin, y: yMax }, { x: xMax, y: yMax }, layer.top, layer.diameter);
    addSideBars(layerBars, { x: xMax, y: yMax }, { x: xMax, y: yMin }, layer.right, layer.diameter);
    addSideBars(layerBars, { x: xMax, y: yMin }, { x: xMin, y: yMin }, layer.bottom, layer.diameter);
    addSideBars(layerBars, { x: xMin, y: yMin }, { x: xMin, y: yMax }, layer.left, layer.diameter);
    bars.push(...dedupeRebars(layerBars));
  }

  return bars.map((bar, index) => ({ ...bar, id: `R${index + 1}` }));
}

export function generateCircleRebars(diameter: number, spec: CircleRebarSpec): Rebar[] {
  const count = Math.max(1, Math.round(spec.count));
  const radius = Math.max(0, diameter / 2 - spec.cover - spec.diameter / 2);
  return Array.from({ length: count }, (_, index) => {
    const angle = Math.PI / 2 - (Math.PI * 2 * index) / count;
    return {
      id: `R${index + 1}`,
      x: round(Math.cos(angle) * radius),
      y: round(Math.sin(angle) * radius),
      diameter: spec.diameter,
    };
  });
}

/**
 * 중공 사각형 단면의 벽체 배근. 외측/내측 두 겹을 각각 생성한다.
 * 교각 실무에서 일반적인 배치 형태.
 */
export function generateHollowRectangleRebars(
  width: number,
  height: number,
  wallThickness: number,
  spec: { outerDc: number; innerDc: number; diameter: number; nx: number; ny: number },
): Rebar[] {
  const outer = generateRectangleRebars(width, height, [
    {
      id: "outer",
      dc: spec.outerDc,
      diameter: spec.diameter,
      top: spec.nx,
      bottom: spec.nx,
      left: spec.ny,
      right: spec.ny,
    },
  ]);
  const innerWidth = Math.max(0, width - 2 * wallThickness);
  const innerHeight = Math.max(0, height - 2 * wallThickness);
  const inner =
    innerWidth > 0 && innerHeight > 0
      ? generateRectangleRebars(innerWidth, innerHeight, [
          {
            id: "inner",
            dc: spec.innerDc,
            diameter: spec.diameter,
            top: spec.nx,
            bottom: spec.nx,
            left: spec.ny,
            right: spec.ny,
          },
        ])
      : [];

  return [...outer, ...inner].map((bar, index) => ({ ...bar, id: `R${index + 1}` }));
}

/** 중공 원형 단면의 벽체 배근. 외측/내측 두 겹. */
export function generateHollowCircleRebars(
  outerDiameter: number,
  innerDiameter: number,
  spec: { cover: number; diameter: number; outerCount: number; innerCount: number },
): Rebar[] {
  const outer = generateCircleRebars(outerDiameter, {
    cover: spec.cover,
    diameter: spec.diameter,
    count: spec.outerCount,
  });
  const innerRadius = innerDiameter / 2 + spec.cover + spec.diameter / 2;
  const innerCount = Math.max(0, Math.round(spec.innerCount));
  const inner = Array.from({ length: innerCount }, (_, index) => {
    const angle = Math.PI / 2 - (Math.PI * 2 * index) / innerCount;
    return {
      id: "",
      x: round(Math.cos(angle) * innerRadius),
      y: round(Math.sin(angle) * innerRadius),
      diameter: spec.diameter,
    };
  });

  return [...outer, ...inner].map((bar, index) => ({ ...bar, id: `R${index + 1}` }));
}

function addSideBars(bars: Rebar[], start: Point, end: Point, countValue: number, diameter: number) {
  const count = Math.max(0, Math.round(countValue));
  if (count === 0) return;
  if (count === 1) {
    bars.push({ id: "", x: round((start.x + end.x) / 2), y: round((start.y + end.y) / 2), diameter });
    return;
  }

  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    bars.push({
      id: "",
      x: round(start.x + (end.x - start.x) * t),
      y: round(start.y + (end.y - start.y) * t),
      diameter,
    });
  }
}

function dedupeRebars(bars: Rebar[]): Rebar[] {
  const unique: Rebar[] = [];
  for (const bar of bars) {
    const exists = unique.some((item) => Math.hypot(item.x - bar.x, item.y - bar.y) < 1e-6);
    if (!exists) unique.push(bar);
  }
  return unique;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
