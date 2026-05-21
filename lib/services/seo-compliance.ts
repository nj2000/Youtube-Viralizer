// FTC + niche-policy disclosure strings (spec §5.2). Deterministic literals,
// isolated here for legal review — never model-generated. Verification item:
// is_sponsored=true → the description body STARTS with the FTC prefix.

export const FTC_DISCLOSURE =
  "⚠️ Disclosure: This video includes paid promotion. Some links may be affiliate links — I may earn a small commission at no extra cost to you.";

const FINANCE_DISCLAIMER =
  "This video is for educational purposes only and is not financial advice. Do your own research before investing.";

const MEDICAL_DISCLAIMER =
  "This video is for informational purposes only and is not medical advice. Consult a qualified professional.";

const FINANCE_KEYWORDS = ["finance", "investing", "stocks", "crypto", "trading", "money"];
const MEDICAL_KEYWORDS = ["medical", "health", "fitness", "nutrition", "supplement", "diet"];

function matches(niche: string, keywords: string[]): boolean {
  const n = niche.toLowerCase();
  return keywords.some((k) => n.includes(k));
}

// Niche-policy disclaimer (substring match — Phase 1; spec defers richer
// detection). Returns null when no policy applies.
export function complianceDisclaimerFor(niche: string): string | null {
  if (matches(niche, FINANCE_KEYWORDS)) return FINANCE_DISCLAIMER;
  if (matches(niche, MEDICAL_KEYWORDS)) return MEDICAL_DISCLAIMER;
  return null;
}

// Prepend the FTC disclosure to a description body when the run is sponsored.
// The body MUST start with the literal prefix (verification).
export function applyDisclosures(
  body: string,
  opts: { isSponsored: boolean; niche: string },
): { body: string; sponsoredDisclosure: boolean; complianceDisclaimer: boolean } {
  let next = body;
  const compliance = complianceDisclaimerFor(opts.niche);
  if (compliance && !next.includes(compliance)) {
    next = `${next}\n\n${compliance}`;
  }
  if (opts.isSponsored && !next.startsWith(FTC_DISCLOSURE)) {
    next = `${FTC_DISCLOSURE}\n\n${next}`;
  }
  return {
    body: next,
    sponsoredDisclosure: opts.isSponsored,
    complianceDisclaimer: compliance !== null,
  };
}
