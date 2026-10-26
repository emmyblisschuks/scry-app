"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Logo from "./Logo";

type Mode = "signin" | "signup";

export default function AuthCard() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "auth_failed") {
      setError("Sign-in didn't complete. Please try again.");
    }
  }, []);

  async function signInWithGoogle() {
    setError(null);
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    // on success the browser navigates away; only reset if it failed
    if (error) {
      setGoogleLoading(false);
      setError(error.message);
    }
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      if (data.session) {
        router.push("/dashboard");
      } else {
        // email confirmation is required before a session is issued
        setCheckEmail(true);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    }
  }

  if (checkEmail) {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-white/60 p-10 text-center shadow-sm">
        <Logo size={56} />
        <h1 className="font-serif text-2xl font-bold text-wine">
          Check your inbox
        </h1>
        <p className="text-sm text-muted">
          We sent a confirmation link to <strong>{email}</strong>. Click it to
          activate your account, then come back and sign in.
        </p>
        <button
          onClick={() => {
            setCheckEmail(false);
            setMode("signin");
          }}
          className="text-sm font-medium text-wine underline"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm animate-[scaleIn_0.25s_ease-out] flex-col items-center gap-6 rounded-3xl bg-white/60 p-10 text-center shadow-sm backdrop-blur">
      <Logo size={56} />
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-bold text-wine">Scry</h1>
        <p className="text-sm text-muted">Smarter studying. Clearer answers.</p>
      </div>

      <button
        onClick={signInWithGoogle}
        disabled={googleLoading || loading}
        className="flex w-full items-center justify-center gap-3 rounded-full bg-wine px-6 py-3 font-medium text-cream shadow-md transition hover:bg-wine-dark hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine active:scale-95 disabled:opacity-60"
      >
        {googleLoading ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon />}
        {googleLoading ? "Redirecting…" : "Continue with Google"}
      </button>

      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-cream-dark" />
        <span className="text-xs text-muted">or</span>
        <div className="h-px flex-1 bg-cream-dark" />
      </div>

      <form onSubmit={handleEmailAuth} className="flex w-full flex-col gap-3">
        <input
          type="email"
          required
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-cream-dark bg-white px-4 py-3 text-sm text-ink outline-none focus:border-wine"
        />
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            minLength={6}
            placeholder="Password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-cream-dark bg-white px-4 py-3 pr-11 text-sm text-ink outline-none transition focus:border-wine focus:ring-2 focus:ring-wine/15"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-wine"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-left text-xs text-wine-dark">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || googleLoading}
          className="w-full rounded-full border border-wine px-6 py-3 font-medium text-wine transition hover:bg-wine hover:text-cream active:scale-95 disabled:opacity-50"
        >
          {loading
            ? "Please wait…"
            : mode === "signin"
            ? "Sign in"
            : "Create account"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        className="text-sm text-muted underline transition hover:text-wine"
      >
        {mode === "signin"
          ? "New here? Create an account"
          : "Already have an account? Sign in"}
      </button>

      <p className="text-xs text-muted">
        By continuing you agree to{" "}
        <Link href="/terms" className="underline hover:text-wine">
          Terms
        </Link>
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
