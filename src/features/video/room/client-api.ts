/** Small typed fetch helper for the meeting room (same-origin; session cookie; server authorises every call). */
export async function videoApi<T = unknown>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
  return json.data as T;
}

export type JoinResponse =
  | { status: "ready"; serverUrl: string; token: string; iceServers: RTCIceServer[]; identity: string; role: string; canPublish: boolean; canPublishScreen: boolean; chatEnabled: boolean; isHost: boolean; isModerator: boolean }
  | { status: "lobby" }
  | { status: "waiting"; startsAt: string };
