/**
 * A boolean state attribute value (`aria-expanded`, `aria-pressed`, ...). Solid 2 renders a
 * JSX boolean as presence or absence, which would drop `aria-expanded="false"`; the ARIA states
 * need the explicit "true" or "false" token that Solid 1 rendered.
 */
export const ariaBool = (value: boolean): "true" | "false" => (value ? "true" : "false");
