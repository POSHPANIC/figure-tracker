/**
 * The figure attributes a visitor may propose a correction to, and the fields
 * a missing figure is described with — one list for both, because a person
 * describing a figure we lack is answering the same questions as one correcting
 * a figure we have.
 *
 * One list, read by the form that offers the fields, the action that decides
 * what actually changed, and the queue that shows a moderator both values. Kept
 * together because three copies of "which fields are editable" would drift, and
 * the failure would be silent: a field offered on the form but unknown to the
 * action is simply discarded, and nobody finds out.
 *
 * Mostly mirrors the info box on the figure page. That is where someone notices
 * a wrong height or a missing character, so those are the things worth asking
 * about — and nothing here is a price or a market value, which come from
 * marketplace data and are not a matter of opinion.
 *
 * Series was dropped when browsing moved to franchises: the info box stopped
 * showing it, so the form was asking people to correct something they could no
 * longer see.
 */

export const EDITABLE_FIELDS = [
  { key: "name", label: "Name", placeholder: "As printed on the box" },
  { key: "manufacturer", label: "Manufacturer", placeholder: "Good Smile Company" },
  { key: "character", label: "Character", placeholder: "Marin Kitagawa" },
  { key: "scale", label: "Scale", placeholder: "1/7" },
  { key: "heightMm", label: "Height (mm)", placeholder: "230" },
  { key: "releaseDate", label: "Released", placeholder: "2024-05" },
  { key: "msrp", label: "MSRP", placeholder: "¥16,093" },
  // Not in the info box, and here anyway. Good Smile's store cannot be linked
  // to per product by anything automatic — no sitemap, and its only index is
  // behind a path their robots.txt asks bots to leave alone — so the only way
  // this catalogue gets real store links is people who have the page open
  // pasting them in.
  {
    key: "storeUrl",
    label: "Store link",
    placeholder: "https://www.goodsmile.com/en/product/56818",
  },
] as const;

export type EditableFieldKey = (typeof EDITABLE_FIELDS)[number]["key"];

export const EDITABLE_FIELD_KEYS = EDITABLE_FIELDS.map((f) => f.key);

export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  EDITABLE_FIELDS.map((f) => [f.key, f.label]),
);

/** The shape both the form and the action need in order to compare. */
export type FigureFieldSource = {
  name: string;
  scale: string | null;
  heightMm: number | null;
  // Prisma hands money back as a Decimal, not a number, so this asks only for
  // something that can render itself. Formatting the price is not this file's
  // job — it just needs the string a person would compare against.
  msrpAmount: { toString(): string } | null;
  msrpCurrency: string | null;
  releaseDate: Date | null;
  manufacturer: { name: string } | null;
  characters: { name: string }[];
};

/**
 * What the page currently claims, as the strings a person would type.
 *
 * Comparing what was submitted against this is what turns a form full of
 * prefilled values into a list of actual changes — and it happens server-side,
 * because a client that decides for itself what changed can claim anything
 * changed.
 */
export function currentFieldValues(figure: FigureFieldSource): Record<EditableFieldKey, string> {
  return {
    name: figure.name,
    manufacturer: figure.manufacturer?.name ?? "",
    // Multiple characters are rare and a correction to one of several is
    // clearer written out than half-expressed through a single input.
    character: figure.characters.map((c) => c.name).join(", "),
    scale: figure.scale ?? "",
    heightMm: figure.heightMm ? String(figure.heightMm) : "",
    releaseDate: figure.releaseDate
      ? figure.releaseDate.toISOString().slice(0, 7)
      : "",
    msrp:
      figure.msrpAmount && figure.msrpCurrency
        ? `${figure.msrpCurrency} ${figure.msrpAmount.toString()}`
        : "",
    // Nothing is stored for this yet, so the field starts empty and anything
    // typed into it counts as a change.
    storeUrl: "",
  };
}
