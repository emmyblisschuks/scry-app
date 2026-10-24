"use client";

import { createClient } from "@/lib/supabase/client";
import Logo from "./Logo";

export default function AuthCard() {
  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl bg-white/60 p-10 text-center shadow-sm">
      <Logo size={56} />
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-bold text-wine">Scry</h1>
        <p className="text-sm text-muted">Smarter studying. Clearer answers.</p>
      </div>

      <button
        onClick={signInWithGoogle}
        className="flex w-full items-center justify-center gap-3 rounded-full bg-wine px-6 py-3 font-medium text-cream shadow-md transition active:scale-95"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <p className="text-xs text-muted">
        By continuing you agree to{" "}
        <a href="/terms" className="underline">
          Terms
        </a>
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.9 6 29.8 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.5 18.9 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.9 6 29.8 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.7 0 10.6-1.9 14.2-5.2l-6.6-5.6C29.6 35 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.6 5.6C40.9 36.8 44 31 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
