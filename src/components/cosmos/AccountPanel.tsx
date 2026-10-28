import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Panel } from "./controls";

export function AccountPanel({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    return (
      <Panel title="Your account" icon={<UserRound size={15} />} onClose={onClose}>
        <p className="text-[12px] text-muted-foreground">Signed in as</p>
        <p className="readout mb-3 truncate text-neon-cyan">{user.email}</p>
        <p className="mb-3 text-[12px] text-muted-foreground">Universes you save now belong to you — rename, update or delete them from the gallery.</p>
        <button className="btn-ghost w-full" onClick={async () => { await supabase.auth.signOut(); toast("Signed out"); }}>
          <LogOut size={14} /> Sign out
        </button>
      </Panel>
    );
  }

  const signInWithGoogle = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + window.location.search });
    if (r.error) toast.error("Sign-in didn't complete — please try again");
    else if (!r.redirected) { toast.success("Signed in"); onClose(); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        toast.success("Check your email for a reset link");
        setMode("signin");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        toast.success("Check your email to confirm your account");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={mode === "signup" ? "Create account" : mode === "forgot" ? "Reset password" : "Sign in"} icon={<UserRound size={15} />} onClose={onClose}>
      <p className="mb-3 text-[12px] text-muted-foreground">Sign in to own your saved universes and edit or delete them later.</p>
      {mode !== "forgot" && (
        <>
          <button className="btn-ghost mb-3 w-full" onClick={signInWithGoogle}>Continue with Google</button>
          <div className="label-mono mb-2 text-center">or with email</div>
        </>
      )}
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>
        <input className="field-input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        {mode !== "forgot" && (
          <input className="field-input" type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        )}
        <button className="btn-neon" disabled={busy} type="submit">{busy ? "…" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}</button>
      </form>
      <div className="mt-3 flex justify-between text-[11px]">
        <button className="text-muted-foreground hover:text-neon-cyan" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
          {mode === "signup" ? "Have an account? Sign in" : "New here? Create account"}
        </button>
        {mode === "signin" && <button className="text-muted-foreground hover:text-neon-cyan" onClick={() => setMode("forgot")}>Forgot password?</button>}
      </div>
    </Panel>
  );
}
