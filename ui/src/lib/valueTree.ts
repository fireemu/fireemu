// A Firestore value as a display tree: one node per field, array element or map entry, with
// its type and a one-line preview. Bounded in depth and width so a hostile or huge document
// cannot make the page build an unbounded DOM; the raw JSON view shows the rest.
import { summarize, typeOf, type FieldType, type FsValue } from "./firestoreValue";

export type ValueNode = {
  /** The field name, or the index of an array element. */
  key: string;
  type: FieldType;
  /** `integer` or `double` for numbers, which the wire tells apart. */
  numberKind?: "integer" | "double";
  /** The full resource name of a reference (the preview shows it relative). */
  reference?: string;
  /** One line: the value itself for scalars, compact JSON (cut) for containers. */
  preview: string;
  /** The number of entries of a map or array (0 for scalars). */
  size: number;
  children: ValueNode[];
  /** Entries beyond the width limit, or all of them beyond the depth limit. */
  omitted: number;
};

export type TreeLimits = { maxDepth: number; maxChildren: number; maxPreview: number };

export const DEFAULT_LIMITS: TreeLimits = { maxDepth: 20, maxChildren: 200, maxPreview: 120 };

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const entriesOf = (value: FsValue): [string, FsValue][] | null => {
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map((v, index) => [String(index), v]);
  }
  if ("mapValue" in value) {
    // Field names sort as the console shows them, independent of wire order.
    return Object.entries(value.mapValue.fields ?? {}).toSorted(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
  }
  return null;
};

const nodeOf = (key: string, value: FsValue, depth: number, limits: TreeLimits): ValueNode => {
  const type = typeOf(value);
  const entries = entriesOf(value);
  const numberKind: ValueNode["numberKind"] =
    "integerValue" in value ? "integer" : "doubleValue" in value ? "double" : undefined;
  const base: Pick<ValueNode, "key" | "type" | "numberKind" | "reference" | "preview"> = {
    key,
    type,
    ...(numberKind ? { numberKind } : {}),
    ...("referenceValue" in value ? { reference: value.referenceValue } : {}),
    preview: cut(summarize(value), limits.maxPreview),
  };
  if (entries === null) return { ...base, size: 0, children: [], omitted: 0 };
  if (depth >= limits.maxDepth) {
    return { ...base, size: entries.length, children: [], omitted: entries.length };
  }
  const shown = entries.slice(0, limits.maxChildren);
  return {
    ...base,
    size: entries.length,
    children: shown.map(([k, v]) => nodeOf(k, v, depth + 1, limits)),
    omitted: entries.length - shown.length,
  };
};

/** The display tree of a document's fields, sorted by field name. */
export const buildValueTree = (
  fields: Record<string, FsValue> | undefined,
  limits: TreeLimits = DEFAULT_LIMITS,
): ValueNode[] =>
  Object.entries(fields ?? {})
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => nodeOf(name, value, 0, limits));

/** The number of nodes in a tree (what the page would render fully expanded). */
export const countNodes = (nodes: readonly ValueNode[]): number =>
  nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
