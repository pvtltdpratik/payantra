/** Swatch colours for common Indian-fashion colour names. Unknown names render as a text chip. */
const SWATCHES: Record<string, string> = {
  maroon: "#5c1a2b",
  emerald: "#1f5c4a",
  indigo: "#2b3a67",
  mustard: "#c79a2b",
  rose: "#c26b7a",
  teal: "#1f6f78",
  ivory: "#efe3cc",
  saffron: "#d9772b",
  peach: "#e8a98c",
  navy: "#1c2541",
  olive: "#6b6b2f",
  wine: "#4a1230",
  gold: "#c8a45d",
  charcoal: "#3a3a3a",
  black: "#1d1d1d",
  tan: "#a8794a",
  white: "#ffffff",
  red: "#b3262a",
  blue: "#2a5db0",
  green: "#2f6f3a",
  pink: "#e58fb0",
  yellow: "#e6c73a",
  grey: "#8a8a8a",
  gray: "#8a8a8a",
  brown: "#6b4226",
  purple: "#6a3d8f",
  orange: "#e07b22",
  beige: "#d9c7a3",
  cream: "#f3ead7",
};

export function swatchFor(colour: string): string | null {
  return SWATCHES[colour.trim().toLowerCase()] ?? null;
}
