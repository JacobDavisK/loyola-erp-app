"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelMfaChallengeAction, verifyMfaAction } from "@/features/auth/actions";

export function MfaForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <div className="mb-6 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
        <KeyRound className="size-5" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">Two-step verification</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
      {error && (
        <div role="alert" className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await verifyMfaAction(code);
            if (!res.ok) {
              setError(res.error);
              setCode("");
              return;
            }
            router.replace("/dashboard");
            router.refresh();
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
            className="h-12 text-center font-mono text-xl tracking-[0.5em]"
          />
        </div>
        <Button type="submit" className="h-10 w-full" disabled={pending || code.replace(/\s/g, "").length !== 6}>
          {pending && <Loader2 className="animate-spin" />} Verify
        </Button>
      </form>
      <form action={cancelMfaChallengeAction} className="mt-3">
        <Button variant="ghost" className="w-full" type="submit">Use a different account</Button>
      </form>
    </div>
  );
}
