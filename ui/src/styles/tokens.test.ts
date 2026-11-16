import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Vitest runs from the ui/ package root.
const tokens = readFileSync(resolve("src/styles/tokens.css"), "utf8");
const styles = readFileSync(resolve("src/styles.css"), "utf8");

/** The custom-property declarations of the first block that opens with `selector {`. */
const declarations = (css: string, selector: string): Map<string, string> => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `block ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  const out = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--fe-[\w-]+|color-scheme):\s*([^;]+);/g)) {
    out.set(name!, value!.trim());
  }
  return out;
};

it("the explicit dark theme and the OS dark preference declare the same values", () => {
  const explicit = declarations(tokens, ':root[data-theme="dark"]');
  const system = declarations(tokens, ':root:not([data-theme="light"]):not([data-theme="dark"])');
  expect(explicit.size).toBeGreaterThan(40);
  expect([...system.entries()].sort()).toEqual([...explicit.entries()].sort());
});

it("every token the dark theme overrides exists in the light defaults", () => {
  const light = declarations(tokens, ":root");
  for (const name of declarations(tokens, ':root[data-theme="dark"]').keys()) {
    expect(light.has(name), name).toBe(true);
  }
});

it("button hover and pressed fills apply only to enabled buttons", () => {
  for (const rule of [".btn", ".btn-primary", ".btn-danger"]) {
    const start = styles.indexOf(`  ${rule} {`);
    expect(start, rule).toBeGreaterThanOrEqual(0);
    const body = styles.slice(start, styles.indexOf("}", start));
    const states = body.match(/\S*(hover|active):\S+/g) ?? [];
    expect(states.length, rule).toBeGreaterThan(0);
    for (const utility of states) expect(utility, rule).toMatch(/^enabled:(hover|active):/);
  }
});
