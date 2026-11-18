import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { routed } from "../test/router";
import type { FsValue } from "../lib/firestoreValue";
import { buildValueTree, DEFAULT_LIMITS } from "../lib/valueTree";
import { ValueTree } from "./ValueTree";

afterEach(cleanup);

const mount = (
  fields: Record<string, FsValue>,
  referenceHref?: (path: string) => string | null,
  limits = DEFAULT_LIMITS,
) =>
  render(
    routed([
      {
        path: "*",
        component: () => (
          <ValueTree
            nodes={buildValueTree(fields, limits)}
            typeLabel={(type) => type}
            referenceHref={referenceHref}
            testId="tree"
          />
        ),
      },
    ]),
  );

it("shows name, type and value per field, with integer and double told apart", () => {
  const ui = mount({
    name: { stringValue: "Tokyo" },
    population: { integerValue: "14000000" },
    ratio: { doubleValue: 0.5 },
    capital: { booleanValue: true },
  });
  const rows = [...ui.getByTestId("tree").children].map((li) => li.textContent);
  expect(rows).toEqual([
    "capitalbooleantrue",
    'namestring"Tokyo"',
    "populationnumber (integer)14000000",
    "rationumber (double)0.5",
  ]);
  expect(ui.container.querySelector(".value-string")?.textContent).toBe('"Tokyo"');
  expect(ui.container.querySelectorAll(".value-number")).toHaveLength(2);
  expect(ui.container.querySelector(".value-boolean")?.textContent).toBe("true");
  // Scalars have nothing to expand.
  expect(ui.container.querySelectorAll("button")).toHaveLength(0);
});

it("opens the first level, keeps deeper levels closed, and toggles on click", () => {
  const ui = mount({
    profile: {
      mapValue: {
        fields: {
          address: { mapValue: { fields: { city: { stringValue: "Kyoto" } } } },
          active: { booleanValue: true },
        },
      },
    },
  });
  const text = () => ui.getByTestId("tree").textContent ?? "";
  expect(text()).toContain("2 fields");
  expect(text()).toContain("active");
  // The nested map shows its compact preview until opened.
  expect(text()).toContain('{"city":"Kyoto"}');
  expect(text()).not.toContain("1 field");
  const nested = ui.getByLabelText("Expand address");
  expect(nested.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(nested);
  expect(ui.getByLabelText("Collapse address").getAttribute("aria-expanded")).toBe("true");
  expect(text()).toContain("addressmap1 fieldcity");
  expect(text()).not.toContain("1 fields");
  expect(text()).toContain('citystring"Kyoto"');
  expect(text()).not.toContain('{"city":"Kyoto"}');
  fireEvent.click(ui.getByLabelText("Collapse profile"));
  expect(text()).toBe('profilemap{"address":{"city":"Kyoto"},"active":true}');
});

it("an empty container has no toggle and a first level wider than 20 starts closed", () => {
  const values: FsValue[] = Array.from({ length: 21 }, (_, i) => ({ integerValue: String(i) }));
  const ui = mount({
    empty: { arrayValue: {} },
    wide: { arrayValue: { values } },
    edge: { arrayValue: { values: values.slice(0, 20) } },
  });
  expect(ui.queryByLabelText("Expand empty")).toBeNull();
  expect(ui.queryByLabelText("Collapse empty")).toBeNull();
  expect(ui.getByLabelText("Expand wide")).toBeTruthy();
  expect(ui.getByLabelText("Collapse edge")).toBeTruthy();
  expect(ui.getByTestId("tree").textContent).toContain("20 items");
});

it("says how many entries the width limit left out", () => {
  const values: FsValue[] = Array.from({ length: 5 }, (_, i) => ({ integerValue: String(i) }));
  const ui = mount({ list: { arrayValue: { values } } }, undefined, {
    ...DEFAULT_LIMITS,
    maxChildren: 2,
  });
  expect(ui.getByTestId("tree").textContent).toContain("3 more not shown");
  expect(ui.getByTestId("tree").textContent).toContain("5 items");
  cleanup();
  const one = mount({ list: { arrayValue: { values: values.slice(0, 1) } } });
  expect(one.getByTestId("tree").textContent).toBe("listarray1 item0number (integer)0");
});

it("links a reference only when the page gives it a target", () => {
  const fields: Record<string, FsValue> = {
    owner: { referenceValue: "projects/p/databases/(default)/documents/users/a" },
  };
  const seen: string[] = [];
  const linked = mount(fields, (reference) => {
    seen.push(reference);
    return "/firestore/users/a";
  });
  const anchor = linked.getByText("users/a");
  expect(anchor.tagName).toBe("A");
  // Router 2 anchors carry the full served path (the app runs under /ui).
  expect(anchor.getAttribute("href")).toBe("/ui/firestore/users/a");
  // The page decides from the full resource name, not from the shortened text.
  expect(new Set(seen)).toEqual(new Set(["projects/p/databases/(default)/documents/users/a"]));
  cleanup();
  const plain = mount(fields, () => null);
  expect(plain.getByText("users/a").tagName).not.toBe("A");
  cleanup();
  const none = mount(fields);
  expect(none.container.querySelector("a")).toBeNull();
});

it("renders hostile names and values as text", () => {
  const ui = mount({
    "<img src=x onerror=alert(1)>": { stringValue: "<script>alert(2)</script>" },
  });
  expect(ui.container.querySelector("img")).toBeNull();
  expect(ui.container.querySelector("script")).toBeNull();
  expect(ui.getByTestId("tree").textContent).toContain("<img src=x onerror=alert(1)>");
  expect(ui.getByTestId("tree").textContent).toContain("<script>alert(2)</script>");
});
