import type { FigureCategory, ReleaseStatus } from "./generated/prisma/enums";

/**
 * Direct edits to a figure, by a moderator or admin.
 *
 * The rule half: what each field of the edit form accepts, and which of a
 * figure's fields an edit actually changes. The action that writes it is
 * lib/actions/figure-edit.ts.
 *
 * A visitor suggests a correction (lib/figure-fields.ts) and a person checks
 * it; an editor *is* that person, so their change is written at once and the
 * fields it touched are locked, the same as confirming them. A lock is what
 * stops the next import putting the old value back.
 */

/** Who may edit a figure directly. */
export function canEditFigures(role: string | null | undefined): boolean {
  return role === "MODERATOR" || role === "ADMIN";
}

const CATEGORIES = ["SCALE", "NENDOROID", "FIGMA", "HELLO_GOOD_SMILE", "PRIZE", "TRADING", "GARAGE_KIT", "MODEL_KIT", "PLUSH", "OTHER"] as const;
const STATUSES = ["ANNOUNCED", "PREORDER", "RELEASED", "DELAYED", "CANCELLED"] as const;

export type FigureEdit = {
  name: string;
  nameJa: string | null;
  category: FigureCategory;
  status: ReleaseStatus;
  scale: string | null;
  heightMm: number | null;
  releaseDate: Date | null;
  releaseDatePrecision: "MONTH" | "DAY";
  msrpAmount: string | null;
  msrpCurrency: string | null;
  manufacturer: string | null;
  /** The figure's franchise, which it takes from its series. */
  franchise: string | null;
  characters: string[];
  jan: string | null;
};

export type EditField = keyof FigureEdit;

export type ParseResult = { ok: true; value: FigureEdit } | { ok: false; errors: Partial<Record<EditField, string>> };

const text = (raw: unknown): string => (typeof raw === "string" ? raw.trim() : "");

/** Read the form. Every field is checked, so one pass reports every mistake. */
export function parseEdit(raw: Record<string, unknown>): ParseResult {
  const errors: Partial<Record<EditField, string>> = {};

  const name = text(raw.name);
  if (!name) errors.name = "A figure needs a name.";
  else if (name.length > 200) errors.name = "Keep it under 200 characters.";

  const category = text(raw.category) as FigureCategory;
  if (!(CATEGORIES as readonly string[]).includes(category)) errors.category = "Pick a type.";

  const status = text(raw.status) as ReleaseStatus;
  if (!(STATUSES as readonly string[]).includes(status)) errors.status = "Pick a status.";

  // "1/7", "1/4", and "2/1" for the double-size kits.
  const scale = text(raw.scale);
  if (scale && !/^\d{1,2}\/\d{1,3}(\.\d+)?$/.test(scale)) errors.scale = 'Write it like "1/7".';

  const heightRaw = text(raw.heightMm);
  const heightMm = heightRaw ? Number(heightRaw) : null;
  if (heightRaw && (!Number.isInteger(heightMm) || heightMm! < 1 || heightMm! > 5000)) {
    errors.heightMm = "Whole millimetres, 1 to 5000.";
  }

  // To the precision it is known: "2024-05" says May, "2024-05-17" the day.
  const dateRaw = text(raw.releaseDate);
  let releaseDate: Date | null = null;
  let releaseDatePrecision: "MONTH" | "DAY" = "MONTH";
  if (dateRaw) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(dateRaw);
    const month = m ? Number(m[2]) : 0;
    const day = m?.[3] ? Number(m[3]) : null;
    if (!m || month < 1 || month > 12 || (day !== null && (day < 1 || day > 31))) {
      errors.releaseDate = 'Write it like "2024-05", or "2024-05-17" for a known day.';
    } else {
      // Month dates on the 15th, as the archive import stores them.
      releaseDate = new Date(Date.UTC(Number(m[1]), month - 1, day ?? 15));
      releaseDatePrecision = day === null ? "MONTH" : "DAY";
    }
  }

  const amountRaw = text(raw.msrpAmount).replace(/,/g, "");
  const currency = text(raw.msrpCurrency).toUpperCase();
  let msrpAmount: string | null = null;
  let msrpCurrency: string | null = null;
  if (amountRaw || currency) {
    if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0) errors.msrpAmount = "A price, like 16093 or 64.99.";
    if (!/^[A-Z]{3}$/.test(currency)) errors.msrpCurrency = "Three letters: JPY, USD, EUR.";
    msrpAmount = amountRaw;
    msrpCurrency = currency;
  }

  const manufacturer = text(raw.manufacturer) || null;
  const franchise = text(raw.franchise) || null;
  const characters = text(raw.characters)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const jan = text(raw.jan).replace(/\s+/g, "") || null;
  if (jan && !/^\d{13}$/.test(jan)) errors.jan = "Thirteen digits.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      nameJa: text(raw.nameJa) || null,
      category,
      status,
      scale: scale || null,
      heightMm,
      releaseDate,
      releaseDatePrecision,
      msrpAmount,
      msrpCurrency,
      manufacturer,
      franchise,
      characters,
      jan,
    },
  };
}

