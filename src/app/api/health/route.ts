import { NextResponse } from "next/server";
import { db } from "@/server/db";

/** Liveness/readiness probe for load balancers. Reveals no data. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
