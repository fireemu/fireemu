import { afterEach, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { Section, SectionNav } from "./common";

afterEach(cleanup);

it("a jump link scrolls to its section and moves focus there without touching the URL", () => {
  const before = window.location.href;
  const ui = render(() => (
    <div>
      <SectionNav
        label="Sections"
        sections={[
          { id: "first", title: "First" },
          { id: "second", title: "Second" },
          { id: "absent", title: "Absent" },
        ]}
      />
      <Section id="first" title="First section">
        <p>one</p>
      </Section>
      <Section id="second" title="Second section">
        <p>two</p>
      </Section>
    </div>
  ));
  const second = document.getElementById("second")!;
  const scroll = vi.fn();
  second.scrollIntoView = scroll;
  fireEvent.click(ui.getByText("Second"));
  expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  expect(document.activeElement).toBe(second);
  expect(second.getAttribute("tabindex")).toBe("-1");
  // A link whose section is not on the page does nothing.
  fireEvent.click(ui.getByText("Absent"));
  expect(document.activeElement).toBe(second);
  expect(window.location.href).toBe(before);
  expect(ui.getByLabelText("Sections").querySelectorAll("button")).toHaveLength(3);
});

it("a section without an id carries no id attribute", () => {
  const ui = render(() => (
    <Section title="Plain">
      <p>body</p>
    </Section>
  ));
  expect(ui.container.querySelector("section")!.hasAttribute("id")).toBe(false);
});

it("shows the distance of an instant from the session's virtual clock, not the wall clock", async () => {
  const { RelativeTime } = await import("./common");
  const { appState } = await import("../state");
  appState.setClock("2026-08-29T12:00:00Z");
  const [value, setValue] = createSignal<string | undefined>("2026-08-29T11:57:00Z");
  const ui = render(() => (
    <span data-testid="cell">
      {value()}
      <RelativeTime value={value()} />
    </span>
  ));
  // The instant itself stays the visible value; the distance is an addition.
  expect(ui.getByTestId("cell").textContent).toBe("2026-08-29T11:57:00Z(3 min ago)");
  appState.setClock("2026-08-29T13:57:00Z");
  expect(ui.getByTestId("relative-time").textContent).toBe("(2 h ago)");
  setValue("2026-08-29T14:02:00Z");
  expect(ui.getByTestId("relative-time").textContent).toBe("(in 5 min)");
  // Nothing rather than a wrong distance: no value, an unparsable value, no clock yet.
  setValue(undefined);
  expect(ui.queryByTestId("relative-time")).toBeNull();
  setValue("");
  expect(ui.queryByTestId("relative-time")).toBeNull();
  setValue("not a time");
  expect(ui.queryByTestId("relative-time")).toBeNull();
  setValue("2026-08-29T11:57:00Z");
  appState.setClock("");
  expect(ui.queryByTestId("relative-time")).toBeNull();
});
