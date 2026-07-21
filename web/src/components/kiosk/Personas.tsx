"use client";

/**
 * Miko and Echo, drawn rather than emoji'd.
 *
 * Emoji were a placeholder and a bad one: 🎧/🕵️ render as a different character
 * on every OS, carry none of the personality the script leans on, and can't react.
 * These two are built from primitives so they can *respond* — Miko's eyes go wide
 * when he's listening, Echo's lens flares when he finds something.
 *
 * The shape language carries the whole premise:
 *   Miko — a soft circle. Round, open, eager, believes everything.
 *   Echo — a hard shield. Angular, guarded, suspicious of everything.
 * A child reads "trusting" vs "sceptical" from the silhouette alone, before a
 * single word of Dutch.
 */

export type PersonaId = "miko" | "echo";
export type PersonaMood = "idle" | "listening" | "happy" | "alert";

export function Miko({
  size = 96,
  mood = "idle",
  className = "",
  style,
}: {
  size?: number;
  mood?: PersonaMood;
  className?: string;
  style?: React.CSSProperties;
}) {
  const wide = mood === "listening" || mood === "happy";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={style}
      role="img"
      aria-label="Miko"
    >
      <defs>
        <radialGradient id="miko-body" cx="35%" cy="28%">
          <stop offset="0%" stopColor="#ffd98a" />
          <stop offset="100%" stopColor="#f5a623" />
        </radialGradient>
      </defs>

      {/* Headphone band + cups: he is, literally, a pair of ears. Drawn BEHIND the
          head, and sized so the cups clear the 32r circle instead of being
          swallowed by it (which made him read as wearing a helmet). */}
      <path
        d="M16 52a34 34 0 0 1 68 0"
        fill="none"
        stroke="#1e2842"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <rect x="8" y="48" width="15" height="26" rx="7.5" fill="#1e2842" />
      <rect x="77" y="48" width="15" height="26" rx="7.5" fill="#1e2842" />

      <circle cx="50" cy="58" r="30" fill="url(#miko-body)" />

      {/* eyes — they widen when he is actively listening */}
      <ellipse
        cx="39"
        cy={wide ? 51 : 53}
        rx={wide ? 7 : 6}
        ry={wide ? 8.5 : 6}
        fill="#0a0e1c"
        style={{ transition: "all 220ms cubic-bezier(0.2,0,0,1)" }}
      />
      <ellipse
        cx="61"
        cy={wide ? 51 : 53}
        rx={wide ? 7 : 6}
        ry={wide ? 8.5 : 6}
        fill="#0a0e1c"
        style={{ transition: "all 220ms cubic-bezier(0.2,0,0,1)" }}
      />
      <circle cx="41" cy={wide ? 48 : 51} r="2.2" fill="#fff" />
      <circle cx="63" cy={wide ? 48 : 51} r="2.2" fill="#fff" />

      {/* mouth: a cheerful open O when pleased, a small line otherwise */}
      {mood === "happy" ? (
        <ellipse cx="50" cy="70" rx="7" ry="8" fill="#0a0e1c" />
      ) : (
        <path
          d="M43 69q7 5 14 0"
          fill="none"
          stroke="#0a0e1c"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function Echo({
  size = 96,
  mood = "idle",
  className = "",
  style,
}: {
  size?: number;
  mood?: PersonaMood;
  className?: string;
  style?: React.CSSProperties;
}) {
  const alert = mood === "alert";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={style}
      role="img"
      aria-label="Agent Echo"
    >
      <defs>
        <linearGradient id="echo-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7ff0e4" />
          <stop offset="100%" stopColor="#14b3a6" />
        </linearGradient>
      </defs>

      {/* a detective's shield — hard shoulders, pointed base */}
      <path
        d="M50 8 86 20v34c0 22-16 34-36 40C30 88 14 76 14 54V20z"
        fill="url(#echo-body)"
        stroke={alert ? "#ff4d6d" : "#0c8a80"}
        strokeWidth={alert ? 4 : 2.5}
        style={{ transition: "stroke 200ms" }}
      />

      {/* brim — reads as a hat, and shades the "eye" like a visor */}
      <path d="M22 40h56l-6-9H28z" fill="#0a0e1c" />
      <rect x="30" y="20" width="40" height="13" rx="4" fill="#0a0e1c" />

      {/* the lens: Echo is one big analytical eye. It flares red on a catch. */}
      <circle
        cx="50"
        cy="58"
        r="16"
        fill="#0a0e1c"
        stroke={alert ? "#ff4d6d" : "#0a0e1c"}
        strokeWidth="3"
      />
      <circle
        cx="50"
        cy="58"
        r="9"
        fill={alert ? "#ff4d6d" : "#7ff0e4"}
        style={{ transition: "fill 200ms" }}
      />
      <circle cx="45" cy="53" r="3" fill="#fff" opacity="0.9" />
      {/* glint across the lens */}
      <path
        d="M40 68q10 6 20 0"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        opacity="0.25"
      />
    </svg>
  );
}

export function Persona({
  who,
  size = 96,
  mood = "idle",
  className = "",
  style,
}: {
  who: PersonaId;
  size?: number;
  mood?: PersonaMood;
  className?: string;
  style?: React.CSSProperties;
}) {
  return who === "miko" ? (
    <Miko size={size} mood={mood} className={className} style={style} />
  ) : (
    <Echo size={size} mood={mood} className={className} style={style} />
  );
}
