import type { FigureCategory, ItemCondition, ReleaseStatus } from "./generated/prisma/enums";

/**
 * Human-readable names for enum values. Kept out of components so the wording
 * is consistent everywhere and translating later is a single-file change.
 */

export const CATEGORY_LABELS: Record<FigureCategory, string> = {
  SCALE: "Scale",
  NENDOROID: "Nendoroid",
  FIGMA: "figma",
  HELLO_GOOD_SMILE: "HELLO! GOOD SMILE",
  PRIZE: "Prize",
  TRADING: "Trading",
  GARAGE_KIT: "Garage kit",
  MODEL_KIT: "Model kit",
  PLUSH: "Plush",
  OTHER: "Other",
};

export const CATEGORY_ORDER: FigureCategory[] = [
  "SCALE",
  "NENDOROID",
  "FIGMA",
  "HELLO_GOOD_SMILE",
  "PRIZE",
  "TRADING",
  "MODEL_KIT",
  "GARAGE_KIT",
  "PLUSH",
  "OTHER",
];

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  NEW_SEALED: "New / sealed",
  NEW_OPENED: "New, box opened",
  USED_COMPLETE: "Used, complete",
  USED_INCOMPLETE: "Used, missing parts",
  DAMAGED: "Damaged",
  UNKNOWN: "Unknown",
};

export const STATUS_LABELS: Record<ReleaseStatus, string> = {
  ANNOUNCED: "Announced",
  PREORDER: "Preorder",
  RELEASED: "Released",
  DELAYED: "Delayed",
  CANCELLED: "Cancelled",
};

/** Conditions we actually chart. The rest are too sparse to be meaningful. */
export const CHARTABLE_CONDITIONS: ItemCondition[] = ["NEW_SEALED", "USED_COMPLETE"];

export const RANGE_OPTIONS = [
  { days: 30, label: "1M" },
  { days: 90, label: "3M" },
  { days: 180, label: "6M" },
  { days: 365, label: "1Y" },
  { days: 3650, label: "All" },
] as const;

export const SORT_LABELS: Record<string, string> = {
  trending: "Trending",
  "value-desc": "Price: high to low",
  "value-asc": "Price: low to high",
  newest: "Newest release",
  name: "Name A–Z",
};
