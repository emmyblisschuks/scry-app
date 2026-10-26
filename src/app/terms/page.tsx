import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-wine underline">
        ← Back
      </Link>
      <h1 className="mt-6 font-serif text-3xl font-bold text-wine">Terms</h1>
      <p className="mt-4 text-sm text-muted">
        Scry answers your questions using only the study material you upload.
        Answers can be wrong, so always double-check anything flagged low
        confidence or unsure. You own your uploads and can delete a workspace
        at any time, which removes its content.
      </p>
    </main>
  );
}
