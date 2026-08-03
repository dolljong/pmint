import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect } from "vitest";

/**
 * 골든 스냅샷 헬퍼.
 *
 * 갱신: Git Bash 에서 `UPDATE_GOLDEN=1 npx vitest run` 실행 시 기대값 파일을 덮어쓴다.
 * 갱신 시에는 반드시 diff 를 눈으로 확인하고 변경 사유를 커밋 메시지에 남긴다.
 *
 * JSON 은 Infinity/NaN 을 표현하지 못하므로(기본 직렬화 시 null 이 된다)
 * 문자열 센티널로 저장하고 읽을 때 되돌린다. 순압축점의 c = Infinity 가 여기 해당한다.
 */
export const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === "1";

export type GoldenNumber = number | string;

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function toNumber(value: GoldenNumber | undefined): number {
  if (typeof value === "string") return Number(value);
  return value as number;
}

export function loadOrWriteGolden<T>(path: string, actual: T): T {
  if (UPDATE_GOLDEN) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(actual, replacer, 2)}\n`, "utf8");
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    throw new Error(
      `골든 파일이 없거나 읽을 수 없습니다: ${path}\n` +
        `최초 생성은 'UPDATE_GOLDEN=1 npx vitest run' 로 수행하세요.`,
    );
  }
}

/**
 * 상대오차 비교. 부동소수 합산 순서가 바뀌어도(리팩터링) 통과하되
 * 실제 계산 변경은 잡아내는 수준으로 tol 을 잡는다.
 */
export function expectClose(
  actualRaw: GoldenNumber,
  expectedRaw: GoldenNumber,
  label: string,
  tol = 1e-9,
): void {
  const actual = toNumber(actualRaw);
  const expected = toNumber(expectedRaw);

  if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
    if (!Object.is(actual, expected)) {
      expect(`${label}: ${actual}`).toBe(`${label}: ${expected}`);
    }
    return;
  }

  const scale = Math.max(1, Math.abs(expected));
  if (Math.abs(actual - expected) / scale > tol) {
    expect(`${label}: ${actual}`).toBe(`${label}: ${expected}`);
  }
}

export function expectCloseRecords(
  actual: Record<string, GoldenNumber>[],
  expected: Record<string, GoldenNumber>[],
  label: string,
  tol = 1e-9,
): void {
  expect(actual.length, `${label}: 점 개수`).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    for (const key of Object.keys(expected[i])) {
      expectClose(actual[i][key], expected[i][key], `${label}[${i}].${key}`, tol);
    }
  }
}
