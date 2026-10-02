import { v1 } from "@/server/api-v1";
import { me } from "@/server/services/open-api";

export const GET = v1("profile:read", ({ ctx }) => me(ctx));
