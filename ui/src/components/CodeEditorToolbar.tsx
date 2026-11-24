import { createSignal, Show, type Component } from "solid-js";
import { t } from "../i18n";

/**
 * Formats a JSON string with 2-space indentation, returning `null` if invalid.
 */
export const formatJsonText = (raw: string): string | null => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return null;
  }
};

/**
 * Handles Tab indentation inside code textareas only when Shift is not held and the user
 * intentionally indents with Ctrl+M / Alt+Tab, OR optionally inserts 2 spaces when opted in.
 * To preserve keyboard navigation (e.g. Tab out of textareas for accessibility and E2E tests),
 * this helper binds `Ctrl+Shift+F` / `Cmd+Shift+F` for JSON formatting when `onFormat` is provided.
 */
export const onCodeEditorKeyDown = (
  event: KeyboardEvent,
  onFormat?: () => void,
): void => {
  if (
    onFormat &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "f"
  ) {
    event.preventDefault();
    onFormat();
  }
};

/** Compact toolbar paired with JSON / Rules editors: line count + optional Format JSON action. */
export const CodeEditorToolbar: Component<{
  value: string;
  onFormat?: (formatted: string) => void;
  testId?: string;
}> = (props) => {
  const [formatError, setFormatError] = createSignal(false);
  const lineCount = () => (props.value ? props.value.split("\n").length : 0);
  const handleFormat = () => {
    const formatted = formatJsonText(props.value);
    if (formatted === null) {
      setFormatError(true);
      return;
    }
    setFormatError(false);
    props.onFormat?.(formatted);
  };
  return (
    <div class="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span>{t("editor.lines", { lines: lineCount() })}</span>
      <div class="flex items-center gap-2">
        <Show when={formatError()}>
          <span class="text-danger">{t("editor.invalidJson")}</span>
        </Show>
        <Show when={props.onFormat}>
          <button
            type="button"
            class="btn btn-sm"
            data-testid={props.testId ? `${props.testId}-format` : undefined}
            onClick={handleFormat}
          >
            {t("editor.formatJson")}
          </button>
        </Show>
      </div>
    </div>
  );
};
