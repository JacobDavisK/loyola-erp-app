"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { issueCredentialAction, revokeCredentialAction } from "@/features/results/actions";

export function RevokeCredentialButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" className="text-destructive" disabled={pending} onClick={() => {
      const reason = prompt("Reason for revoking this credential? Verifiers will see that it was revoked.");
      if (!reason) return;
      start(async () => {
        const r = await revokeCredentialAction(id, reason);
        if (!r.ok) toast.error(r.error);
        else { toast.success("Revoked"); router.refresh(); }
      });
    }}>Revoke</Button>
  );
}

export function IssueCredentialButton({ studentId, type, label, termId }: { studentId: string; type: string; label: string; termId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="xs" variant="outline" disabled={pending} onClick={() => {
      const purpose = type.endsWith("CERTIFICATE") ? prompt("Purpose (printed on the certificate, optional)") : null;
      start(async () => {
        const r = await issueCredentialAction(studentId, { type, purpose: purpose || null, termId: termId ?? null });
        if (!r.ok) toast.error(r.error);
        else { toast.success(`Issued ${r.data.serialNo}`); router.push(`/credentials/${r.data.id}`); }
      });
    }}>{label}</Button>
  );
}
