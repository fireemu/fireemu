import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { ariaBool } from "./aria";

describe("ariaBool", () => {
  it("maps booleans to the ARIA tokens", () => {
    expect(ariaBool(true)).toBe("true");
    expect(ariaBool(false)).toBe("false");
  });

  it("keeps a false state on the element instead of removing the attribute", () => {
    const { getByRole } = render(() => (
      <button type="button" aria-expanded={ariaBool(false)} aria-pressed={ariaBool(true)}>
        x
      </button>
    ));
    expect(getByRole("button").getAttribute("aria-expanded")).toBe("false");
    expect(getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});
