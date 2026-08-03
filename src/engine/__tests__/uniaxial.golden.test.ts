import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computePM } from "../pm";
import { goldenCases } from "./fixtures/cases";
import { expectCloseRecords, loadOrWriteGolden } from "./golden";

const GOLDEN_PATH = fileURLToPath(new URL("./fixtures/uniaxial-golden.json", import.meta.url));

type Snapshot = Record<string, Record<string, number>[]>;

function snapshot(): Snapshot {
  const out: Snapshot = {};
  for (const testCase of goldenCases) {
    out[testCase.name] = computePM(testCase.section, testCase.materials, testCase.options).map((p) => ({
      c: p.c,
      neutralAxisY: p.neutralAxisY,
      pn: p.pn,
      mn: p.mn,
      phi: p.phi,
      pd: p.pd,
      md: p.md,
      maxSteelStrain: p.maxSteelStrain,
      minEccentricity: p.minEccentricity,
    }));
  }
  return out;
}

describe("1축 P-M 골든 스냅샷", () => {
  const actual = snapshot();
  const expected = loadOrWriteGolden<Snapshot>(GOLDEN_PATH, actual);

  it("케이스 목록이 일치한다", () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const testCase of goldenCases) {
    it(`${testCase.name} 결과가 골든과 일치한다`, () => {
      expectCloseRecords(actual[testCase.name], expected[testCase.name], testCase.name);
    });
  }
});
