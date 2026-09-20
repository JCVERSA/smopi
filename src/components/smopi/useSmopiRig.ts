/**
 * Smopi motion rig.
 * ────────────────────────────────────────────────────────────────────────────
 * The whole character is driven by ONE requestAnimationFrame callback that
 * writes straight into MotionValues. Nothing here triggers a React re-render,
 * so the avatar can sit inside a chat message list without ever costing the
 * application a render.
 *
 * Motion model
 *   signal(t)   layered sinusoids at mutually irrational frequency ratios
 *               → the composite NEVER exactly repeats, so there is no loop
 *               point, no reset and no perceptible restart, even after minutes.
 *   params       per-state amplitudes, each on its own spring with a different
 *               stiffness → a state change ramps in as a *staggered*
 *               choreography rather than everything starting at once.
 *   pose         per-state identity (head tilt, eye shape) on near-critical
 *               springs → soft, settle-free transitions. Pose is never gated by
 *               `prefers-reduced-motion`, so state identity survives it.
 *   followers    the face and antenna are springs that chase the shell, giving
 *               genuine secondary motion / follow-through derived from real
 *               relative displacement — not a hand-authored delay.
 *   impulses     springs resting at 0 that receive a velocity kick on state
 *               change → one-shot anticipation + settle reactions.
 *
 * Gating
 *   `m` scales *movement and periodic modulation*. Static, state-dependent
 *   luminance (aura level, eye glow, antenna brightness) is deliberately NOT
 *   scaled by `m`, so reduced-motion users still get a clear visual distinction
 *   between idle / thinking / success / error without any repetitive motion.
 */

