import Link from "next/link";

import { CallbackReasonSchema } from "@/lib/validation/auth";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const CONTENT = {
  expired: {
    heading: "This link has expired",
    body: "Magic links are good for 15 minutes. We'll send a fresh one — should land in your inbox in seconds.",
    primary: { href: "/sign-in", label: "Send a new link" },
    secondary: { href: "/sign-in", label: "Use a different email" },
    code: null as string | null,
    icon: "info" as const,
  },
  used: {
    heading: "This link has already been used",
    body: "Each magic link is single-use. If you signed in already, you're good — head to your runs. Otherwise request a fresh link.",
    primary: { href: "/runs", label: "Go to runs" },
    secondary: { href: "/sign-in", label: "Send new link" },
    code: "TOKEN_ALREADY_USED" as string | null,
    icon: "check" as const,
  },
  invalid: {
    heading: "This link isn't valid",
    body: "The link looks malformed — maybe it got cut off when forwarded, or the URL was edited. Request a new one and click it directly from your inbox.",
    primary: { href: "/sign-in", label: "Request a new link" },
    secondary: { href: "/", label: "Need help? Read the docs" },
    code: null as string | null,
    icon: "alert" as const,
  },
};

export default async function SignInErrorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const parsed = CallbackReasonSchema.safeParse(firstParam(params.reason));
  const reason = parsed.success ? parsed.data : "invalid";
  const content = CONTENT[reason];

  return (
    <div className="card rounded-2xl px-8 py-10 text-center">
      <div className="h-14 w-14 rounded-full bg-rose-500/15 ring-1 ring-rose-500/30 flex items-center justify-center mx-auto mb-5 text-rose-400">
        <ReasonIcon variant={content.icon} />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-white">
        {content.heading}
      </h1>
      <p className="text-ink-300 mt-3 text-sm">{content.body}</p>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Link
          href={content.secondary.href}
          className="px-4 py-3 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white font-semibold rounded-lg transition text-sm"
        >
          {content.secondary.label}
        </Link>
        <Link
          href={content.primary.href}
          className="btn-primary px-4 py-3 text-white font-semibold rounded-lg text-sm"
        >
          {content.primary.label}
        </Link>
      </div>

      {content.code && (
        <p className="mt-5 text-xs text-ink-500">
          code: <span className="font-mono">{content.code}</span>
        </p>
      )}
    </div>
  );
}

function ReasonIcon({ variant }: { variant: "info" | "check" | "alert" }) {
  const common = {
    className: "h-6 w-6",
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor" as const,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (variant === "check") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  }
  if (variant === "alert") {
    return (
      <svg {...common}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}
