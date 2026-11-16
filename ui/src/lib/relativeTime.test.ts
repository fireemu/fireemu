import { expect, test } from "vitest";
import { relativeTime, secondsBetween } from "./relativeTime";

const NOW = "2026-08-29T12:00:00Z";
const at = (seconds: number) => new Date(Date.parse(NOW) + seconds * 1000).toISOString();

test.each([
  [0, "just now"],
  [-4.999, "just now"],
  [4.999, "just now"],
  [-5, "5s ago"],
  [5, "in 5s"],
  [-59.9, "59s ago"],
  [-60, "1 min ago"],
  [-119, "1 min ago"],
  [-120, "2 min ago"],
  [-3599, "59 min ago"],
  [-3600, "1 h ago"],
  [3600, "in 1 h"],
  [-86_399, "23 h ago"],
  [-86_400, "1 d ago"],
  [-364 * 86_400 - 86_399, "364 d ago"],
  [-365 * 86_400, "1 y ago"],
  [-800 * 86_400, "2 y ago"],
  [240, "in 4 min"],
])("%d s from now reads %s", (seconds, text) => {
  expect(relativeTime(at(seconds), NOW)).toBe(text);
});

test("nanosecond timestamps and offsets are read as instants", () => {
  expect(relativeTime("2026-08-29T11:59:00.123456789Z", NOW)).toBe("59s ago");
  expect(relativeTime("2026-08-29T21:00:00+09:00", NOW)).toBe("just now");
  expect(secondsBetween("2026-08-29T12:00:01.500Z", NOW)).toBe(1.5);
});

test("an unparsable instant or clock gives nothing rather than a wrong distance", () => {
  for (const bad of ["", "not a time", "2026-13-40T00:00:00Z"]) {
    expect(relativeTime(bad, NOW)).toBeNull();
    expect(relativeTime(NOW, bad)).toBeNull();
    expect(secondsBetween(bad, NOW)).toBeNull();
    expect(secondsBetween(NOW, bad)).toBeNull();
  }
});

test("past and future mirror each other and the amount never rounds up", () => {
  let seed = 11;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let round = 0; round < 500; round += 1) {
    const seconds = 5 + (next() % (3 * 365 * 86_400));
    const past = relativeTime(at(-seconds), NOW)!;
    const future = relativeTime(at(seconds), NOW)!;
    expect(past.endsWith(" ago")).toBe(true);
    expect(future).toBe(`in ${past.slice(0, -" ago".length)}`);
    const match = /^(\d+)( ?)(s|min|h|d|y) ago$/.exec(past)!;
    const size = { s: 1, min: 60, h: 3600, d: 86_400, y: 365 * 86_400 }[match[3] as "s"];
    const amount = Number(match[1]);
    expect(amount).toBeGreaterThanOrEqual(1);
    expect(amount * size).toBeLessThanOrEqual(seconds);
    expect((amount + 1) * size).toBeGreaterThan(seconds);
    expect(match[2]).toBe(match[3] === "s" ? "" : " ");
  }
});
