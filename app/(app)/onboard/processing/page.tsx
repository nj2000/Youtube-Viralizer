import { redirect } from "next/navigation";

import { ProcessingClient } from "./ProcessingClient";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OnboardProcessingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const url = firstParam(params.url);
  if (!url) redirect("/onboard");

  return (
    <div className="glow-bg min-h-[calc(100vh-64px)] px-6 py-16">
      <div className="max-w-xl mx-auto">
        <ProcessingClient url={url} />
      </div>
    </div>
  );
}
