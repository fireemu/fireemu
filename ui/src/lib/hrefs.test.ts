import { describe, expect, it } from "vitest";
import { createRouter } from "@solidjs/router";
import { firestoreHref, splatSegments, storageHref } from "./hrefs";
import { routes } from "../routes";

/** The `path` splat the app router hands the page for an in-app link. */
const routedSplat = (href: string): string | undefined => {
  const Router = createRouter({ routes });
  const params = Router.match(href).at(-1)?.params as { path?: string } | undefined;
  return params?.path;
};

describe("in-app links encode names the URL would misread", () => {
  it("keeps # and ? inside a document ID as path data", () => {
    expect(firestoreHref("cities/a#b?c", "(default)")).toBe(
      "/firestore/cities/a%23b%3Fc?db=(default)",
    );
  });

  it("round-trips every segment through the router splat", () => {
    // `%41` would turn into `A` if the name were decoded twice.
    const names = ["tick`slash\\", "100%", "%41", "東京", "a b", "a#b?c"];
    expect(splatSegments(routedSplat(firestoreHref(names.join("/"), "db-1")))).toEqual(names);
    expect(splatSegments(routedSplat(storageHref(`${names.join("/")}/`, "b")))).toEqual(names);
  });

  it("links the root without a trailing slash", () => {
    expect(firestoreHref("", "(default)")).toBe("/firestore?db=(default)");
    expect(storageHref("", "demo.appspot.com")).toBe("/storage?bucket=demo.appspot.com");
  });

  it("drops the trailing slash of a storage prefix and encodes the bucket", () => {
    expect(storageHref("photos/2026#/", "my bucket")).toBe(
      "/storage/photos/2026%23?bucket=my%20bucket",
    );
  });

  it("leaves a segment that is not a valid escape as typed", () => {
    expect(splatSegments(routedSplat("/firestore/100%/ok"))).toEqual(["100%", "ok"]);
    expect(splatSegments(undefined)).toEqual([]);
  });
});

describe("plain anchors outside the router carry the served base", () => {
  it("prefixes a route with the base the daemon serves the app under", async () => {
    const { appHref, UI_BASE } = await import("./hrefs");
    expect(UI_BASE).toBe("/ui");
    expect(appHref("/firestore")).toBe("/ui/firestore");
    expect(appHref("/")).toBe("/ui/");
  });
});

describe("a reference value links only into the database being browsed", () => {
  it("links a document of this database and nothing else", async () => {
    const { referenceHref } = await import("./hrefs");
    const root = "projects/demo/databases/(default)/documents";
    expect(referenceHref(`${root}/users/a#b`, root, "(default)")).toBe(
      "/firestore/users/a%23b?db=(default)",
    );
    expect(
      referenceHref("projects/demo/databases/other/documents/users/a", root, "(default)"),
    ).toBeNull();
    expect(
      referenceHref("projects/else/databases/(default)/documents/users/a", root, "(default)"),
    ).toBeNull();
    // A name that merely starts with the same characters is another database.
    expect(referenceHref(`${root}x/users/a`, root, "(default)")).toBeNull();
    expect(referenceHref(`${root}/`, root, "(default)")).toBeNull();
    expect(referenceHref(root, root, "(default)")).toBeNull();
  });
});
