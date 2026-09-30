"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "@/features/auth/actions";

export default function ForgotPasswordPage() {
  const [id, setId] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  if (sent) {
    return (
      <div>
        <div className="mb-6 grid size-11 place-items-center rounded-xl bg-tone-success/10 text-tone-success">
          <MailCheck className="size-5" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Check your e-mail</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account matches <span className="font-medium text-foreground">{id}</span>, a reset link valid for 30 minutes has been sent to its registered e-mail address.
        </p>
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link href="/login"><ArrowLeft /> Back to sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Reset password</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">We&apos;ll e-mail a secure reset link to the address on your account.</p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            await requestPasswordResetAction(id);
            setSent(true);
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="id">E-mail or employee ID</Label>
          <Input id="id" value={id} onChange={(e) => setId(e.target.value)} autoFocus required className="h-10" />
        </div>
        <Button type="submit" className="h-10 w-full" disabled={pending || !id.trim()}>
          {pending && <Loader2 className="animate-spin" />} Send reset link
        </Button>
      </form>
      <Button asChild variant="ghost" className="mt-3 w-full">
        <Link href="/login"><ArrowLeft /> Back to sign in</Link>
      </Button>
    </div>
  );
}
