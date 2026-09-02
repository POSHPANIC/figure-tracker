/**
 * Deciding what an import may fill in on a figure that already exists.
 *
 * When an importer recognises a product the catalogue already holds, the
 * interesting question is not whether to create it -- the duplicate guard has
 * settled that -- but what it is allowed to add. Shops know things about a
 * product that the source a figure came from did not: Nin-Nin publishes a
 * height where the Good Smile archive published none, Solaris publishes a
 * release month for products the archive stopped covering in 2024.
 *
 * Two rules, and both are about not destroying what is already known:
 *
 *   1. Only fill what is empty. A shop's specification is worth having where
 *      there is nothing, and is not worth more than what we already recorded.
 *      Shops mistype, round heights and restate a reissue's date as the
 *      original's.
 *   2. Never touch a locked field. A lock is somebody having checked the box
 *      and written down what it says; an importer overwriting that would undo
 *      the one kind of data here that a person actually verified.
 *
 * Kept free of the database so the rules can be tested without one.
 */

/** Figure columns an import is allowed to fill. */
export type Fillable = {
  scale: string | null;
  heightMm: number | null;
  releaseDate: Date | null;
  msrpAmount: unknown;
  msrpCurrency: string | null;
  nameJa: string | null;
  primaryImageUrl: string | null;
  manufacturerId: string | null;
  seriesId: string | null;
};

/**
 * Which lock covers which column.
 *
 * The lock keys are the correction form's field names, which are not the
 * column names -- "msrp" covers both halves of the price, and "manufacturer"
 * covers the foreign key rather than the name a person typed.
 */
const LOCK_FOR: Record<keyof Fillable, string> = {
  scale: "scale",
  heightMm: "heightMm",
  releaseDate: "releaseDate",
  msrpAmount: "msrp",
  msrpCurrency: "msrp",
  nameJa: "name",
  primaryImageUrl: "primaryImageUrl",
  manufacturerId: "manufacturer",
  seriesId: "series",
};

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * The subset of `proposed` that may be written, given what is there and what
 * is locked.
 *
 * Returns a partial deliberately: an empty object means "nothing to do", which
 * the caller can check without comparing every field itself.
 */
export function fieldsToFill(
  current: Partial<Fillable>,
  proposed: Partial<Fillable>,
  lockedFields: readonly string[] = [],
): Partial<Fillable> {
  const locked = new Set(lockedFields);
  const fill: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(proposed) as [keyof Fillable, unknown][]) {
    if (isEmpty(value)) continue;
    if (!isEmpty(current[key])) continue;
    if (locked.has(LOCK_FOR[key])) continue;
    fill[key] = value;
  }

  // A price is two columns and one fact. Filling the amount while leaving the
  // currency behind -- because the figure happened to carry a stray currency
  // with no amount -- would publish a number in an unknown unit.
  if ("msrpAmount" in fill && isEmpty(proposed.msrpCurrency)) delete fill.msrpAmount;
  if ("msrpCurrency" in fill && !("msrpAmount" in fill)) delete fill.msrpCurrency;

  return fill as Partial<Fillable>;
}
