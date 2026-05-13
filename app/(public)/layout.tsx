export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="glow-bg min-h-[calc(100vh-64px)] flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
