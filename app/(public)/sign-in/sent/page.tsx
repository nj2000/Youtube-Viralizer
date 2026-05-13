import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolvePostAuthDestination } from "@/lib/services/auth";

import { ResendButton } from "./ResendButton";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SignInSentPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const email = firstParam(params.email) ?? "";
  const next = firstParam(params.next);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(await resolvePostAuthDestination(supabase, user.id, next));
  }

  if (!email) redirect("/sign-in");

  return (
    <div className="card rounded-2xl px-8 py-10">
      <div className="flex flex-col items-center text-center">
        <div
          className="h-14 w-14 rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-700 flex items-center justify-center mb-5"
          style={{
            boxShadow:
              "0 0 0 1px rgba(16,185,129,0.35), 0 8px 32px -8px rgba(16,185,129,0.55)",
          }}
        >
          <svg
            className="h-7 w-7 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
            <path d="m16 13 3 3" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          Check your inbox
        </h1>
        <p className="text-ink-300 mt-3 text-sm">
          We sent a sign-in link to{" "}
          <span className="text-white font-semibold">{email}</span>. Click it
          and you&apos;re in.
        </p>
      </div>

      <ol className="mt-6 space-y-3">
        <Step n={1}>
          Open the email from{" "}
          <span className="text-white font-semibold">Viralizer</span>.
        </Step>
        <Step n={2}>
          Click{" "}
          <span className="text-white font-semibold">Sign in</span>. Link works
          for 15 minutes, once.
        </Step>
        <Step n={3}>You&apos;ll land back here, signed in.</Step>
      </ol>

      <div className="mt-6 pt-5 border-t border-white/5">
        <p className="text-sm font-semibold text-white">Didn&apos;t get it?</p>
        <ResendButton email={email} next={next ?? null} />
      </div>

      <div className="mt-6 text-center">
        <Link
          href="/sign-in"
          className="text-sm text-ink-400 hover:text-ink-200 transition"
        >
          ← Use a different email
        </Link>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="h-6 w-6 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center shrink-0 text-xs font-semibold text-emerald-400">
        {n}
      </span>
      <span className="text-sm text-ink-300">{children}</span>
    </li>
  );
}
