/**
 * In-app links for names the API accepts but a URL would misread. Every segment of a
 * Firestore path or Storage prefix is percent-encoded so `#`, `?`, `%` and non-ASCII
 * characters travel as data; the router decodes each segment of the splat back into the name
 * (`splatSegments`). Display strings never go through these functions.
 */

const encodeSegments = (path: string): string =>
  path
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");

/**
 * The path segments of a router splat (`params.path`), without empty ones. Router 2 already
 * decodes every segment of a splat, so the names arrive as data and are not decoded again (a
 * second decode would turn a stored `%41` into `A`).
 */
export const splatSegments = (splat: string | undefined): string[] =>
  (splat ?? "").split("/").filter(Boolean);

/** The Firestore browser at `path` (`""` for the root) of `db`. */
export const firestoreHref = (path: string, db: string): string => {
  const encoded = encodeSegments(path);
  return `/firestore${encoded ? `/${encoded}` : ""}?db=${encodeURIComponent(db)}`;
};

/** The Storage browser at `prefix` (a folder, with or without its trailing slash) of `bucket`. */
export const storageHref = (prefix: string, bucket: string): string => {
  const encoded = encodeSegments(prefix);
  return `/storage${encoded ? `/${encoded}` : ""}?bucket=${encodeURIComponent(bucket)}`;
};

/** The path the daemon serves the app under (the router's base in `index.tsx`). */
export const UI_BASE = "/ui";

/**
 * A full same-origin URL path for a plain anchor outside router components. The router still
 * handles the click, so the page does not reload.
 */
export const appHref = (route: string): string => `${UI_BASE}${route}`;

/**
 * The Firestore browser link of a reference value, when it points into the database whose
 * documents root is `root` (`projects/p/databases/d/documents`); `null` for any other
 * project or database, which this page cannot open.
 */
export const referenceHref = (reference: string, root: string, db: string): string | null => {
  const prefix = `${root}/`;
  if (!reference.startsWith(prefix) || reference.length === prefix.length) return null;
  return firestoreHref(reference.slice(prefix.length), db);
};
