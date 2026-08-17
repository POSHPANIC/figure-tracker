import type { CurrencyCode } from "@/lib/currency";

/**
 * A flag for each supported currency.
 *
 * Drawn rather than typed. Flag emoji are regional-indicator pairs, and Windows
 * ships no glyphs for them — Chrome and Edge there render "US" and "JP" as
 * letters instead of flags, which is a large share of desktop visitors seeing
 * something that looks broken. These render the same everywhere.
 *
 * Simplified on purpose: at sixteen pixels wide, the fifty stars of the US flag
 * and the exact counterchange of the Union Jack are noise. Every flag icon set
 * does the same thing. What matters at this size is that the right one is
 * recognisable at a glance, which is colour and gross layout.
 */

/** Evenly spaced dots standing in for stars. */
function Stars({ cx, cy, r, count }: { cx: number; cy: number; r: number; count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={i}
            cx={cx + Math.cos(angle) * r}
            cy={cy + Math.sin(angle) * r}
            r={1.3}
            fill="#FFCC00"
          />
        );
      })}
    </>
  );
}

/** The Union Jack, reused at full size for GB and quarter size for AU. */
function UnionJack() {
  return (
    <>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="3" />
      <path d="M30,0 V30 M0,15 H60" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
    </>
  );
}

const FLAGS: Record<CurrencyCode, React.ReactNode> = {
  USD: (
    <>
      <rect width="60" height="30" fill="#FFFFFF" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} y={(i * 30) / 6.5} width="60" height={30 / 13} fill="#B22234" />
      ))}
      <rect width="24" height="16.2" fill="#3C3B6E" />
      {Array.from({ length: 6 }, (_, i) => (
        <circle
          key={i}
          cx={4 + (i % 3) * 8}
          cy={5 + Math.floor(i / 3) * 6}
          r="1.3"
          fill="#FFFFFF"
        />
      ))}
    </>
  ),
  JPY: (
    <>
      <rect width="60" height="30" fill="#FFFFFF" />
      <circle cx="30" cy="15" r="9" fill="#BC002D" />
    </>
  ),
  EUR: (
    <>
      <rect width="60" height="30" fill="#003399" />
      <Stars cx={30} cy={15} r={9} count={12} />
    </>
  ),
  GBP: <UnionJack />,
  CAD: (
    <>
      <rect width="60" height="30" fill="#FFFFFF" />
      <rect width="15" height="30" fill="#D52B1E" />
      <rect x="45" width="15" height="30" fill="#D52B1E" />
      {/* A maple leaf reduced to its silhouette — three lobes and a stem. */}
      <path
        d="M30 6 L32 12 L36.5 10 L34.5 15 L39 16.5 L34 19 L35 23 L31 21.5 L30 26 L29 21.5 L25 23 L26 19 L21 16.5 L25.5 15 L23.5 10 L28 12 Z"
        fill="#D52B1E"
      />
    </>
  ),
  AUD: (
    <>
      <rect width="60" height="30" fill="#012169" />
      <svg x="0" y="0" width="30" height="15" viewBox="0 0 60 30">
        <UnionJack />
      </svg>
      <circle cx="15" cy="22.5" r="2.2" fill="#FFFFFF" />
      <circle cx="44" cy="8" r="1.6" fill="#FFFFFF" />
      <circle cx="49" cy="15" r="1.6" fill="#FFFFFF" />
      <circle cx="44" cy="22" r="1.6" fill="#FFFFFF" />
      <circle cx="39" cy="16" r="1.3" fill="#FFFFFF" />
    </>
  ),
};

export function CurrencyFlag({
  code,
  className = "",
}: {
  code: CurrencyCode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 60 30"
      // Decorative. The currency code sits right beside it and the select has
      // its own label, so announcing "flag of Japan" would only add noise.
      aria-hidden="true"
      focusable="false"
      className={`inline-block shrink-0 rounded-[1px] ring-1 ring-black/10 ${className}`}
    >
      {FLAGS[code]}
    </svg>
  );
}