/** A figure as the form shows it, so an edit can be compared against it. */
export type EditableFigure = {
  name: string;
  nameJa: string | null;
  category: string;
  status: string;
  scale: string | null;
  heightMm: number | null;
  releaseDate: Date | null;
  releaseDatePrecision: string;
  msrpAmount: { toString(): string } | null;
  msrpCurrency: string | null;
  manufacturer: { name: string } | null;
  /** The franchise of the figure's series, if it has one. */
  franchise: string | null;
  characters: { name: string }[];
  jan: string | null;
};

/** The form's starting values. */
export function formValues(f: EditableFigure): Record<string, string> {
  const d = f.releaseDate;
  return {
    name: f.name,
    nameJa: f.nameJa ?? "",
    category: f.category,
    status: f.status,
    scale: f.scale ?? "",
    heightMm: f.heightMm ? String(f.heightMm) : "",
    releaseDate: d ? d.toISOString().slice(0, f.releaseDatePrecision === "DAY" ? 10 : 7) : "",
    msrpAmount: f.msrpAmount ? String(Number(f.msrpAmount.toString())) : "",
    msrpCurrency: f.msrpCurrency ?? "",
    manufacturer: f.manufacturer?.name ?? "",
    franchise: f.franchise ?? "",
    characters: f.characters.map((c) => c.name).join(", "),
    jan: f.jan ?? "",
  };
}

/**
 * Which fields an edit changes.
 *
 * Compared on the form's own strings, so a field left as it was never counts
 * as changed -- which matters, because each changed field is locked against
 * imports, and a lock on a value nobody looked at would claim a check that
 * never happened.
 */
export function changedFields(before: EditableFigure, after: FigureEdit): EditField[] {
  const was = formValues(before);
  const now = formValues({
    ...after,
    msrpAmount: after.msrpAmount,
    manufacturer: after.manufacturer ? { name: after.manufacturer } : null,
    characters: after.characters.map((name) => ({ name })),
  });
  const keys: [EditField, string][] = [
    ["name", "name"], ["nameJa", "nameJa"], ["category", "category"], ["status", "status"],
    ["scale", "scale"], ["heightMm", "heightMm"], ["releaseDate", "releaseDate"],
    ["msrpAmount", "msrpAmount"], ["msrpCurrency", "msrpCurrency"],
    ["manufacturer", "manufacturer"], ["franchise", "franchise"], ["characters", "characters"], ["jan", "jan"],
  ];
  return keys.filter(([, k]) => (was[k] ?? "") !== (now[k] ?? "")).map(([field]) => field);
}

/**
 * The lock each edited field earns, in the keys importers check (see
 * LOCK_FOR in lib/ingest/enrich.ts). Category, status and the barcode have
 * none: no import overwrites a category, status follows the release date
 * nightly, and a barcode is an identifier rather than a field.
 */
export const LOCK_KEY: Partial<Record<EditField, string>> = {
  name: "name",
  nameJa: "name",
  scale: "scale",
  heightMm: "heightMm",
  releaseDate: "releaseDate",
  msrpAmount: "msrp",
  msrpCurrency: "msrp",
  manufacturer: "manufacturer",
  // Set through the series, which is the field an import would overwrite.
  franchise: "series",
  characters: "character",
};
