import { v1 } from "@/server/api-v1";
import { upcomingEvents } from "@/server/services/open-api";

export const GET = v1("events:read", () => upcomingEvents());
