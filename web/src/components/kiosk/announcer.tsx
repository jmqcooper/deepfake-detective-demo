"use client";

import { useEffect, useState } from "react";

/**
 * One pair of live regions for the whole kiosk.
 *
 * Almost everything that matters here happens *to* the visitor rather than in
 * response to a keystroke: a verdict stamps itself, a beat reveals the
 * evidence, a clip fails to play, the machine steps down a rung. None of that
 * reached anyone using a screen reader.
 *
 * Announcements are pushed through a module-level store rather than context so
 * a station deep in the tree can speak without every component between it and
 * the root learning about it. Politeness is a real distinction: "case 3 of 5"
 * is polite, "that sound did not play" is assertive, because the second one
 * invalidates whatever the visitor was about to do.
 */

export type Politeness = "polite" | "assertive";

type Listener = (message: string) => void;

const listeners: Record<Politeness, Set<Listener>> = {
  polite: new Set(),
  assertive: new Set(),
};

/**
 * An identical string written into a live region twice is usually not
 * re-announced. Two identical failures in a row must both be heard, so an
 * alternating zero-width space makes consecutive messages distinct without
 * changing a single spoken word.
 */
const ZERO_WIDTH_SPACE = "​";
let sequence = 0;

export function announce(message: string, politeness: Politeness = "polite"): void {
  if (!message) return;
  sequence += 1;
  const distinct = message + (sequence % 2 === 0 ? ZERO_WIDTH_SPACE : "");
  for (const listener of listeners[politeness]) {
    listener(distinct);
  }
}

function useAnnouncements(politeness: Politeness): string {
  const [message, setMessage] = useState("");
  useEffect(() => {
    const listener: Listener = (next) => setMessage(next);
    listeners[politeness].add(listener);
    return () => {
      listeners[politeness].delete(listener);
    };
  }, [politeness]);
  return message;
}

function Region({ politeness }: { politeness: Politeness }) {
  const message = useAnnouncements(politeness);
  return (
    <p
      className="sr-only"
      // `alert` carries an implicit assertive live region; `status` a polite
      // one. Setting the matching role as well as aria-live is what makes this
      // behave the same across screen readers.
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-atomic="true"
    >
      {message}
    </p>
  );
}

export function Announcer() {
  return (
    <>
      <Region politeness="polite" />
      <Region politeness="assertive" />
    </>
  );
}

/** Announces `message` whenever it changes to a non-empty value. */
export function useAnnounce(message: string, politeness: Politeness = "polite"): void {
  useEffect(() => {
    if (message) announce(message, politeness);
  }, [message, politeness]);
}
