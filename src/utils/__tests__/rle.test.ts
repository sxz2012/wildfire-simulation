import { describe, it, expect } from "vitest";
import { rleEncode, rleDecode } from "../rle";

describe("rle", () => {
  it("round-trips an empty array", () => {
    const a = new Uint8Array(0);
    expect(rleDecode(rleEncode(a), 0)).toEqual(a);
  });

  it("round-trips a uniform array", () => {
    const a = new Uint8Array(1000).fill(2);
    const encoded = rleEncode(a);
    expect(encoded).toEqual([2, 1000]);
    expect(rleDecode(encoded, 1000)).toEqual(a);
  });

  it("round-trips a varied array", () => {
    const a = new Uint8Array([0, 0, 0, 1, 1, 2, 0, 0]);
    expect(rleDecode(rleEncode(a), a.length)).toEqual(a);
  });
});
