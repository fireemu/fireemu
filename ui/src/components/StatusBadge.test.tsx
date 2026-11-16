import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { ErrorBanner, Notice, StatusBadge, toneBadgeClass, type Tone } from "./common";

afterEach(cleanup);

const TONES: Tone[] = ["success", "warning", "danger", "info", "neutral", "paused"];

it("each tone draws its own shape, so no two states differ by colour alone", () => {
  const shapes = TONES.map((tone) => {
    const ui = render(() => (
      <StatusBadge tone={tone} testId="b">
        Label
      </StatusBadge>
    ));
    const badge = ui.getByTestId("b");
    expect(badge.textContent).toBe("Label");
    expect(badge.dataset.tone).toBe(tone);
    const svg = badge.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    const shape = svg!.innerHTML;
    cleanup();
    return shape;
  });
  expect(new Set(shapes).size).toBe(TONES.length);
});

it("a frozen clock reads as information, queued or cancelled as neutral", () => {
  expect(toneBadgeClass("paused")).toBe("badge badge-info");
  expect(toneBadgeClass("neutral")).toBe("badge badge-neutral");
  expect(toneBadgeClass("danger")).toBe("badge badge-danger");
  expect(toneBadgeClass("success")).toBe("badge badge-success");
  expect(toneBadgeClass("warning")).toBe("badge badge-warning");
  expect(toneBadgeClass("info")).toBe("badge badge-info");
});

it("extra classes and the title are kept", () => {
  const ui = render(() => (
    <StatusBadge tone="info" testId="b" class="ml-auto" title="hint">
      x
    </StatusBadge>
  ));
  const badge = ui.getByTestId("b");
  expect(badge.className).toBe("badge badge-info ml-auto");
  expect(badge.title).toBe("hint");
});

it("error and success lines carry a shape icon beside the text", () => {
  const ui = render(() => (
    <>
      <ErrorBanner message="broke" />
      <Notice message="saved" />
    </>
  ));
  expect(ui.getByRole("alert").querySelector("svg")).not.toBeNull();
  expect(ui.getByRole("alert").textContent).toBe("broke");
  expect(ui.getByRole("status").querySelector("svg")).not.toBeNull();
  expect(ui.getByRole("status").textContent).toBe("saved");
});
