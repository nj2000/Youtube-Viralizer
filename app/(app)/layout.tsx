import { redirect } from "next/navigation";
import Link from "next/link";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { UserMenu } from "./_components/UserMenu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already gates protected prefixes; this is defense-in-depth for
  // any layout-level data fetching downstream phases may add.
  if (!user) redirect("/sign-in");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <Link href="/runs" className="flex items-center gap-2">
          <span className="h-7 w-7 rounded-lg bg-gradient-to-b from-yt-500 to-yt-700 shadow-glow-yt" />
          <span className="font-extrabold tracking-tight text-white">
            Viralizer
          </span>
        </Link>
        <UserMenu email={user.email ?? ""} />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
