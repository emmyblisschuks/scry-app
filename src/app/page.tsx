import AuthCard from "@/components/AuthCard";

export default function Home() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-wine/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-wine-light/20 blur-3xl"
      />
      <div className="relative z-10 flex w-full justify-center">
        <AuthCard />
      </div>
    </main>
  );
}
