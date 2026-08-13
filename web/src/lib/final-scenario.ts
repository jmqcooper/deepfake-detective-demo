/**
 * The last thing a visitor does, and the only thing they really need to keep.
 *
 * Spotting a spectrogram artefact is a museum trick; it does not transfer to a
 * phone call at dinner time. So the demo ends on the behaviour instead: a voice
 * you know asks for money and asks you to keep it quiet — what do you actually
 * do? The correct answer is the same one every fraud helpline gives, and it
 * does not require you to have heard anything suspicious at all.
 *
 * `reply` is here on purpose. It is the plausible-but-wrong option: answering
 * in the same channel proves nothing, because whoever is on that channel is the
 * thing in question. Getting that wrong is a better lesson than getting it right.
 */

export const FINAL_SCENARIO_CHOICES = ["send", "reply", "callback", "unsure"] as const;

export type FinalScenarioChoice = (typeof FINAL_SCENARIO_CHOICES)[number];

export const FINAL_SCENARIO_CORRECT: FinalScenarioChoice = "callback";

export function isFinalScenarioChoice(value: unknown): value is FinalScenarioChoice {
  return (
    typeof value === "string" &&
    (FINAL_SCENARIO_CHOICES as readonly string[]).includes(value)
  );
}

/** Server-authoritative: the browser sends a choice, never a verdict. */
export function isFinalScenarioCorrect(choice: FinalScenarioChoice): boolean {
  return choice === FINAL_SCENARIO_CORRECT;
}