import { useAnimationFrame, useMotionValue, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import type { SmopiStatus } from "./types";

const TAU = Math.PI * 2;

/* ── signals ──────────────────────────────────────────────────────────────── */

// Frequency ratios are mutually irrational, so their sum never repeats.
const W1 = TAU * 0.171;
const W2 = TAU * 0.2837;
const W3 = TAU * 0.0671;

/** Organic, never-repeating drift in roughly [-1, 1]. `s` seeds the phase. */
function drift(t: number, s: number): number {
  return (
    Math.sin(W1 * t + s) * 0.5 +
    Math.sin(W2 * t + s * 1.7 + 1.3) * 0.31 +
    Math.sin(W3 * t + s * 0.6 + 2.4) * 0.19
  );
}

/** Slow, calm breath (~6.4s). */
function breath(t: number): number {
  return Math.sin(TAU * 0.157 * t + 0.4);
}

/**
 * Soft, rounded swell used for the "cognitive" rhythm while thinking.
 * Positive lobe only, shaped with a power curve → gentle attack, longer
 * release and a quiet gap between beats. Reads as cadence, not as a spinner.
 */
function swell(t: number, hz: number, phase = 0): number {
  const x = Math.sin(TAU * hz * t + phase);
  return x <= 0 ? 0 : Math.pow(x, 1.55);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/* ── spring ───────────────────────────────────────────────────────────────── */

/** Minimal, allocation-free 1D spring (semi-implicit, sub-stepped). */
class Spring {
  value: number;
  target: number;
  velocity = 0;
  constructor(
    private stiffness: number,
    private damping: number,
    initial = 0,
  ) {
    this.value = initial;
    this.target = initial;
  }
  get settled() {
    return (
      Math.abs(this.value - this.target) < 1e-4 && Math.abs(this.velocity) < 2e-3
    );
  }
  step(dt: number): number {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a =
        -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

/* ── per-state choreography ───────────────────────────────────────────────── */

const PARAM_KEYS = [
  "float",
  "sway",
  "tilt",
  "breathe",
  "gaze",
  "eyeGlow",
  "aura",
  "ball",
  "pulse",
  "blinkRate",
  "sheen",
] as const;
type ParamKey = (typeof PARAM_KEYS)[number];

/** [stiffness, damping] — damping ratios sit just under 1 for a soft overshoot. */
const PARAM_SPRING: Record<ParamKey, readonly [number, number]> = {
  float: [44, 13],
  sway: [36, 12],
  tilt: [50, 14],
  breathe: [28, 11],
  gaze: [72, 17],
  eyeGlow: [58, 15],
  aura: [24, 9.5], // slowest ramp → the aura blooms last
  ball: [40, 12],
  pulse: [34, 12],
  blinkRate: [20, 9],
  sheen: [30, 11],
};

/** Movement amplitudes per state (viewBox units / degrees). */
const STATE_PARAMS: Record<SmopiStatus, Record<ParamKey, number>> = {
  idle: {
    float: 1.1,
    sway: 0.6,
    tilt: 0.55,
    breathe: 0.85,
    gaze: 0.45,
    eyeGlow: 0.45,
    aura: 0.32,
    ball: 0.32,
    pulse: 0,
    blinkRate: 7.5,
    sheen: 0.3,
  },
  thinking: {
    float: 3.2,
    sway: 1.8,
    tilt: 1.4,
    breathe: 1.5,
    gaze: 1.85,
    eyeGlow: 1,
    aura: 0.85,
    ball: 1,
    pulse: 1,
    blinkRate: 3.2,
    sheen: 1,
  },
  success: {
    float: 1.5,
    sway: 0.85,
    tilt: 0.7,
    breathe: 1.05,
    gaze: 0.95,
    eyeGlow: 0.85,
    aura: 0.68,
    ball: 0.74,
    pulse: 0.18,
    blinkRate: 6,
    sheen: 0.75,
  },
  error: {
    float: 0.85,
    sway: 0.5,
    tilt: 0.5,
    breathe: 0.75,
    gaze: 0.55,
    eyeGlow: 0.3,
    aura: 0.48,
    ball: 0.24,
    pulse: 0,
    blinkRate: 3.6,
    sheen: 0.45,
  },
};

const POSE_KEYS = ["tilt", "scale", "eyeY", "eyeSy", "eyeRot", "dim"] as const;
type PoseKey = (typeof POSE_KEYS)[number];

const POSE_SPRING: Record<PoseKey, readonly [number, number]> = {
  tilt: [78, 18],
  scale: [90, 19],
  eyeY: [110, 21],
  eyeSy: [120, 22],
  eyeRot: [95, 20],
  dim: [70, 17],
};

/** State identity: how Smopi *holds itself*, independent of continuous motion. */
const STATE_POSE: Record<SmopiStatus, Record<PoseKey, number>> = {
  idle: { tilt: 0, scale: 1, eyeY: 0, eyeSy: 1, eyeRot: 0, dim: 0 },
  thinking: { tilt: -0.9, scale: 1.004, eyeY: -0.7, eyeSy: 0.965, eyeRot: 0, dim: 0 },
  success: { tilt: 1, scale: 1.012, eyeY: 1.7, eyeSy: 0.55, eyeRot: 0, dim: 0 },
  error: { tilt: -2, scale: 0.996, eyeY: 1.6, eyeSy: 0.86, eyeRot: 6, dim: 0.18 },
};

/* ── rig output ───────────────────────────────────────────────────────────── */

export type SmopiRig = {
  rigX: MotionValue<number>;
  rigY: MotionValue<number>;
  rigR: MotionValue<number>;
  rigS: MotionValue<number>;
  faceX: MotionValue<number>;
  faceY: MotionValue<number>;
  faceR: MotionValue<number>;
  antR: MotionValue<number>;
  antGlow: MotionValue<number>;
  antScale: MotionValue<number>;
  eyeLX: MotionValue<number>;
  eyeLY: MotionValue<number>;
  eyeLSy: MotionValue<number>;
  eyeLR: MotionValue<number>;
  eyeRX: MotionValue<number>;
  eyeRY: MotionValue<number>;
  eyeRSy: MotionValue<number>;
  eyeRR: MotionValue<number>;
  eyeHalo: MotionValue<number>;
  eyeDim: MotionValue<number>;
  auraOpacity: MotionValue<number>;
  auraScale: MotionValue<number>;
  haloOpacity: MotionValue<number>;
  sheenAngle: MotionValue<number>;
  sheenOpacity: MotionValue<number>;
};

/* ── the hook ─────────────────────────────────────────────────────────────── */

export function useSmopiRig(status: SmopiStatus, animated: boolean, reduced: boolean) {
  const rig: SmopiRig = {
    rigX: useMotionValue(0),
    rigY: useMotionValue(0),
    rigR: useMotionValue(0),
    rigS: useMotionValue(1),
    faceX: useMotionValue(0),
    faceY: useMotionValue(0),
    faceR: useMotionValue(0),
    antR: useMotionValue(0),
    antGlow: useMotionValue(0.6),
    antScale: useMotionValue(1),
    eyeLX: useMotionValue(0),
    eyeLY: useMotionValue(0),
    eyeLSy: useMotionValue(1),
    eyeLR: useMotionValue(0),
    eyeRX: useMotionValue(0),
    eyeRY: useMotionValue(0),
    eyeRSy: useMotionValue(1),
    eyeRR: useMotionValue(0),
    eyeHalo: useMotionValue(0.18),
    eyeDim: useMotionValue(0),
    auraOpacity: useMotionValue(0.22),
    auraScale: useMotionValue(1),
    haloOpacity: useMotionValue(0.1),
    sheenAngle: useMotionValue(0),
    sheenOpacity: useMotionValue(0.05),
  };

  const s = useRef({
    prevT: -1,
    prevX: 0,
    sheen: 0,
    enabled: true,
    p: {} as Record<ParamKey, Spring>,
    pose: {} as Record<PoseKey, Spring>,
    motion: new Spring(52, 14, 1),
    // followers
    faceFX: new Spring(120, 19),
    faceFY: new Spring(120, 19),
    faceFR: new Spring(120, 19),
    antX: new Spring(150, 13.5),
    // gaze
    gazeX: new Spring(205, 26),
    gazeY: new Spring(205, 26),
    gazeTx: 0,
    gazeTy: 0,
    nextGaze: 0,
    // blink
    blinks: [] as number[],
    nextBlink: 0,
    // one-shot reactions
    hop: new Spring(150, 13),
    hopS: new Spring(190, 15),
    sway: new Spring(110, 12),
    awakeUntil: 0,
    initialised: false,
    lastStatus: status,
  }).current;

  if (!s.initialised) {
    s.initialised = true;
    for (const k of PARAM_KEYS) {
      const [st, d] = PARAM_SPRING[k];
      s.p[k] = new Spring(st, d, STATE_PARAMS[status][k]);
    }
    for (const k of POSE_KEYS) {
      const [st, d] = POSE_SPRING[k];
      s.pose[k] = new Spring(st, d, STATE_POSE[status][k]);
    }
  }

  const motionOn = animated && !reduced;

  // Live values for the frame callback. Keeping them in refs lets the callback
  // stay referentially stable, so Motion never has to resubscribe it on render.
  const live = useRef({ status, motionOn });
  live.current.status = status;
  live.current.motionOn = motionOn;

  // ── state targets + one-shot reactions (velocity kicks, never keyframes) ──
  useEffect(() => {
    const from = s.lastStatus;
    const changed = from !== status;
    s.lastStatus = status;
    for (const k of PARAM_KEYS) s.p[k].target = STATE_PARAMS[status][k];
    for (const k of POSE_KEYS) s.pose[k].target = STATE_POSE[status][k];

    s.enabled = motionOn;
    s.motion.target = motionOn ? 1 : 0;
    if (motionOn) s.awakeUntil = Number.POSITIVE_INFINITY;
    else if (s.awakeUntil === Number.POSITIVE_INFINITY)
      s.awakeUntil = performance.now() + 1500;

    if (!changed || !animated) return;

    if (status === "success" && from !== "success") {
      // anticipation dip → lift → settle
      s.hop.velocity -= 22;
      s.hopS.velocity += 0.34;
    } else if (status === "error" && from !== "error") {
      // two gentle, quickly damped sways — apologetic, never aggressive
      s.sway.velocity -= 9;
    } else if (status === "thinking" && from === "idle") {
      // a small "I'm on it" lift
      s.hop.velocity += 14;
    }
  }, [status, animated, motionOn, s]);

  /**
   * Micro-interaction: a tiny, physical "hey" — the shell is nudged, the
   * antenna swings and Smopi blinks. Pure velocity impulses, so the reaction
   * blends into whatever the character is already doing.
   */
  const poke = useCallback(() => {
    if (!s.enabled) return;
    s.awakeUntil = Number.POSITIVE_INFINITY;
    s.sway.velocity += (Math.random() < 0.5 ? -1 : 1) * 6.5;
    s.hop.velocity += 9;
    s.hopS.velocity += 0.11;
    s.blinks.push(s.prevT + 0.016);
    s.nextBlink = Math.max(s.nextBlink, s.prevT + 1.6);
  }, [s]);

  const onFrame = useCallback(
    (time: number) => {
    const { status, motionOn } = live.current;
    const t = time / 1000;
    let dt = s.prevT < 0 ? 1 / 60 : t - s.prevT;
    s.prevT = t;
    if (dt <= 0) return;
    dt = clamp(dt, 1 / 240, 1 / 24);

    const { p, pose } = s;
    const m = s.motion.step(dt);

    // When motion is fully off we still finish any in-flight pose/param
    // transition (that's a state change, which reduced motion allows) and then
    // park the loop until something happens again.
    const dormant = !motionOn && performance.now() > s.awakeUntil;
    if (dormant) {
      let active = !pose.tilt.settled || !pose.scale.settled || !pose.eyeY.settled ||
        !pose.eyeSy.settled || !pose.eyeRot.settled || !pose.dim.settled;
      if (!active) {
        for (const k of PARAM_KEYS) if (!s.p[k].settled) { active = true; break; }
      }
      if (!active) return;
    }

    for (const k of PARAM_KEYS) p[k].step(dt);
    for (const k of POSE_KEYS) pose[k].step(dt);

    /* ── 1. primary motion: the shell ─────────────────────────────────────── */
    const sx = drift(t, 0);
    const sy = drift(t, 2.1);
    const sr = drift(t, 4.2);

    let x = sx * p.sway.value * m;
    let y = sy * p.float.value * m;
    let r = sr * p.tilt.value * m;
    const s2 = (1 + breath(t) * 0.0075 * p.breathe.value * m) * pose.scale.value;

    /* ── 2. blink (organic scheduler) ─────────────────────────────────────── */
    let blink = 0;
    if (m > 0.01) {
      if (t >= s.nextBlink) {
        const count = Math.random() < 0.2 ? 2 : 1;
        for (let i = 0; i < count; i++) s.blinks.push(t + i * 0.2);
        s.nextBlink = t + (60 / Math.max(p.blinkRate.value, 0.8)) * rand(0.6, 1.45);
      }
      if (s.blinks.length) {
        s.blinks = s.blinks.filter((b) => t - b < 0.42);
        for (const b of s.blinks) {
          const u = clamp((t - b) / 0.135, 0, 1);
          // the lid closes faster than it opens
          const a = u < 0.42 ? u / 0.42 : (1 - u) / 0.58;
          blink = Math.max(blink, Math.pow(clamp(a, 0, 1), 0.85));
        }
      }
    }

    // Follow-through: the shell dips a hair as the lid falls.
    y += blink * 0.4 * m;

    /* ── 3. one-shot reaction springs ─────────────────────────────────────── */
    const hop = s.hop.step(dt);
    const hopS = s.hopS.step(dt);
    const sway = s.sway.step(dt);
    y += hop * m;
    r += sway * m;

    const totalR = r + pose.tilt.value;
    const totalS = s2 * (1 + hopS * m);

    rig.rigX.set(x);
    rig.rigY.set(y);
    rig.rigR.set(totalR);
    rig.rigS.set(totalS);

    /* ── 4. secondary motion: the face chases the shell ───────────────────── */
    s.faceFX.target = x;
    s.faceFY.target = y;
    s.faceFR.target = totalR;
    rig.faceX.set((s.faceFX.step(dt) - x) * 1.25);
    rig.faceY.set((s.faceFY.step(dt) - y) * 1.2);
    rig.faceR.set((s.faceFR.step(dt) - totalR) * 0.85);

    /* ── 5. antenna: a soft pendulum lagging the shell ────────────────────── */
    s.antX.target = x;
    const antLag = s.antX.step(dt) - x;
    const velX = (x - s.prevX) / dt;
    s.prevX = x;
    const pulse = swell(t, 0.46) * p.pulse.value * m;
    rig.antR.set(
      clamp(-(antLag * 2.7 + velX * 0.4) - totalR * 0.45 + pulse * 0.55, -7.5, 7.5),
    );
    rig.antGlow.set(0.55 + 0.25 * p.ball.value + 0.32 * p.ball.value * pulse);
    rig.antScale.set(1 + 0.07 * p.ball.value * pulse);

    /* ── 6. gaze: slow saccades on a springy path ─────────────────────────── */
    if (m > 0.02 && t >= s.nextGaze) {
      s.gazeTx = rand(-1, 1);
      // while thinking, Smopi glances slightly up-and-away
      s.gazeTy = rand(-0.75, 0.55) + (status === "thinking" ? -0.3 : 0.05);
      s.nextGaze = t + rand(2.9, 6.4) * (status === "thinking" ? 0.6 : 1);
    }
    s.gazeX.target = s.gazeTx * 1.55 * p.gaze.value * m;
    s.gazeY.target = s.gazeTy * 1.15 * p.gaze.value * m;
    const gx = s.gazeX.step(dt) + drift(t, 5.3) * 0.16 * m;
    const gy = s.gazeY.step(dt) + drift(t, 7.9) * 0.12 * m;

    // focus breathing: the eyes converge a touch with the cognitive rhythm
    const converge = drift(t, 9.7) * 0.45 * p.pulse.value * m;

    const lid = 1 - 0.955 * blink;
    rig.eyeLX.set(gx - converge * 0.34 + drift(t, 11.3) * 0.18 * m);
    rig.eyeRX.set(gx + converge * 0.34 + drift(t, 13.1) * 0.18 * m);
    rig.eyeLY.set(gy + pose.eyeY.value + blink * 1.15);
    rig.eyeRY.set(gy + pose.eyeY.value + blink * 1.15);
    rig.eyeLSy.set(pose.eyeSy.value * lid);
    rig.eyeRSy.set(pose.eyeSy.value * lid);
    rig.eyeLR.set(-pose.eyeRot.value + drift(t, 15.7) * 0.6 * m * p.pulse.value);
    rig.eyeRR.set(pose.eyeRot.value + drift(t, 17.3) * 0.6 * m * p.pulse.value);

    // luminance: a static state cue + a motion-scaled focus beat
    const focus = 0.5 + 0.5 * swell(t, 0.46, 1.15);
    rig.eyeHalo.set(0.13 + 0.12 * p.eyeGlow.value + 0.44 * focus * p.pulse.value * m);
    rig.eyeDim.set(pose.dim.value);

    /* ── 7. aura ──────────────────────────────────────────────────────────── */
    const bloom = swell(t, 0.11);
    rig.auraOpacity.set(p.aura.value * (0.72 + 0.28 * bloom * m));
    rig.auraScale.set(1 + 0.03 * p.aura.value * (bloom - 0.35) * m);
    rig.haloOpacity.set(p.aura.value * (0.3 + 0.2 * m));
    if (m > 0.02) s.sheen += dt * (3.5 + 13 * p.sheen.value);
    rig.sheenAngle.set(s.sheen);
    rig.sheenOpacity.set(0.02 + 0.11 * p.sheen.value * m);
    },
    [s, rig],
  );

  useAnimationFrame(onFrame);

  return { rig, poke };
}
