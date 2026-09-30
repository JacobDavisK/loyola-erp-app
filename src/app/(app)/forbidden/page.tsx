import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Access restricted" };

export default function Forbidden() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <div className="mb-5 grid size-12 place-items-center rounded-xl bg-tone-danger/10 text-tone-danger">
        <ShieldAlert className="size-6" />
      </div>
      <h1 className="text-xl font-semibold">Access restricted</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You don&apos;t have permission to access this area. If you need access, request it from the Approval centre or contact your administrator.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
