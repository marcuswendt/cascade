/**
 * Feature flags — Round 32 (2026-08-28): Marcus's own call, "disable for
 * now" (not remove) — "in the end I generate the code with Claude Code
 * and don't write anything anymore... I'd rather have Claude write
 * everything and use Cascade only as UI to setup parameters and render
 * images." Flipping either flag back to true re-enables the feature with
 * no other code changes — see the one call site each flag gates:
 * GraphPanel.svelte's handleNodeEdit (Monaco) and AINode.ts's generate()
 * (the Anthropic/Google/OpenAI client SDK calls).
 */
export const ENABLE_CODE_EDITOR = false;
export const ENABLE_AI_GENERATION = false;
