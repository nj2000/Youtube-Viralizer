"use client";

import Link from "next/link";
import { useState } from "react";

import { useLint } from "@/lib/hooks/useLint";

import { Stage8Header } from "./shared";

// State 5 — error. `missing` = no script yet (5b); `upstream` = the lint model
// failed (5a). Skip is advisory; retry re-runs lint.
export function ErrorCard({
  runId,
  variant,
  errorCode,
}: {
  runId: string;
  variant: "missing" | "upstream";
  errorCode: string | null;
}) {
  const lint = useLint(runId);
  const [acting, setActing] = useState(false);

  if (variant === "missing") {
    return (
      <li className="card rounded-2xl p-5">
        <Stage8Header
          pill="Blocked"
          pillClass="bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30"
          subtitle="Missing input · cannot run lint"
        />
        <div className="mt-4 flex items-start gap-4 rounded-xl p-4 bg-amber-500/[0.05] ring-1 ring-amber-500/20">
          <span className="h-10 w-10 rounded-full bg-amber-500/15 ring-1 ring-amber-500/40 flex items-center justify-center shrink-0 text-amber-300">
            !
          </span>
          <div>
            <h3 className="text-sm font-bold text-amber-100">
              Lint requires a script.
            </h3>
            <p className="text-[13px] text-amber-200/80 mt-1 leading-relaxed">
              Stage 7 hasn&apos;t completed for this run. Generate the retention
              script first — we&apos;ll automatically run lint when it finishes.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Link
            href={`/runs/${runId}?focus=script`}
            className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold"
          >
            Re-run Stage 7 →
          </Link>
        </div>
      </li>
    );
  }

  return (
    <li className="card rounded-2xl p-5">
      <Stage8Header
        pill="Failed"
        pillClass="bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30"
        subtitle="Lint failed · upstream model error"
      />
      <div className="mt-4 flex items-start gap-4 rounded-xl p-4 bg-rose-500/[0.06] ring-1 ring-rose-500/20">
        <span className="h-10 w-10 rounded-full bg-rose-500/20 ring-1 ring-rose-500/40 flex items-center justify-center shrink-0 text-rose-300">
          !
        </span>
        <div>
          <h3 className="text-sm font-bold text-rose-100">
            We couldn&apos;t reach the lint model right now.
          </h3>
          <p className="text-[13px] text-rose-200/80 mt-1 leading-relaxed">
            The lint stage returned an error. Your script is saved — just retry.
          </p>
          <p className="text-[11px] font-mono text-rose-300/70 mt-2">
            error_code: {errorCode ?? "UPSTREAM_ERROR"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={acting}
          onClick={async () => {
            setActing(true);
            try {
              await lint.skip();
            } finally {
              setActing(false);
            }
          }}
          className="text-sm px-4 py-2 rounded-lg bg-white/5 ring-1 ring-white/10 text-ink-200 hover:bg-white/10 disabled:opacity-50 transition"
        >
          Skip lint &amp; continue
        </button>
        <button
          type="button"
          disabled={acting}
          onClick={async () => {
            setActing(true);
            try {
              await lint.rerun(true);
            } finally {
              setActing(false);
            }
          }}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
        >
          Retry lint
        </button>
      </div>
    </li>
  );
}
