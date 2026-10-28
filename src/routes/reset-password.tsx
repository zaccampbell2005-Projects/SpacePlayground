import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — Quantum·Relativity Cosmos" },
      { name: "description", content: "Choose a new password for your Cosmos sandbox account." },
      { property: "og:title", content: "Reset password — Cosmos Sandbox" },
      { property: "og:description", content: "Choose a new password for your Cosmos sandbox account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen items-center justify-center bg-void px-4">
      <form
        className="glass w-full max-w-sm p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const { error } = await supabase.auth.updateUser({ password: pw });
          setBusy(false);
          if (error) { toast.error(error.message); return; }
          toast.success("Password updated");
          navigate({ to: "/", replace: true });
        }}
      >
        <h1 className="font-display text-lg font-bold">Set a new password</h1>
        <input className="field-input mt-4" type="password" minLength={6} required placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <button className="btn-neon mt-3 w-full" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
      </form>
    </main>
  );
}
