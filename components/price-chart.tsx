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
} from "recharts";
import type { PricePoint } from "@/lib/queries";
import { formatMoney, type DisplayMoney } from "@/lib/currency";
import { RANGE_OPTIONS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * Price history chart.
 *
 * Shows the median realized sale price as the primary line, with the daily
 * min–max range as a shaded band behind it. The band matters: a single point
 * median hides that a figure traded between $180 and $340 that day, which is
 * exactly what a buyer needs to know.
 */

type Props = {
  data: PricePoint[];
  /** Days of history available; used to hide range buttons we can't fill. */
  maxDays: number;
  /**
   * Snapshots are stored in USD only — averaging across mixed currencies
   * isn't meaningful — so every point on this chart is converted for display.
   */
  money: DisplayMoney;
};

export function PriceChart({ data, maxDays, money }: Props) {
  const [range, setRange] = useState<number>(90);

  const visible = useMemo(() => {
    const cutoff = Date.now() - range * 86400_000;
    return data
      .filter((d) => new Date(d.date).getTime() >= cutoff)
      .map((d) => ({
        ...d,
        // Recharts draws a band when the value is a [low, high] tuple.
        band: d.min !== null && d.max !== null ? ([d.min, d.max] as [number, number]) : null,
      }));
  }, [data, range]);

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border">
        <div className="text-center">
          <p className="font-medium">No price history yet</p>
          <p className="mt-1 text-sm text-muted">
            This figure has no recorded sales for the selected condition.
          </p>
        </div>
      </div>
    );
  }

  const prices = visible.flatMap((d) => [d.min, d.max]).filter((n): n is number => n !== null);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * 0.12, 2);

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
                new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
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
              dot={false}
              activeDot={<SquareDot />}
              isAnimationActive={false}
            />
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
        {new Date(p.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>
      <dl className="space-y-0.5">
        <Row label="Median" value={formatMoney(p.median, money)} strong />
        <Row
          label="Range"
          value={`${formatMoney(p.min, money)} – ${formatMoney(p.max, money)}`}
        />
        <Row label="Sales" value={String(p.volume)} />
      </dl>
      {p.volume <= 2 && (
        <p className="mt-1.5 max-w-[11rem] text-[10px] leading-tight text-muted">
          Few sales that day — treat this point as noisy.
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
