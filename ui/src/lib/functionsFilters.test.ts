import { describe, expect, it } from "vitest";
import { readFunctionFilters, functionFiltersUrl } from "./functionsFilters";

describe("function filter links", () => {
  it("restores valid filters and normalizes an unknown level", () => {
    expect(readFunctionFilters(new URLSearchParams("function=hello&level=error&q=secret"))).toEqual(
      { function: "hello", level: "error", text: "secret" },
    );
    expect(readFunctionFilters(new URLSearchParams("level=invalid"))).toEqual({
      function: "",
      level: "all",
      text: "",
    });
  });
  it("shares only allowlisted fields and excludes text unless explicitly requested", () => {
    const filters = { function: "hello", level: "warn" as const, text: "private text" };
    const url = new URL(
      functionFiltersUrl(
        "http://localhost/ui/functions?token=secret&other=secret#secret",
        filters,
        false,
      ),
    );
    expect([...url.searchParams]).toEqual([
      ["function", "hello"],
      ["level", "warn"],
    ]);
    expect(url.hash).toBe("");
    expect(new URL(functionFiltersUrl(url.href, filters, true)).searchParams.get("q")).toBe(
      "private text",
    );
  });
});

describe("the registered-functions search box", () => {
  const fn = { name: "onUserCreated", region: "us-central1", trigger: { kind: "auth" } };
  it("matches everything for an empty or blank query", async () => {
    const { matchesFunction } = await import("./functionsFilters");
    expect(matchesFunction(fn, "Auth created", "")).toBe(true);
    expect(matchesFunction(fn, "Auth created", "  \t ")).toBe(true);
  });
  it("matches name, region, trigger kind and trigger text, ignoring case", async () => {
    const { matchesFunction } = await import("./functionsFilters");
    expect(matchesFunction(fn, "x", "USERCRE")).toBe(true);
    expect(matchesFunction(fn, "x", "central1")).toBe(true);
    expect(matchesFunction(fn, "x", "auth")).toBe(true);
    expect(matchesFunction(fn, "Firestore created on todos/{id}", "TODOS/")).toBe(true);
    expect(matchesFunction(fn, "x", "storage")).toBe(false);
  });
  it("requires every term, in any order", async () => {
    const { matchesFunction } = await import("./functionsFilters");
    expect(matchesFunction(fn, "Auth created", "created  user")).toBe(true);
    expect(matchesFunction(fn, "Auth created", "user deleted")).toBe(false);
    // Terms do not match across the field boundary.
    expect(matchesFunction(fn, "x", "onUserCreatedus")).toBe(false);
  });
});
