import { redirect } from "next/navigation";

/** Links in notifications point here; the class workspace lives under Academics. */
export default async function TeachingClassRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/academics/offerings/${id}`);
}
