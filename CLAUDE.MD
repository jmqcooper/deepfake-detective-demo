AGENTS.md has general agent instructions. below are specific claude instructions.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI has really generous limits), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model         | cost | intelligence | taste |
| ------------- | ---- | ------------ | ----- |
| gpt-5.6-sol   | 9    | 8.5          | 8     |
| gpt-5.6-terra | 9    | 8.5          | 8     |
| opus-4.8      | 4    | 7            | 8     |
| fable-5       | 2    | 9            | 9     |

How to apply:

- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > taste > cost.
- gpt-5.6-sol at max reasoning effort is the workhorse: the default delegate for every task fable-5 farms out (clear-spec implementation, data analysis, migrations, investigation). It sits above opus-4.8 and below fable-5 on intelligence, and steers better than gpt-5.5 did.
- Anything user-facing (UI, copy, API design) needs taste ≥ 7 — and user-facing work always needs a review from fable-5
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally gpt-5.6-sol as an extra independent perspective.
- Never use Haiku. Never use sonnet-5.
- Mechanics: gpt-5.6 is only reachable through the Codex CLI — `codex exec` / `codex review` (my ~/.codex/config.toml defaults to gpt-5.6-sol at xhigh reasoning; pass `-m gpt-5.6-terra` for terra). Use the codex-implementation, codex-review, and codex-computer-use skills; for work they don't cover (investigation, data analysis), run `codex exec -s read-only` directly with a self-contained prompt.
- Claude models (opus-4.8, fable-5) run via the Agent/Workflow model parameter.

Using gpt-5.6-sol inside workflows and subagents (the model parameter only takes Claude models, so use a wrapper):

- Spawn a thin Claude wrapper agent with `model: 'opus', effort: 'low'` whose prompt instructs it to write a self-contained codex prompt, run `codex exec` via Bash, and return
