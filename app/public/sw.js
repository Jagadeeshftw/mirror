// Mirror service worker: makes the web app installable. It caches nothing, so balances, copies and
// limits always come from the network (Mirror's server and Monad), never from a stale copy.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
