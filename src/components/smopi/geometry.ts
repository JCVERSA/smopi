/**
 * Smopi geometry.
 *
 * Everything is expressed on a single 120×120 viewBox with a small set of
 * hand-tuned constants. Keeping the numbers in one place makes the character
 * easy to re-balance (proportions, eye size, antenna length) without touching
 * the render tree, and guarantees every animated part has a stable,
 * predictable transform origin.
 */

export const VIEWBOX = 120;

export const GEO = {
  /** Outer shell — a soft, wide rounded capsule. */
  shell: { x: 20, y: 36, w: 80, h: 68, rx: 27 },
  /** Side pods (ears). Read as "hardware" without adding noise. */
  podL: { x: 12, y: 56, w: 9, h: 24, rx: 4.5 },
  podR: { x: 99, y: 56, w: 9, h: 24, rx: 4.5 },
  /** Dark face capsule. */
  face: { x: 31, y: 50, w: 58, h: 37, rx: 18.5 },
  /** Eyes — rounded rects so they can squash on a blink. */
  eye: { w: 10, h: 13, rx: 5, lx: 43, rxX: 67, y: 62 },
  /** Antenna: stem pivots at its base so it can swing like a soft spring. */
  antenna: {
    stem: { x: 57.2, y: 23, w: 5.6, h: 17, rx: 2.8 },
    ball: { cx: 60, cy: 20.5, r: 5.6 },
    /** Pivot point, in viewBox units. */
    pivot: { x: 60, y: 37 },
  },
  /** Soft activity aura (kept clear of the shell so it reads as ambience). */
  aura: { cx: 60, cy: 69, rx: 51, ry: 47 },
  halo: { cx: 60, cy: 70, rx: 52, ry: 48 },
} as const;

/** Centre of the shell — the rotation/scale origin of the whole rig. */
export const RIG_ORIGIN = { x: 60, y: 70 };

export const eyeCenter = (side: "l" | "r") => ({
  x: (side === "l" ? GEO.eye.lx : GEO.eye.rxX) + GEO.eye.w / 2,
  y: GEO.eye.y + GEO.eye.h / 2,
});
