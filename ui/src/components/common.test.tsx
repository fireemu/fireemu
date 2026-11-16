import { afterEach, expect, it, vi } from "vitest";
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
