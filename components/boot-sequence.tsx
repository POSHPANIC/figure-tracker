"use client";

import { useEffect, useRef, useState } from "react";
import { InlineScript } from "./inline-script";
import { SITE_NAME } from "@/lib/site";

/**
 * ============================================================================
 * Boot sequence
 * ============================================================================
 *
 * A short animatic that plays once per session before the terminal resolves.
 *
 * The visual language is borrowed from breakcore visualiser edits: a dark plate
 * with thin red-and-white vector line-art drawn over it — angular polylines
 * that rewrite themselves frame to frame, reticle brackets, and small annotation
 * type that reads like a HUD tracking something in the shot. Everything is
 * generated: there is no footage, no sampled artwork, nothing to license.
 *
 * It is silent, so the rhythm has to come from somewhere else. The whole piece
 * runs off a 174 BPM clock (the tempo the genre actually lives at) and every
 * shot change lands on a sixteenth, which is what makes it read as cut to
 * music that isn't there.
 *
 * ── On flashing ─────────────────────────────────────────────────────────────
 * Sixteenths at 174 BPM is 11.6 Hz, and full-frame luminance changes in the
 * 3–30 Hz band are a genuine photosensitive-seizure trigger. So the cuts change
 * *composition*, never brightness: every shot sits on the same near-black plate,
 * and the single large luminance change in the piece is the final resolve to
 * the page background. That is a real constraint, not a stylistic preference —
 * and it also makes the ending land harder, being the only time it happens.
 *
 * `prefers-reduced-motion` skips the sequence outright.
 */

const BPM = 174;
/** One sixteenth note. Every cut in the piece lands on one of these. */
const STEP_MS = 60000 / BPM / 4;
const STEPS = 24;
const FADE_MS = 320;

const SESSION_KEY = "fi-boot";

/**
 * Runs during HTML parsing, so a returning visitor never sees the overlay at
 * all — not even for the frame it would take React to hydrate and remove it.
 * Reaches its own parent through `document.currentScript`, which avoids having
 * to invent an id and keeps the markup self-contained.
 */
const SKIP_SCRIPT = `(function(){try{
var s=document.currentScript;if(!s)return;var el=s.parentNode;if(!el)return;
if(/[?&]boot=/.test(location.search))return;
var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var seen=false;try{seen=sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})==="1"}catch(e){}
if(reduce||seen){el.style.display="none";el.setAttribute("data-boot-skip","1")}
}catch(e){}})()`;

/**
 * Replay controls, for working on the piece itself.
 *
 * `?boot=1` forces it to play even once the session has seen it — otherwise
 * every tweak means clearing storage by hand. `?boot=slow` stretches the clock
 * six times so an individual shot can actually be looked at; at 174 BPM a shot
 * is 345ms, which is long enough to feel and far too short to judge. Any other
 * number is used as the stretch factor directly, for when six still isn't
 * enough to hold a frame still.
 */
function replayMode(): { force: boolean; scale: number } {
  if (typeof window === "undefined") return { force: false, scale: 1 };
  const value = new URLSearchParams(window.location.search).get("boot");
  if (!value) return { force: false, scale: 1 };
  if (value === "slow") return { force: true, scale: 6 };
  const n = Number(value);
  return { force: true, scale: Number.isFinite(n) && n > 1 ? n : 1 };
}

/* ---------------------------------------------------------------------------
 * Drawing helpers
 * ------------------------------------------------------------------------ */

const PLATE = "#0d0d0b";
const BONE = "#ccc8b1";
const RED = "#c8564a";
const DIM = "#57543f";

/**
 * Deterministic PRNG. The visuals need to look torn and arbitrary while staying
 * identical from frame to frame within a step — `Math.random()` per frame would
 * make every shot boil at 60fps instead of cutting at 11.6 Hz.
 */
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Letterspaced text, drawn per-character so the tracking can be animated. */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number,
) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = cx - total / 2;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i]!, x, y);
    x += widths[i]! + spacing;
  }
}

/** The angular scribble the reference edits are built on. */
function scope(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rand: () => number,
  amp: number,
) {
  const n = 96;
  const mid = h / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    // Mostly a flat line with occasional violent spikes — a waveform reading
    // near-silence punctuated by hits, rather than uniform noise.
    const spike = rand() < 0.14 ? (rand() - 0.5) * h * 0.55 : (rand() - 0.5) * h * 0.05;
    pts.push([(i / (n - 1)) * w, mid + spike * amp]);
  }

  const stroke = (dx: number, dy: number, color: string, alpha: number, width: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
    ctx.stroke();
    ctx.restore();
  };

  // The red ghost sits behind and offset, the way a misaligned channel would.
  stroke(4, -3, RED, 0.85, 1.5);
  stroke(0, 0, BONE, 1, 1.25);
}

