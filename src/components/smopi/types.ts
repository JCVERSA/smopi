/**
 * Smopi — public types.
 *
 * The component is intentionally backend-agnostic: it only knows about a
 * handful of high level "presence" states. Mapping `isGenerating` from any AI
 * SDK down to `status="thinking"` is a one-liner for the consumer.
 */

export type SmopiStatus = "idle" | "thinking" | "success" | "error";

export type SmopiSize = "xs" | "sm" | "md" | "lg" | "xl" | number;

/** Force a colour rendering context. Defaults to inheriting `.dark` from the DOM. */
export type SmopiTheme = "light" | "dark" | "auto";

export type SmopiAvatarProps = {
  /** Presence / activity state of the agent. Defaults to `"idle"`. */
  status?: SmopiStatus;
  /** Named size or an explicit pixel size. Defaults to `"md"`. */
  size?: SmopiSize;
  /** Master switch for the motion system. Defaults to `true`. */
  animated?: boolean;
  /** Additional classes for the wrapping element. */
  className?: string;
  /** Accessible name of the avatar (status is appended automatically). */
  label?: string;
  /**
   * Short text rendered next to the avatar. Kept opt-in so the avatar stays
   * drop-in for chat headers, message rows and status bars.
   */
  caption?: string;
  /** Overrides the colour context. Defaults to `"auto"`. */
  theme?: SmopiTheme;
  /** Render a very soft contact shadow under the character. Defaults to `true`. */
  shadow?: boolean;
  /** Accessible description of the current status (announced on change). */
  statusLabel?: Partial<Record<SmopiStatus, string>>;
  /** Internal test hook: force reduced motion. */
  reducedMotion?: boolean;
  /** Optional click handler */
  onClick?: (e: React.MouseEvent) => void;
};

/** Normalised named sizes → pixels. */
export const SIZE_MAP: Record<Exclude<SmopiSize, number>, number> = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 64,
  xl: 96,
};

export const DEFAULT_STATUS_LABEL: Record<SmopiStatus, string> = {
  idle: "standing by",
  thinking: "thinking",
  success: "response ready",
  error: "something went wrong",
};

export function resolveSize(size: SmopiSize = "md"): number {
  return typeof size === "number" ? size : SIZE_MAP[size] ?? SIZE_MAP.md;
}
