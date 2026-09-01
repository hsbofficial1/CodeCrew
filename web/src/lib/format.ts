/**
 * Formatting and the chart palette.
 *
 * Palette decisions (validated with the data-viz palette validator against the
 * dark chart surface #1a1f28):
 *
 *  - RISK bands use the reserved STATUS palette. Status colour never carries
 *    meaning alone, so every risk colour in the UI ships beside its text label.
 *  - ROUTE identity uses categorical slots 1-3, which clear the all-pairs gate
 *    (worst CVD dE 9.4, normal-vision 20.9) - the map shows at most three routes.
 *  - MODE identity on the map is carried by DASH PATTERN, not hue: no four-hue
 *    set clears the all-pairs floor, so hue is not asked to do that job. Mode
 *    hues appear only in the direct-labelled mode-mix bars, where the adjacent
 *    pairlist applies and slots 1-4 pass.
 *  - The accessibility index is a magnitude, so it uses one sequential blue
 *    ramp. Light steps sit at the low end, which on a dark surface makes the
 *    worst-served settlements the most salient marks on the map.
 */

export const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

export const compactInr = (v: number) => {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return inr(v);
};

export const num = (v: number, d = 0) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

export const compactPop = (v: number) => {
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(v);
};

/** Reserved status palette - always rendered next to its label. */
export const RISK_COLOR: Record<string, string> = {
  low: '#0ca30c',
  moderate: '#fab219',
  high: '#ec835a',
  severe: '#d03b3b',
};

export const RISK_LABEL: Record<string, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  severe: 'Severe',
};

export const SEVERITY_COLOR: Record<string, string> = {
  critical: '#d03b3b',
  warning: '#fab219',
  info: '#3987e5',
};

/** Categorical slots 1-3: safe for up to three simultaneous routes. */
export const ROUTE_COLOR = ['#3987e5', '#d95926', '#199e70'];

/** Mode hues - direct-labelled bars only. On maps, mode is dash pattern. */
export const MODE_COLOR: Record<string, string> = {
  road: '#3987e5',
  rail: '#d95926',
  water: '#199e70',
  air: '#c98500',
};

/** Secondary encoding for mode on the map (SVG stroke-dasharray). */
export const MODE_DASH: Record<string, string | undefined> = {
  road: undefined,
  rail: '10 6',
  water: '2 6',
  air: '18 8 2 8',
};

export const MODE_LABEL: Record<string, string> = {
  road: 'Road',
  rail: 'Rail',
  water: 'Waterway',
  air: 'Air cargo',
};

/**
 * Sequential blue ramp for the 0-100 accessibility index.
 * Lightest step = lowest index, so the worst-served places are the most
 * salient marks on a dark surface. Darkest step respects the dark ordinal
 * floor (step 600, 2.15:1).
 */
const ACCESS_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

export const accessColor = (score: number) => {
  const i = Math.min(ACCESS_RAMP.length - 1, Math.max(0, Math.floor((score / 100) * ACCESS_RAMP.length)));
  return ACCESS_RAMP[i];
};

export const ACCESS_LEGEND = [
  { label: '0-19  cut off', color: ACCESS_RAMP[0] },
  { label: '20-39 severe', color: ACCESS_RAMP[1] },
  { label: '40-59 restricted', color: ACCESS_RAMP[2] },
  { label: '60-79 with planning', color: ACCESS_RAMP[3] },
  { label: '80-100 accessible', color: ACCESS_RAMP[5] },
];
