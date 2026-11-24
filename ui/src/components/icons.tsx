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
export const IconPubSub = icon(() => (
  <>
    <circle cx="5" cy="12" r="2.5" />
    <circle cx="19" cy="6" r="2.5" />
    <circle cx="19" cy="18" r="2.5" />
    <path d="m7.3 11 9.4-4M7.3 13l9.4 4" />
  </>
));
export const IconRemoteConfig = icon(() => (
  <>
    <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="17" r="2" />
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

// Status and action icons below are derived from Lucide (https://lucide.dev).
// Lucide is licensed under the ISC License:
//   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather
//   (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
//   Permission to use, copy, modify, and/or distribute this software for any purpose with or
//   without fee is hereby granted, provided that the above copyright notice and this
//   permission notice appear in all copies.
//   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO
//   THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT
//   SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR
//   ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
//   OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE
//   USE OR PERFORMANCE OF THIS SOFTWARE.
// Each status has its own shape, so a state never rests on colour alone.
export const IconSuccess = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </>
));
export const IconWarning = icon(() => (
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>
));
export const IconDanger = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />
  </>
));
export const IconInfo = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </>
));
export const IconNeutral = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12h8" />
  </>
));
export const IconPaused = icon(() => (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M10 15V9" />
    <path d="M14 15V9" />
  </>
));
export const IconCopy = icon(() => (
  <>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>
));
export const IconMenu = icon(() => (
  <>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </>
));
