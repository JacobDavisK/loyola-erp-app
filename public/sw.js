/* Service worker: offline copies of a few of the person's own pages, an offline fallback, and push notifications. */
const PAGES = "ec-pages-v2";
const SHELL = "ec-shell-v1";
const OFFLINE_URL = "/offline";
// Pages kept for reading offline (the person's own; cleared when they sign out).
const KEEP = [/^\/portal$/, /^\/portal\/(attendance|results|fees|courses|exams|support|wallet|outpass|health|credits|planner)$/, /^\/id-card$/, /^\/dashboard$/, /^\/me\/(leave|payslips)$/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll([OFFLINE_URL, "/icon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![PAGES, SHELL].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-pages") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const keep = KEEP.some((r) => r.test(url.pathname));
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (keep && res.ok && res.headers.get("content-type")?.includes("text/html")) {
          const copy = res.clone();
          caches.open(PAGES).then((c) => c.put(url.pathname, copy));
        }
        return res;
      })
      .catch(async () => (keep && (await caches.match(url.pathname, { cacheName: PAGES }))) || (await caches.match(OFFLINE_URL)) || Response.error()),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/notifications" };
  try { data = { ...data, ...event.data.json() }; } catch { /* plain text */ }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon.svg", badge: "/icon.svg", data: { url: data.url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url === url);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
