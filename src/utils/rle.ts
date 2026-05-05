/**
 * Run-length encode a Uint8Array. Output: alternating [value, runLength]
 * pairs as a flat number[]. Most simulation snapshots are mostly
 * Unburned (value 0) so RLE compresses ~50–100×.
 */
export function rleEncode(arr: Uint8Array): number[] {
  const out: number[] = [];
  if (arr.length === 0) return out;
  let cur = arr[0];
  let run = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur) {
      run++;
    } else {
      out.push(cur, run);
      cur = arr[i];
      run = 1;
    }
  }
  out.push(cur, run);
  return out;
}

export function rleDecode(rle: number[], expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let pos = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const value = rle[i];
    const run = rle[i + 1];
    for (let j = 0; j < run; j++) out[pos + j] = value;
    pos += run;
  }
  return out;
}
