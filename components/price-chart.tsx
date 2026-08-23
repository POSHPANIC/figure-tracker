"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
  ErrorBar,
} from "recharts";
import type { PricePoint } from "@/lib/queries";
import { formatMoney, type DisplayMoney } from "@/lib/currency";
import { formatCurrency } from "@/lib/money";
import { RANGE_OPTIONS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * Price history chart.
 *
 * The primary line is the median of whatever the day could honestly report —
 * sold prices where they exist, and otherwise what sellers were asking. Today
 * that is always the asking median, because nothing in this category publishes
 * sold prices. The chart says which, rather than letting a reader assume the
 * stronger of the two.
 *
 * Behind it, the daily min–max as a shaded band. The band matters: a median
 * alone hides that a figure was listed between $25 and $306 that day, which is
 * exactly what a buyer needs to know — and it matters more for asking prices
 * than it ever did for sales, because nobody has to accept an asking price.
 */

type Props = {
  data: PricePoint[];
  /**
   * What the manufacturer charged at release, already converted into the
   * currency being displayed at the rate of the month it was set. Null where
   * unknown.
   *
   * Converted by the caller rather than here, because it is the one number on
   * this chart that must not use today's rate. A ¥3,900 figure shown to a
   * Japanese reader is ¥3,900 — sending it through USD and back at today's
   * rate returned ¥5,482, a price nobody ever charged. The axis is in dollars,
   * so the plotted position divides this back out; the label never does, and
   * the label is the part that makes a claim.
   *
   * Drawn as a flat reference line rather than as the first point of the
   * series. It is not an observation of this market: it is a different price,
   * of a different thing, from a different decade. Joining it to the first
   * asking point with a line would draw a path between them that nobody
   * measured, and the slope of that invented path is the part a reader would
   * remember.
   */
  msrpDisplay?: number | null;
  /** Days of history available; used to hide range buttons we can't fill. */
  maxDays: number;
  /**
   * Snapshots are stored in USD only — averaging across mixed currencies
   * isn't meaningful — so every point on this chart is converted for display.
   */
  money: DisplayMoney;
};

/**
 * Parse a "YYYY-MM-DD" snapshot date as that calendar day, locally.
 *
 * `new Date("2026-08-22")` is midnight **UTC**, which in the Americas renders
 * as the 21st — every point on the chart labelled a day early. These dates are
 * calendar days, not instants: the day sellers were asking that price. Adding
 * the time component makes the parse local and the label honest.
 */
function parseDay(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

export function PriceChart({ data, maxDays, money, msrpDisplay }: Props) {
  const [range, setRange] = useState<number>(90);

  const visible = useMemo(() => {
    const cutoff = Date.now() - range * 86400_000;
    return data
      .filter((d) => parseDay(d.date).getTime() >= cutoff)
      .map((d) => ({
        ...d,
        // Recharts draws a band when the value is a [low, high] tuple.
        band: d.min !== null && d.max !== null ? ([d.min, d.max] as [number, number]) : null,
        // ErrorBar wants distances from the point, not absolute bounds.
        spread:
          d.median !== null && d.min !== null && d.max !== null
            ? ([d.median - d.min, d.max - d.median] as [number, number])
            : null,
      }));
  }, [data, range]);

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border">
        <div className="text-center">
          <p className="font-medium">No price history yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted">
            Nothing is listed for this condition, so there is nothing to chart.
            History is recorded from the day a figure first appears for sale —
            it is not reconstructed backwards, because the prices behind it were
            never kept.
          </p>
        </div>
      </div>
    );
  }

  // Where the original price falls on an axis drawn in dollars.
  const msrpAxis =
    msrpDisplay != null && money.usdToDisplay > 0 ? msrpDisplay / money.usdToDisplay : null;

  const prices = visible.flatMap((d) => [d.min, d.max]).filter((n): n is number => n !== null);
  // The reference line is inside the axis range or it silently vanishes off the
  // top or bottom, which is worse than not drawing it.
  if (msrpAxis != null) prices.push(msrpAxis);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * 0.12, 2);

  // What the line means, said once above the chart rather than left to the
  // tooltip — most readers never hover.
  const basis = visible.length > 0 ? visible[visible.length - 1].basis : "asking";

  // Too few points for a line or a band to have any extent. History starts the
  // day a figure is first listed, so this is every figure for the first while.
  const sparse = visible.length < 3;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {RANGE_OPTIONS.filter((r) => r.days <= maxDays + 30).map((r) => (
          <button
            key={r.days}
            type="button"
            onClick={() => setRange(r.days)}
            data-active={range === r.days}
            className="term-item border border-border px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-muted"
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Said in words above the chart, not only in the tooltip. A line on a
          price chart is read as "what it sold for" by default, and for every
          figure on this site that would be wrong. */}
      <p className="mb-3 text-xs text-muted">
        {basis === "sold"
          ? "Median sold price, with the daily range behind it."
          : "Median asking price across active listings, with the daily range behind it. Nobody has to accept an asking price, so read it as what sellers want rather than what the figure is worth."}
        {msrpDisplay != null
          ? ` The dashed line is the original price, ${formatCurrency(msrpDisplay, money.currency)}.`
          : ""}
      </p>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.06} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={40}
              tickFormatter={(v: string) =>
                parseDay(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
            />
            <YAxis
              domain={[Math.max(0, lo - pad), hi + pad]}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => formatMoney(v, money, { compact: true })}
            />
            <Tooltip content={<PriceTooltip money={money} />} />

            <Area
              type="linear"
              dataKey="band"
              stroke="none"
              fill="url(#bandFill)"
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="linear"
              dataKey="median"
              stroke="var(--accent)"
              strokeWidth={2}
              /* A line through one point draws nothing. History starts the day
                 a figure is first listed, so for a while every figure has
                 exactly one — and an empty chart reads as "no data" when the
                 truth is "one day so far". Dots until there are enough points
                 to make a line. */
              dot={sparse ? { fill: "var(--accent)", r: 3 } : false}
              activeDot={<SquareDot />}
              isAnimationActive={false}
            >
              {sparse && (
                /* The shaded band needs two points to have any width, so with
                   one day of history the range is invisible — and the range is
                   the more important half of an asking price. A whisker shows
                   it at a single point: what the cheapest and dearest listing
                   wanted, not just the middle. */
                <ErrorBar
                  dataKey="spread"
                  /* Muted and hairline. The range is context for the median,
                     not a rival to it — drawn in the accent at full weight it
                     read as the subject of the chart. */
                  stroke="var(--muted)"
                  strokeWidth={1}
                  width={4}
                  direction="y"
                  isAnimationActive={false}
                />
              )}
            </Line>
            {msrpAxis != null && msrpDisplay != null && (
              /* Flat, dashed, and unconnected to the series on purpose. It is
                 the price the manufacturer set at release — a different market,
                 in a different decade — and it earns its place as context for
                 the level, never as the first point of a trend. */
              <ReferenceLine
                y={msrpAxis}
                /* The signal red the header's status strip uses. It is the
                   one lit colour on the site, and this is the one line here
                   that is not an observation of the market — being told apart
                   at a glance is the whole job. Not --alert, which stays
                   unspent for the places that mean it. */
                stroke="var(--signal)"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: `original price, ${formatCurrency(msrpDisplay, money.currency)}`,
                  position: "insideTopLeft",
                  fill: "var(--signal)",
                  fontSize: 10,
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * The marker under the cursor. Recharts draws a circle by default, which would
 * be the only round thing left on the site — this is the same filled square the
 * section bars and list markers use, centred on the point.
 */
function SquareDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <rect
      x={cx - 3.5}
      y={cy - 3.5}
      width={7}
      height={7}
      fill="var(--accent)"
      stroke="var(--background)"
      strokeWidth={1.5}
    />
  );
}

type TooltipPayload = { payload: PricePoint & { band: [number, number] | null } };

function PriceTooltip({
  active,
  payload,
  money,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  // Recharts clones this element and injects `active`/`payload`; `money` is
  // whatever we passed when constructing it.
  money: DisplayMoney;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;

  return (
    <div className="term-panel px-3 py-2 text-xs">
      <p className="mb-1 font-medium">
        {parseDay(p.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>
      <dl className="space-y-0.5">
        <Row
          label={p.basis === "sold" ? "Median sold" : "Median asking"}
          value={formatMoney(p.median, money)}
          strong
        />
        <Row
          label="Range"
          value={`${formatMoney(p.min, money)} – ${formatMoney(p.max, money)}`}
        />
        <Row label={p.basis === "sold" ? "Sales" : "Listings"} value={String(p.volume)} />
      </dl>
      {p.volume <= 2 && (
        <p className="mt-1.5 max-w-[11rem] text-[10px] leading-tight text-muted">
          {p.basis === "sold"
            ? "Few sales that day — treat this point as noisy."
            : "Few listings that day — treat this point as noisy."}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("tabular", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
