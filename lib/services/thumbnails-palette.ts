import {
  WCAG_AA_CONTRAST,
  type ThumbnailBrief,
} from "@/lib/validation/thumbnails";

// Pure colour-science + diversity helpers for Stage 9. Kept free of server-only
// imports so they're directly unit-testable (WCAG-AA contrast is a verification
// item). Full ΔE2000 trigger-cousin matching is deferred — see TODO below.
// TODO(phase-2): ΔE2000 < 15 cousin-matching so a curiosity brief's accent
// can't collide with the brand-red used for the fear hook (spec §5.5).

export function wordCountOf(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelLinear(r) +
    0.7152 * channelLinear(g) +
    0.0722 * channelLinear(b)
  );
}

// WCAG 2.x contrast ratio in [1, 21].
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function backgroundHex(brief: ThumbnailBrief): string {
  return (
    brief.palette.find((p) => p.role === "background")?.hex ??
    brief.palette[0]!.hex
  );
}

export type ContrastResult = {
  brief: ThumbnailBrief;
  fixed: boolean; // overlay color was swapped
  passed: boolean; // final ratio meets WCAG-AA
};

// Ensure the overlay text reads against the background. If the model's chosen
// color falls below WCAG-AA, swap it for the highest-contrast non-background
// swatch. `passed` is false when even the best swatch can't clear the bar
// (caller raises flags.paletteContrastFail).
export function enforceOverlayContrast(brief: ThumbnailBrief): ContrastResult {
  const bg = backgroundHex(brief);
  const current = contrastRatio(brief.overlayText.color, bg);
  if (current >= WCAG_AA_CONTRAST) {
    return { brief, fixed: false, passed: true };
  }

  const best = brief.palette
    .filter((p) => p.role !== "background")
    .map((p) => ({ hex: p.hex, ratio: contrastRatio(p.hex, bg) }))
    .sort((a, b) => b.ratio - a.ratio)[0];

  if (!best || best.hex === brief.overlayText.color) {
    return { brief, fixed: false, passed: best ? best.ratio >= WCAG_AA_CONTRAST : false };
  }

  return {
    brief: {
      ...brief,
      overlayText: { ...brief.overlayText, color: best.hex },
    },
    fixed: true,
    passed: best.ratio >= WCAG_AA_CONTRAST,
  };
}

// Two briefs collide when they share a character placement and ≥3 of 4 palette
// colours — used to flag low diversity across the trigger set.
export function briefsCollide(a: ThumbnailBrief, b: ThumbnailBrief): boolean {
  if (a.characterPlacement !== b.characterPlacement) return false;
  const setA = new Set(a.palette.map((p) => p.hex));
  const overlap = b.palette.filter((p) => setA.has(p.hex)).length;
  return overlap >= 3;
}

export function anyBriefsCollide(briefs: ThumbnailBrief[]): boolean {
  for (let i = 0; i < briefs.length; i++) {
    for (let j = i + 1; j < briefs.length; j++) {
      if (briefsCollide(briefs[i]!, briefs[j]!)) return true;
    }
  }
  return false;
}
