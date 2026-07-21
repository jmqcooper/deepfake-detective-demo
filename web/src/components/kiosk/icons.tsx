"use client";

/** Badge icons — struck into the medal, so they must read at 32px in one colour. */

export function IconBrain({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 3a3 3 0 0 0-3 3 2.5 2.5 0 0 0-1 4.8A3 3 0 0 0 6.5 16 3 3 0 0 0 12 18V5a2 2 0 0 0-3-2ZM15 3a3 3 0 0 1 3 3 2.5 2.5 0 0 1 1 4.8A3 3 0 0 1 17.5 16 3 3 0 0 1 12 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconMagnifier({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="m15.5 15.5 4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconSlider({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 4v16M17 4v16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="7" cy="9" r="2.6" fill="currentColor" />
      <circle cx="17" cy="15" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function IconFactory({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 20V11l5 3V11l5 3V8l6 3.5V20z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M3 20h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconEar({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 9a5 5 0 0 1 10 0c0 3-2.5 4-3.5 5.5S13 19 11 19a2 2 0 0 1-2-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconPhone({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4h3l1.5 4-2 1.5a12 12 0 0 0 5 5L14 12l4 1.5V17a2 2 0 0 1-2.2 2A14 14 0 0 1 3 6.2 2 2 0 0 1 5 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconHandshake({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m3 12 3-3 4 3.5 2-1.5 2 1.5L18 9l3 3-4 5-3-2-2 1.5L10 15l-3 2z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The four codec rungs on Station 3's lever. */
export function IconStudio({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconChat({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconRadio({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="8" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8" cy="14" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 4-6 3M16 12h3M16 16h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
