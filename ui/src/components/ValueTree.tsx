import { A } from "@solidjs/router";
import { createSignal, For, Show, type Component } from "solid-js";
import { t } from "../i18n";
import type { FieldType } from "../lib/firestoreValue";
import type { ValueNode } from "../lib/valueTree";
import { IconChevron } from "./icons";

const VALUE_CLASS: Record<FieldType, string> = {
  string: "value-string",
  number: "value-number",
  boolean: "value-boolean",
  null: "value-null",
  timestamp: "value-special",
  geopoint: "value-special",
  reference: "value-special",
  bytes: "value-special",
  array: "",
  map: "",
};

const joinFieldPath = (parent: string, key: string, indexed: boolean): string => {
  if (!parent) return key;
  return indexed ? `${parent}[${key}]` : `${parent}.${key}`;
};

type RowProps = {
  node: ValueNode;
  depth: number;
  fieldPath: string;
  typeLabel: (type: FieldType) => string;
  /** The in-app link of a reference (given its full resource name), or `null` for text. */
  referenceHref?: ((reference: string) => string | null) | undefined;
  /** In an array the key is a position, shown dimmed. */
  indexed: boolean;
  showCopyActions?: boolean | undefined;
  onFilterValue?: ((fieldPath: string, node: ValueNode) => void) | undefined;
};

const Row: Component<RowProps> = (props) => {
  const container = () => props.node.type === "map" || props.node.type === "array";
  // The first level opens by itself; deeper levels open on demand.
  const [open, setOpen] = createSignal(props.depth === 0 && props.node.size <= 20);
  const [copied, setCopied] = createSignal<"val" | "path" | null>(null);
  const typeText = () =>
    props.node.numberKind
      ? `${props.typeLabel(props.node.type)} (${props.node.numberKind})`
      : props.typeLabel(props.node.type);
  const href = () =>
    props.node.reference !== undefined
      ? (props.referenceHref?.(props.node.reference) ?? null)
      : null;
  const copyText = (which: "val" | "path", text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      window.setTimeout(() => setCopied((cur) => (cur === which ? null : cur)), 1500);
    });
  };
  return (
    <li>
      <div
        class="group flex items-baseline gap-2 rounded px-1 py-1 hover:bg-hover"
        style={{ "padding-left": `${props.depth * 1.25 + 0.25}rem` }}
      >
        <Show when={container() && props.node.size > 0} fallback={<span class="w-4 shrink-0" />}>
          <button
            type="button"
            class="link w-4 shrink-0 self-center text-muted [&>svg]:size-3.5 [&>svg]:transition-transform"
            classList={{ "[&>svg]:rotate-90": open() }}
            aria-expanded={open()}
            aria-label={t(open() ? "firestore.collapseField" : "firestore.expandField", {
              name: props.node.key,
            })}
            onClick={() => setOpen(!open())}
          >
            <IconChevron />
          </button>
        </Show>
        <span class="mono shrink-0 font-medium" classList={{ "text-muted": props.indexed }}>
          {props.node.key}
        </span>
        <span class="type-chip shrink-0">{typeText()}</span>
        <span class={`mono min-w-0 flex-1 break-all ${VALUE_CLASS[props.node.type]}`}>
          <Show
            when={container()}
            fallback={
              <Show when={href()} fallback={props.node.preview}>
                {(target) => (
                  <A class="link" href={target()}>
                    {props.node.preview}
                  </A>
                )}
              </Show>
            }
          >
            <Show
              when={open() && props.node.size > 0}
              fallback={<span class="text-secondary">{props.node.preview}</span>}
            >
              <span class="text-muted">
                {props.node.size === 1
                  ? t(props.node.type === "map" ? "firestore.mapSizeOne" : "firestore.arraySizeOne")
                  : t(props.node.type === "map" ? "firestore.mapSize" : "firestore.arraySize", {
                      count: props.node.size,
                    })}
              </span>
            </Show>
          </Show>
        </span>
        <Show
          when={props.showCopyActions || (props.onFilterValue && !container() && !props.indexed)}
        >
          <span class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Show when={props.showCopyActions}>
              <button
                type="button"
                class="btn btn-sm"
                title={t("firestore.copyValue")}
                aria-label={`${t("firestore.copyValue")} ${props.fieldPath}`}
                onClick={() => copyText("val", props.node.reference ?? props.node.preview)}
              >
                {copied() === "val" ? t("app.copied") : t("app.copy")}
              </button>
              <button
                type="button"
                class="btn btn-sm"
                title={t("firestore.copyFieldPath")}
                aria-label={`${t("firestore.copyFieldPath")} ${props.fieldPath}`}
                onClick={() => copyText("path", props.fieldPath)}
              >
                {copied() === "path" ? t("app.copied") : "Path"}
              </button>
            </Show>
            <Show when={props.onFilterValue && !container() && !props.indexed}>
              <button
                type="button"
                class="btn btn-sm"
                title={t("firestore.filterByValue")}
                aria-label={`${t("firestore.filterByValue")} ${props.fieldPath}`}
                onClick={() => props.onFilterValue?.(props.fieldPath, props.node)}
              >
                {t("firestore.filterByValue")}
              </button>
            </Show>
          </span>
        </Show>
      </div>
      <Show when={container() && open() && props.node.size > 0}>
        <ul>
          <For each={props.node.children}>
            {(child) => {
              const childIndexed = props.node.type === "array";
              return (
                <Row
                  node={child}
                  depth={props.depth + 1}
                  fieldPath={joinFieldPath(props.fieldPath, child.key, childIndexed)}
                  typeLabel={props.typeLabel}
                  referenceHref={props.referenceHref}
                  indexed={childIndexed}
                  showCopyActions={props.showCopyActions}
                  onFilterValue={props.onFilterValue}
                />
              );
            }}
          </For>
          <Show when={props.node.omitted > 0}>
            <li
              class="py-1 text-xs text-secondary"
              style={{ "padding-left": `${(props.depth + 1) * 1.25 + 1.5}rem` }}
            >
              {t("firestore.treeOmitted", { count: props.node.omitted })}
            </li>
          </Show>
        </ul>
      </Show>
    </li>
  );
};

/**
 * A document's fields as an expandable tree: name, type and value per row, nested maps and
 * arrays on demand. Every name and value is rendered as text.
 */
export const ValueTree: Component<{
  nodes: ValueNode[];
  typeLabel: (type: FieldType) => string;
  referenceHref?: ((reference: string) => string | null) | undefined;
  testId?: string | undefined;
  showCopyActions?: boolean | undefined;
  onFilterValue?: ((fieldPath: string, node: ValueNode) => void) | undefined;
}> = (props) => (
  <ul class="text-sm" data-testid={props.testId}>
    <For each={props.nodes}>
      {(node) => (
        <Row
          node={node}
          depth={0}
          fieldPath={node.key}
          typeLabel={props.typeLabel}
          referenceHref={props.referenceHref}
          indexed={false}
          showCopyActions={props.showCopyActions}
          onFilterValue={props.onFilterValue}
        />
      )}
    </For>
  </ul>
);
