import type { ProjectColor } from "@t3tools/contracts";

export const PROJECT_COLORS: ReadonlyArray<ProjectColor> = [
  "blue",
  "indigo",
  "violet",
  "pink",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
];

const LIGHT_PROJECT_COLOR_HEX: Record<ProjectColor, string> = {
  blue: "#2563EB",
  indigo: "#4F46E5",
  violet: "#7C3AED",
  pink: "#DB2777",
  red: "#DC2626",
  orange: "#EA580C",
  amber: "#B45309",
  green: "#15803D",
  teal: "#0F766E",
  cyan: "#0E7490",
};

const DARK_PROJECT_COLOR_HEX: Record<ProjectColor, string> = {
  blue: "#60A5FA",
  indigo: "#818CF8",
  violet: "#A78BFA",
  pink: "#F472B6",
  red: "#F87171",
  orange: "#FB923C",
  amber: "#FBBF24",
  green: "#4ADE80",
  teal: "#2DD4BF",
  cyan: "#22D3EE",
};

function stableProjectHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function resolveProjectColor(project: {
  readonly id: string;
  readonly color?: ProjectColor;
}): ProjectColor {
  return project.color ?? PROJECT_COLORS[stableProjectHash(project.id) % PROJECT_COLORS.length]!;
}

export function projectColorHex(color: ProjectColor, dark: boolean): string {
  return dark ? DARK_PROJECT_COLOR_HEX[color] : LIGHT_PROJECT_COLOR_HEX[color];
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
