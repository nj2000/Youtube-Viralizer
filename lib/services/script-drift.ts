import "server-only";

import { callHaiku, extractTextFromMessage } from "@/lib/anthropic";
import {
  DRIFT_PASS_THRESHOLD,
  SCRIPT_WPM,
  type ScriptDrift,
  type ScriptSection,
} from "@/lib/validation/script";

// Non-blocking drift check (spec §5.7): two cheap Haiku calls compare the
// locked title's promise against where the early script actually delivers it.
// Returns a 0-100 drift score; ≤40 passes. NEVER throws into the stream — a
// failed check degrades to a neutral pass.

function escapeForXml(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function skeletonTextFromEarlySections(sections: ScriptSection[]): string {
  return sections
    .slice(0, 3)
    .flatMap((s) => s.paragraphs.map((p) => p.text))
    .join(" ")
    .slice(0, 2400);
}

function safeJsonParse(text: string): unknown | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function checkDrift(args: {
  lockedTitle: string;
  sections: ScriptSection[];
}): Promise<ScriptDrift> {
  try {
    // Call 1 — extract the concrete promise from the title.
    const promiseMsg = await callHaiku({
      system:
        "You extract the single concrete promise a YouTube title makes to the viewer. Reply with one short sentence, no preamble.",
      messages: [
        {
          role: "user",
          content: `<title>${escapeForXml(args.lockedTitle.slice(0, 200))}</title>\nWhat specific result does this title promise?`,
        },
      ],
      maxTokens: 80,
    });
    const promise = extractTextFromMessage(promiseMsg).slice(0, 280);
    if (!promise) return { score: 0, problemDescription: null };

    // Call 2 — locate where the early script fulfills the promise.
    const earlyText = skeletonTextFromEarlySections(args.sections);
    const locateMsg = await callHaiku({
      system:
        'You judge whether a script delivers on its title promise early enough. Given a promise and the first part of a script, return JSON: {"charOffset": <integer index where the promise is first fulfilled, or -1 if never>, "rationale": "<one sentence>"}. Output only JSON.',
      messages: [
        {
          role: "user",
          content: `<promise>${escapeForXml(promise)}</promise>\n<script>${escapeForXml(earlyText)}</script>`,
        },
      ],
      maxTokens: 160,
    });
    const parsed = safeJsonParse(extractTextFromMessage(locateMsg));
    const offset =
      parsed && typeof (parsed as Record<string, unknown>).charOffset === "number"
        ? ((parsed as Record<string, number>).charOffset as number)
        : -1;
    const rationale =
      parsed && typeof (parsed as Record<string, unknown>).rationale === "string"
        ? ((parsed as Record<string, string>).rationale as string).slice(0, 600)
        : null;

    // Map char offset → seconds via WPM (≈5.5 chars/word).
    if (offset < 0) {
      return {
        score: 100,
        problemDescription:
          rationale ?? "The script never clearly delivers the title's promise.",
      };
    }
    const words = offset / 5.5;
    const promiseLandsAtSec = Math.round((words / SCRIPT_WPM) * 60);

    // Drift score scales with how far past the 120s deadline the promise lands.
    const overSec = Math.max(0, promiseLandsAtSec - 120);
    const score = Math.min(100, Math.round((overSec / 120) * 100));
    return {
      score,
      problemDescription:
        score > DRIFT_PASS_THRESHOLD
          ? (rationale ??
            `Title promise lands around ${promiseLandsAtSec}s — past the 2:00 mark.`)
          : null,
    };
  } catch {
    // Drift is non-blocking; a failed check must not break the stream.
    return { score: 0, problemDescription: null };
  }
}
