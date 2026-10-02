import { v1 } from "@/server/api-v1";
import { operationsSnapshot } from "@/server/services/open-api";

export const GET = v1("operations:read", ({ ctx }) => operationsSnapshot(ctx));
