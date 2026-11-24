export type RtdbBreadcrumb = {
  label: string;
  path: string;
};

export type RtdbChildKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export type RtdbChildEntry = {
  key: string;
  path: string;
  kind: RtdbChildKind;
  preview: string;
  childCount?: number;
};

export type RtdbTreeSummary = {
  entries: RtdbChildEntry[];
  truncated: number;
};

export const normalizeRtdbPath = (path: string): string => {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
};

export const rtdbBreadcrumbs = (path: string, rootLabel: string): RtdbBreadcrumb[] => {
  const segments = path.split("/").filter((s) => s.length > 0);
  const crumbs: RtdbBreadcrumb[] = [{ label: rootLabel, path: "/" }];
  let acc = "";
  for (const segment of segments) {
    acc += `/${segment}`;
    crumbs.push({ label: segment, path: acc });
  }
  return crumbs;
};

const childPath = (basePath: string, key: string): string => {
  const normalized = normalizeRtdbPath(basePath);
  return normalized === "/" ? `/${key}` : `${normalized}/${key}`;
};

const previewValue = (
  value: unknown,
): { kind: RtdbChildKind; preview: string; childCount?: number } => {
  if (value === null) return { kind: "null", preview: "null" };
  if (Array.isArray(value)) {
    return { kind: "array", preview: `[${value.length}]`, childCount: value.length };
  }
  if (typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return { kind: "object", preview: `{${count}}`, childCount: count };
  }
  if (typeof value === "string") {
    const text = value.length > 80 ? `${value.slice(0, 80)}…` : value;
    return { kind: "string", preview: JSON.stringify(text) };
  }
  if (typeof value === "number") return { kind: "number", preview: String(value) };
  if (typeof value === "boolean") return { kind: "boolean", preview: String(value) };
  return { kind: "string", preview: String(value) };
};

const parseRtdbIntKey = (key: string): number | null => {
  if (!/^(?:0|[1-9]\d{0,9})$/.test(key)) return null;
  const n = Number(key);
  return n <= 2147483647 ? n : null;
};

const compareRtdbKeys = (a: string, b: string): number => {
  const ai = parseRtdbIntKey(a);
  const bi = parseRtdbIntKey(b);
  if (ai !== null && bi !== null) return ai - bi;
  if (ai !== null) return -1;
  if (bi !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Parse raw RTDB JSON at `basePath` into navigable child rows (bounded to `maxEntries`). */
export const parseRtdbTree = (
  rawJson: string,
  basePath: string,
  maxEntries = 200,
): RtdbTreeSummary | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") {
    return { entries: [], truncated: 0 };
  }
  const pairs: [string, unknown][] = Array.isArray(parsed)
    ? parsed.flatMap((v, i): [string, unknown][] => (v === null ? [] : [[String(i), v]]))
    : Object.entries(parsed as Record<string, unknown>).toSorted(([a], [b]) =>
        compareRtdbKeys(a, b),
      );
  const shown = pairs.slice(0, maxEntries);
  return {
    entries: shown.map(([key, value]) => ({
      key,
      path: childPath(basePath, key),
      ...previewValue(value),
    })),
    truncated: Math.max(0, pairs.length - shown.length),
  };
};
