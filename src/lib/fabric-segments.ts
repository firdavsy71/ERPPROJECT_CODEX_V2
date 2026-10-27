import Decimal from "decimal.js";

/** Physical coordinates, in metres from the beginning of the roll. */
export type FabricSegment = { start: string; end: string };
const n = (value: Decimal.Value) => new Decimal(value);
const fixed = (value: Decimal.Value) => n(value).toFixed(4);

/** Remove the requested usable quantity, preserving its physical coordinates. */
export function takeSegments(segments: FabricSegment[], quantity: string, fromEnd = false) {
  let left = n(quantity);
  if (left.lte(0)) throw new Error("Length must be greater than zero.");
  const available = segments.map((s) => ({ ...s }));
  const taken: FabricSegment[] = [];
  const indices = available.map((_, index) => index);
  if (fromEnd) indices.reverse();
  for (const index of indices) {
    if (left.isZero()) break;
    const segment = available[index];
    const amount = Decimal.min(left, n(segment.end).minus(segment.start));
    if (fromEnd) {
      const cut = n(segment.end).minus(amount);
      taken.push({ start: fixed(cut), end: fixed(segment.end) });
      segment.end = fixed(cut);
    } else {
      const cut = n(segment.start).add(amount);
      taken.push({ start: fixed(segment.start), end: fixed(cut) });
      segment.start = fixed(cut);
    }
    left = left.minus(amount);
  }
  if (!left.isZero()) throw new Error("The roll does not have enough usable length.");
  return { remaining: available.filter((s) => n(s.end).gt(s.start)), taken: taken.sort((a, b) => n(a.start).cmp(b.start)) };
}

/** Remove a damaged physical section only if every part is still usable. */
export function damageSegments(segments: FabricSegment[], start: string, end: string) {
  const a = n(start), b = n(end);
  if (a.isNegative() || b.lte(a)) throw new Error("Enter a valid damaged section.");
  const index = segments.findIndex((s) => n(s.start).lte(a) && n(s.end).gte(b));
  if (index < 0) throw new Error("The damaged section must be entirely within usable fabric.");
  const original = segments[index];
  const replacements: FabricSegment[] = [];
  if (n(original.start).lt(a)) replacements.push({ start: fixed(original.start), end: fixed(a) });
  if (b.lt(original.end)) replacements.push({ start: fixed(b), end: fixed(original.end) });
  return { remaining: [...segments.slice(0, index), ...replacements, ...segments.slice(index + 1)], taken: [{ start: fixed(a), end: fixed(b) }], quantity: b.minus(a).toFixed(4) };
}
