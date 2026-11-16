import type { Component, JSX } from "solid-js";

// Decorative line icons (24x24 grid, currentColor). Always paired with a text label, so
// they are hidden from assistive technology.
const icon =
  (paths: () => JSX.Element): Component =>
  () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {paths()}
    </svg>
  );

export const IconOverview = icon(() => (
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>
));
export const IconFirestore = icon(() => (
  <>
    <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
    <path d="m3 12 9 4.5 9-4.5" />
    <path d="m3 16.5 9 4.5 9-4.5" />
  </>
));
export const IconDatabase = icon(() => (
  <>
    <ellipse cx="12" cy="5.5" rx="8" ry="2.5" />
    <path d="M4 5.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
    <path d="M4 11.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
  </>
));
export const IconAuth = icon(() => (
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.900 2.100 6.500 5.500" />
    <path d="M16 4.800a3.500 3.500 0 0 1 0 6.400M18.500 14.900c1.600.900 2.700 2.600 3 5.100" />
  </>
));
export const IconStorage = icon(() => (
  <>
    <path d="M3 7.5A1.500 1.500 0 0 1 4.500 6H9l2 2.500h8.500A1.500 1.500 0 0 1 21 10v8a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 3 18V7.500Z" />
  </>
));
export const IconFunctions = icon(() => (
  <>
    <path d="m8 7-5 5 5 5" />
    <path d="m16 7 5 5-5 5" />
    <path d="m13.500 4-3 16" />
  </>
));
export const IconHosting = icon(() => (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.500 2.600 3.800 5.600 3.800 9s-1.300 6.400-3.800 9c-2.500-2.600-3.800-5.600-3.800-9S9.500 5.600 12 3Z" />
  </>
));
export const IconAlerts = icon(() => (
  <>
    <path d="M6 16.500V11a6 6 0 1 1 12 0v5.500l1.500 2h-15l1.500-2Z" />
    <path d="M10 21h4" />
  </>
));
export const IconRules = icon(() => (
  <>
    <path d="M12 3 4.500 6v5.500c0 4.400 3 8 7.500 9.500 4.500-1.500 7.500-5.100 7.500-9.500V6L12 3Z" />
    <path d="m9 12 2.200 2.200L15.200 10" />
  </>
));
export const IconAppCheck = icon(() => (
  <>
    <rect x="6" y="2.500" width="12" height="19" rx="2.500" />
    <path d="m9.500 12 1.800 1.800 3.200-3.300" />
  </>
));
export const IconRuntime = icon(() => (
  <>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.500 2.500" />
    <path d="M9.500 2.500h5" />
  </>
));
export const IconSearch = icon(() => (
  <>
    <circle cx="11" cy="11" r="6.500" />
    <path d="m20 20-4.200-4.200" />
  </>
));
export const IconSun = icon(() => (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M5.300 18.700l1.400-1.400M17.300 6.700l1.400-1.400" />
  </>
));
export const IconMoon = icon(() => (
  <path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500Z" />
));
export const IconMonitor = icon(() => (
  <>
    <rect x="3" y="4" width="18" height="12" rx="1.500" />
    <path d="M8.500 20h7M12 16v4" />
  </>
));
export const IconChevron = icon(() => <path d="m9 6 6 6-6 6" />);
