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

type RowProps = {
  node: ValueNode;
  depth: number;
  typeLabel: (type: FieldType) => string;
  /** The in-app link of a reference (given its full resource name), or `null` for text. */
  referenceHref?: ((reference: string) => string | null) | undefined;
  /** In an array the key is a position, shown dimmed. */
  indexed: boolean;
};

const Row: Component<RowProps> = (props) => {
  const container = () => props.node.type === "map" || props.node.type === "array";
  // The first level opens by itself; deeper levels open on demand.
  const [open, setOpen] = createSignal(props.depth === 0 && props.node.size <= 20);
  const typeText = () =>
    props.node.numberKind
      ? `${props.typeLabel(props.node.type)} (${props.node.numberKind})`
      : props.typeLabel(props.node.type);
  const href = () =>
    props.node.reference !== undefined
      ? (props.referenceHref?.(props.node.reference) ?? null)
      : null;
  return (
    <li>
      <div
        class="flex items-baseline gap-2 rounded px-1 py-1 hover:bg-hover"
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
        <span class={`mono min-w-0 break-all ${VALUE_CLASS[props.node.type]}`}>
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
      </div>
      <Show when={container() && open() && props.node.size > 0}>
        <ul>
          <For each={props.node.children}>
            {(child) => (
              <Row
                node={child}
                depth={props.depth + 1}
                typeLabel={props.typeLabel}
                referenceHref={props.referenceHref}
                indexed={props.node.type === "array"}
              />
            )}
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
}> = (props) => (
  <ul class="text-sm" data-testid={props.testId}>
    <For each={props.nodes}>
      {(node) => (
        <Row
          node={node}
          depth={0}
          typeLabel={props.typeLabel}
          referenceHref={props.referenceHref}
          indexed={false}
        />
      )}
    </For>
  </ul>
);