/** Reticle brackets easing inward onto a target box. */
function reticle(ctx: CanvasRenderingContext2D, w: number, h: number, p: number) {
  const ease = 1 - Math.pow(1 - p, 3);
  const bw = Math.min(w, h) * 0.34;
  const spread = (1 - ease) * Math.min(w, h) * 0.3;
  const cx = w / 2;
  const cy = h / 2;
  const arm = bw * 0.28;

  ctx.save();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = BONE;
  ctx.lineWidth = 2;
  const corners: [number, number, number, number][] = [
    [cx - bw - spread, cy - bw - spread, 1, 1],
    [cx + bw + spread, cy - bw - spread, -1, 1],
    [cx - bw - spread, cy + bw + spread, 1, -1],
    [cx + bw + spread, cy + bw + spread, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
    ctx.stroke();
  }
  ctx.restore();
}

/** Dense catalogue readout — this is a figure index, so it counts records. */
function indexColumns(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rand: () => number,
  mono: string,
) {
  const size = 11;
  const lh = size * 1.7;
  const colW = 132;
  const cols = Math.ceil(w / colW);
  const rows = Math.ceil(h / lh);

  ctx.save();
  ctx.font = `500 ${size}px ${mono}`;
  ctx.textBaseline = "middle";
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const roll = rand();
      if (roll < 0.35) continue;
      const x = c * colW + 14;
      const y = r * lh + lh / 2;
      const id = Math.floor(rand() * 0xffffff)
        .toString(16)
        .toUpperCase()
        .padStart(6, "0");
      // A few rows invert, the way a selected row does everywhere else on the
      // site — the boot sequence and the UI it resolves into share one grammar.
      if (roll > 0.965) {
        const text = `FI-${id}`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = BONE;
        ctx.fillRect(x - 4, y - size * 0.8, tw + 8, size * 1.6);
        ctx.fillStyle = PLATE;
        ctx.fillText(text, x, y);
      } else {
        ctx.fillStyle = roll > 0.9 ? RED : DIM;
        ctx.globalAlpha = roll > 0.9 ? 0.9 : 0.5;
        ctx.fillText(`FI-${id}`, x, y);
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
}

/**
 * Horizontal band displacement — the frame torn into slices and slid sideways.
 * Reads the canvas back onto itself rather than compositing a second buffer.
 */
function tear(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  rand: () => number,
) {
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    if (rand() < 0.45) continue;
    const y = Math.floor((i / bands) * h);
    const bh = Math.ceil(h / bands);
    const dx = (rand() - 0.5) * w * 0.28;
    ctx.drawImage(canvas, 0, y, w, bh, dx, y, w, bh);
  }
  // A couple of solid bars, like a dropped scanline block.
  for (let i = 0; i < 2; i++) {
    const y = rand() * h;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = RED;
    ctx.fillRect(0, y, w, 2 + rand() * 3);
    ctx.restore();
  }
}

/** Persistent annotation layer — the thing that makes six shots read as one piece. */
function hud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  step: number,
  mono: string,
) {
  const pad = 18;
  ctx.save();
  ctx.font = `500 10px ${mono}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = DIM;

  ctx.fillText(`${SITE_NAME.toUpperCase()} // ARCHIVE TERMINAL`, pad, pad);

  const code = `${String(step).padStart(4, "0")}/${String(STEPS).padStart(4, "0")}`;
  ctx.textAlign = "right";
  ctx.fillText(code, w - pad, pad);
  ctx.textAlign = "left";

  // Progress ticks along the bottom — one per sixteenth, filling as it runs.
  const tickW = 4;
  const gap = 3;
  const x0 = pad;
  const y0 = h - pad - 4;
  for (let i = 0; i < STEPS; i++) {
    ctx.fillStyle = i <= step ? (i === step ? RED : BONE) : DIM;
    ctx.globalAlpha = i <= step ? 1 : 0.35;
    ctx.fillRect(x0 + i * (tickW + gap), y0, tickW, 4);
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = "right";
  ctx.fillStyle = DIM;
  ctx.fillText("[ CLICK TO SKIP ]", w - pad, h - pad - 8);
  ctx.restore();
}

/* ---------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

export function BootSequence() {
  const [done, setDone] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // No "have I already run?" guard here. Strict Mode mounts, tears down and
    // remounts in development, and a ref guard survives that teardown — the
    // first run's cleanup cancels the frame loop, the second run sees the guard
    // and returns, and the overlay sits there forever over a canvas that was
    // sized but never drawn. The cleanup below is the guard: it cancels
    // everything this run started, so re-running the effect is safe.
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const replay = replayMode();

    // The inline script already decided, before paint, that this visitor is not
    // getting a boot sequence. Just take the element out.
    if (!wrap || !canvas || wrap.getAttribute("data-boot-skip") === "1") {
      setDone(true);
      return;
    }

    const stepMs = STEP_MS * replay.scale;
    const runMs = STEPS * stepMs;
    const hardStopMs = runMs + FADE_MS + 2000;

    try {
      if (!replay.force) sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Private browsing with storage disabled. The sequence plays every load
      // rather than once per session, which is a far smaller problem than
      // throwing here would be.
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setDone(true);
      return;
    }

    const cs = getComputedStyle(document.documentElement);
    const mono = `${cs.getPropertyValue("--font-mono-face").trim() || "ui-monospace"}, ui-monospace, monospace`;
    const display = `${cs.getPropertyValue("--font-display-face").trim() || "serif"}, serif`;
    // Read at run time so the hand-off lands on whichever theme is active.
    const pageBg = cs.getPropertyValue("--background").trim() || "#c5c0aa";
    const pageFg = cs.getPropertyValue("--foreground").trim() || "#454138";

    let dpr = 1;
    let w = 0;
    let h = 0;

    function resize() {
      if (!canvas || !ctx) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let finished = false;
    const start = performance.now();

    function finish() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      wrap?.removeEventListener("pointerdown", finish);
      clearTimeout(hardStop);
      if (wrap) {
        wrap.style.transition = `opacity ${FADE_MS}ms linear`;
        wrap.style.opacity = "0";
      }
      window.setTimeout(() => setDone(true), FADE_MS);
    }

    function onKey() {
      finish();
    }

    const hardStop = window.setTimeout(finish, hardStopMs);
    window.addEventListener("keydown", onKey);
    wrap.addEventListener("pointerdown", finish);

    function frame(now: number) {
      if (!ctx || !canvas || finished) return;
      const elapsed = now - start;

      if (elapsed >= runMs) {
        // Resolve. Paint the real page background and snap brackets to the
        // viewport corners, so the fade hands straight over to the live UI.
        ctx.fillStyle = pageBg;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = pageFg;
        ctx.lineWidth = 2;
        const a = 26;
        const m = 16;
        const corners: [number, number, number, number][] = [
          [m, m, 1, 1],
          [w - m, m, -1, 1],
          [m, h - m, 1, -1],
          [w - m, h - m, -1, -1],
        ];
        for (const [x, y, sx, sy] of corners) {
          ctx.beginPath();
          ctx.moveTo(x + sx * a, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y + sy * a);
          ctx.stroke();
        }
        finish();
        return;
      }

      const step = Math.min(STEPS - 1, Math.floor(elapsed / stepMs));
      const shot = Math.floor(step / 4);
      // Progress through the current shot, for the things that ease rather
      // than cut.
      const shotP = (elapsed - shot * 4 * stepMs) / (4 * stepMs);
      // Seeded per step, so the noise holds still between cuts.
      const rand = rng(step + 1);

      ctx.fillStyle = PLATE;
      ctx.fillRect(0, 0, w, h);

      switch (shot) {
        case 0: {
          // CARRIER — almost nothing. A single sweep descending the frame.
          const y = shotP * h;
          ctx.save();
          ctx.strokeStyle = RED;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = RED;
          ctx.fillRect(0, y, w, Math.min(h - y, 120));
          ctx.restore();
          break;
        }
        case 1:
          scope(ctx, w, h, rand, 1);
          break;
        case 2:
          reticle(ctx, w, h, shotP);
          ctx.save();
          ctx.font = `500 10px ${mono}`;
          ctx.fillStyle = RED;
          ctx.textAlign = "center";
          ctx.fillText(
            "ACQUIRING INDEX",
            w / 2 + (rand() - 0.5) * 6,
            h / 2 - Math.min(w, h) * 0.34 - 22,
          );
          ctx.restore();
          break;
        case 3:
          indexColumns(ctx, w, h, rand, mono);
          break;
        case 4:
          // Redraw something worth tearing, then tear it.
          indexColumns(ctx, w, h, rng(99), mono);
          scope(ctx, w, h, rand, 0.6);
          tear(ctx, canvas, w, h, rand);
          break;
        case 5: {
          // MARK — the wordmark assembling, chromatic split collapsing to zero.
          const p = 1 - Math.pow(1 - shotP, 2);
          const size = Math.min(w * 0.075, 74);
          const split = (1 - p) * 26;
          const spacing = size * (0.42 - 0.3 * p);
          ctx.save();
          ctx.font = `400 ${size}px ${display}`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          const name = SITE_NAME.toUpperCase();
          ctx.fillStyle = RED;
          ctx.globalAlpha = 0.9;
          tracked(ctx, name, w / 2 - split, h / 2, spacing);
          ctx.fillStyle = "#5ad0c8";
          tracked(ctx, name, w / 2 + split, h / 2, spacing);
          ctx.globalAlpha = 1;
          ctx.fillStyle = BONE;
          tracked(ctx, name, w / 2, h / 2, spacing);
          ctx.restore();
          break;
        }
      }

      hud(ctx, w, h, step, mono);
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hardStop);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      wrap?.removeEventListener("pointerdown", finish);
    };
  }, []);

  if (done) return null;

  return (
    // Rendered on the server too, so it covers the page from the very first
    // paint rather than appearing once React has hydrated.
    <div ref={wrapRef} className="boot-overlay" aria-hidden suppressHydrationWarning>
      <canvas ref={canvasRef} className="boot-canvas" />
      <InlineScript html={SKIP_SCRIPT} />
    </div>
  );
}
