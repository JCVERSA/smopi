/**
 * SmopiAvatar — an interactive, art-directed AI avatar.
 *
 * Rendering is deliberately dumb: every `<g>` here is a passive socket that
 * receives transforms from the motion rig (`useSmopiRig`). That separation keeps
 * animation state, interaction logic and drawing completely independent, and
 * means the component never re-renders while it animates.
 */

import { motion, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { GEO, RIG_ORIGIN, VIEWBOX } from "./geometry";
import "./smopi.css";
import {
  DEFAULT_STATUS_LABEL,
  resolveSize,
  type SmopiAvatarProps,
  type SmopiStatus,
} from "./types";
import { useSmopiRig } from "./useSmopiRig";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function SmopiAvatar({
  status = "idle",
  size = "md",
  animated = true,
  className,
  label = "Smopi AI assistant",
  caption,
  theme = "auto",
  shadow = true,
  statusLabel,
  reducedMotion,
  onClick,
}: SmopiAvatarProps) {
  const systemReduced = useReducedMotion();
  const reduced = reducedMotion ?? systemReduced ?? false;

  const { rig, poke } = useSmopiRig(status, animated, reduced);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const px = resolveSize(size);

  // ── grounding: the contact shadow reads the shell's height (inverse) ──────
  const shadowOpacity = useTransform(rig.rigY, [-4, 0, 4], [0.5, 0.9, 0.66]);
  const shadowScale = useTransform(rig.rigY, [-4, 4], [0.9, 1.06]);
  const eyeOpacity = useTransform(rig.eyeDim, (v) => 1 - v);

  // ── one-shot completion / fault signal ────────────────────────────────────
  const [pulse, setPulse] = useState(0);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (animated && !reduced) setPulse((n) => n + 1);
  }, [status, animated, reduced]);

  const labels: Record<SmopiStatus, string> = {
    ...DEFAULT_STATUS_LABEL,
    ...(statusLabel ?? {}),
  };
  const statusText = labels[status];

  return (
    <span
      className={["smopi", className].filter(Boolean).join(" ")}
      data-status={status}
      data-theme={theme === "auto" ? undefined : theme}
      data-size={typeof size === "number" ? (px < 36 ? "sm" : "md") : size}
      onPointerEnter={poke}
      onFocus={poke}
      onClick={(e) => {
        poke();
        onClick?.(e);
      }}
      tabIndex={-1}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {label} {statusText}
      </span>

      <svg
        className="smopi__svg"
        width={px}
        height={px}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        role="img"
        aria-label={`${label} — ${statusText}`}
      >
        <defs>
          {/* shell: blue → indigo → violet, lit from the upper left */}
          <linearGradient id={`${uid}shell`} x1="0.16" y1="0" x2="0.86" y2="1">
            <stop offset="0" style={{ stopColor: "var(--smopi-shell-1)" }} />
            <stop offset="0.48" style={{ stopColor: "var(--smopi-shell-2)" }} />
            <stop offset="1" style={{ stopColor: "var(--smopi-shell-3)" }} />
          </linearGradient>

          <linearGradient id={`${uid}rim`} x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0" style={{ stopColor: "var(--smopi-rim-a)" }} />
            <stop offset="0.55" style={{ stopColor: "var(--smopi-rim-b)" }} />
            <stop offset="1" stopColor="rgba(255,255,255,0.16)" />
          </linearGradient>

          <linearGradient id={`${uid}face`} x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0" style={{ stopColor: "var(--smopi-face-1)" }} />
            <stop offset="1" style={{ stopColor: "var(--smopi-face-2)" }} />
          </linearGradient>

          {/* fixed specular highlight — a depth cue that rides with the shell */}
          <radialGradient id={`${uid}spec`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: "var(--smopi-sheen-a)" }} />
            <stop offset="1" style={{ stopColor: "var(--smopi-sheen-b)" }} />
          </radialGradient>

          <radialGradient id={`${uid}aura`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: "var(--smopi-aura-a)" }} />
            <stop offset="0.45" style={{ stopColor: "var(--smopi-aura-b)" }} />
            <stop offset="1" style={{ stopColor: "var(--smopi-aura-c)" }} />
          </radialGradient>

          {/* soft band used as a halo around the character */}
          <radialGradient id={`${uid}halo`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.7" style={{ stopColor: "var(--smopi-aura-c)" }} />
            <stop offset="0.87" style={{ stopColor: "var(--smopi-halo)" }} />
            <stop offset="1" style={{ stopColor: "var(--smopi-aura-c)" }} />
          </radialGradient>

          {/* orbiting ambient light inside the glow */}
          <linearGradient id={`${uid}sweep`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--smopi-aura-c)" }} />
            <stop offset="0.42" style={{ stopColor: "var(--smopi-aura-b)" }} />
            <stop offset="0.5" style={{ stopColor: "var(--smopi-aura-a)" }} />
            <stop offset="0.58" style={{ stopColor: "var(--smopi-aura-b)" }} />
            <stop offset="1" style={{ stopColor: "var(--smopi-aura-c)" }} />
          </linearGradient>

          <radialGradient id={`${uid}ball`} cx="0.34" cy="0.3" r="0.75">
            <stop offset="0" style={{ stopColor: "var(--smopi-ball-1)" }} />
            <stop offset="0.55" style={{ stopColor: "var(--smopi-ball-2)" }} />
            <stop offset="1" style={{ stopColor: "var(--smopi-shell-3)" }} />
          </radialGradient>

          <radialGradient id={`${uid}eye`} cx="0.5" cy="0.42" r="0.7">
            <stop offset="0" style={{ stopColor: "var(--smopi-eye-1)" }} />
            <stop offset="1" style={{ stopColor: "var(--smopi-eye-2)" }} />
          </radialGradient>

          <radialGradient id={`${uid}eyeHalo`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="rgba(226,236,255,0.75)" />
            <stop offset="0.45" stopColor="rgba(178,198,255,0.28)" />
            <stop offset="1" stopColor="rgba(150,175,255,0)" />
          </radialGradient>

          <radialGradient id={`${uid}shadow`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: "var(--smopi-shadow)" }} />
            <stop offset="0.6" style={{ stopColor: "var(--smopi-shadow)" }} />
            <stop offset="1" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        {/* ── activity aura ─────────────────────────────────────────────── */}
        <g aria-hidden="true">
          <motion.ellipse
            className="smopi__aura"
            cx={GEO.aura.cx}
            cy={GEO.aura.cy}
            rx={GEO.aura.rx}
            ry={GEO.aura.ry}
            fill={`url(#${uid}aura)`}
            style={{ opacity: rig.auraOpacity, scale: rig.auraScale }}
          />
          <motion.ellipse
            className="smopi__sheen"
            cx={GEO.aura.cx}
            cy={GEO.aura.cy}
            rx={GEO.aura.rx * 0.98}
            ry={GEO.aura.ry * 0.98}
            fill={`url(#${uid}sweep)`}
            style={{ opacity: rig.sheenOpacity, rotate: rig.sheenAngle }}
          />
          <motion.ellipse
            className="smopi__halo"
            cx={GEO.halo.cx}
            cy={GEO.halo.cy}
            rx={GEO.halo.rx}
            ry={GEO.halo.ry}
            fill={`url(#${uid}halo)`}
            style={{ opacity: rig.haloOpacity, scale: rig.auraScale }}
          />
        </g>

        {/* ── contact shadow (reads height, stays on the ground) ─────────── */}
        {shadow && (
          <motion.ellipse
            className="smopi__shadow"
            cx={60}
            cy={112}
            rx={26}
            ry={4.4}
            fill={`url(#${uid}shadow)`}
            style={{ opacity: shadowOpacity, scaleX: shadowScale, scaleY: shadowScale }}
          />
        )}

        {/* ── the character ──────────────────────────────────────────────── */}
        <motion.g
          className="smopi__rig"
          style={{ x: rig.rigX, y: rig.rigY, rotate: rig.rigR, scale: rig.rigS }}
        >
          {/* antenna — a soft pendulum that lags the shell */}
          <motion.g
            className="smopi__antenna"
            style={{ rotate: rig.antR }}
            aria-hidden="true"
          >
            <rect
              x={GEO.antenna.stem.x}
              y={GEO.antenna.stem.y}
              width={GEO.antenna.stem.w}
              height={GEO.antenna.stem.h}
              rx={GEO.antenna.stem.rx}
              fill={`url(#${uid}shell)`}
            />
            <motion.circle
              className="smopi__ball"
              cx={GEO.antenna.ball.cx}
              cy={GEO.antenna.ball.cy}
              r={GEO.antenna.ball.r}
              fill={`url(#${uid}ball)`}
              style={{ scale: rig.antScale, opacity: rig.antGlow }}
            />
          </motion.g>

          {/* shell */}
          <g aria-hidden="true">
            <rect
              x={GEO.podL.x}
              y={GEO.podL.y}
              width={GEO.podL.w}
              height={GEO.podL.h}
              rx={GEO.podL.rx}
              fill={`url(#${uid}shell)`}
              opacity={0.92}
            />
            <rect
              x={GEO.podR.x}
              y={GEO.podR.y}
              width={GEO.podR.w}
              height={GEO.podR.h}
              rx={GEO.podR.rx}
              fill={`url(#${uid}shell)`}
              opacity={0.92}
            />
            <rect
              x={GEO.shell.x}
              y={GEO.shell.y}
              width={GEO.shell.w}
              height={GEO.shell.h}
              rx={GEO.shell.rx}
              fill={`url(#${uid}shell)`}
            />
            {/* rim light */}
            <rect
              x={GEO.shell.x + 1.1}
              y={GEO.shell.y + 1.1}
              width={GEO.shell.w - 2.2}
              height={GEO.shell.h - 2.2}
              rx={GEO.shell.rx - 1.1}
              fill="none"
              stroke={`url(#${uid}rim)`}
              strokeWidth={1.5}
              opacity={0.75}
            />
            {/* specular */}
            <ellipse
              cx={GEO.shell.x + GEO.shell.w * 0.34}
              cy={GEO.shell.y + GEO.shell.h * 0.19}
              rx={GEO.shell.w * 0.3}
              ry={GEO.shell.h * 0.16}
              fill={`url(#${uid}spec)`}
              opacity={0.34}
            />
          </g>

          {/* face — trails the shell for real secondary motion */}
          <motion.g
            className="smopi__face"
            style={{ x: rig.faceX, y: rig.faceY, rotate: rig.faceR }}
          >
            <rect
              x={GEO.face.x}
              y={GEO.face.y}
              width={GEO.face.w}
              height={GEO.face.h}
              rx={GEO.face.rx}
              fill={`url(#${uid}face)`}
            />
            {/* inner rim on the visor */}
            <rect
              x={GEO.face.x + 0.8}
              y={GEO.face.y + 0.8}
              width={GEO.face.w - 1.6}
              height={GEO.face.h - 1.6}
              rx={GEO.face.rx - 0.8}
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={1}
            />

            <motion.g
              className="smopi__eye"
              style={{ x: rig.eyeLX, y: rig.eyeLY, scaleY: rig.eyeLSy, rotate: rig.eyeLR }}
            >
              <motion.ellipse
                cx={GEO.eye.lx + GEO.eye.w / 2}
                cy={GEO.eye.y + GEO.eye.h / 2}
                rx={12}
                ry={10}
                fill={`url(#${uid}eyeHalo)`}
                style={{ opacity: rig.eyeHalo }}
              />
              <motion.rect
                x={GEO.eye.lx}
                y={GEO.eye.y}
                width={GEO.eye.w}
                height={GEO.eye.h}
                rx={GEO.eye.rx}
                fill={`url(#${uid}eye)`}
                style={{ opacity: eyeOpacity }}
              />
            </motion.g>

            <motion.g
              className="smopi__eye"
              style={{ x: rig.eyeRX, y: rig.eyeRY, scaleY: rig.eyeRSy, rotate: rig.eyeRR }}
            >
              <motion.ellipse
                cx={GEO.eye.rxX + GEO.eye.w / 2}
                cy={GEO.eye.y + GEO.eye.h / 2}
                rx={12}
                ry={10}
                fill={`url(#${uid}eyeHalo)`}
                style={{ opacity: rig.eyeHalo }}
              />
              <motion.rect
                x={GEO.eye.rxX}
                y={GEO.eye.y}
                width={GEO.eye.w}
                height={GEO.eye.h}
                rx={GEO.eye.rx}
                fill={`url(#${uid}eye)`}
                style={{ opacity: eyeOpacity }}
              />
            </motion.g>
          </motion.g>
        </motion.g>

        {/* ── one-shot signal ring (emitted, so it ignores the rig) ───────── */}
        {pulse > 0 && (
          <motion.rect
            key={pulse}
            className="smopi__ring"
            x={GEO.shell.x}
            y={GEO.shell.y}
            width={GEO.shell.w}
            height={GEO.shell.h}
            rx={GEO.shell.rx}
            fill="none"
            strokeWidth={2.2}
            initial={{ opacity: 0.62, scale: 0.92 }}
            animate={{ opacity: 0, scale: 1.42 }}
            transition={{ duration: 1, ease: EASE_OUT }}
            style={{ stroke: "var(--smopi-ring)", pointerEvents: "none" }}
          />
        )}
      </svg>

      {caption && <span className="smopi__caption">{caption}</span>}
    </span>
  );
}

export { RIG_ORIGIN };
export default SmopiAvatar;
