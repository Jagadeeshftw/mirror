// Mirror service worker: makes the web app installable and receives Web Push alerts. It caches nothing, so
// balances, copies and limits always come from the network (Mirror's server and Monad), never from a stale copy.
//
// Alerts arrive sealed to this browser's notification key (X25519 from the passkey's second PRF namespace). The key
// stays in the app's encrypted storage, which a worker cannot read, so the worker never decrypts: it shows the
// generic text below, keeps the envelope in IndexedDB and pings open tabs; the app decrypts when it is open.
const INBOX_DB = "mirror-inbox";
const INBOX_STORE = "envelopes";
const SCOPE = new URL(self.registration.scope).pathname; // "/app/" in production, "/" in local dev

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

function inbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INBOX_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(INBOX_STORE, { autoIncrement: true });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function keep(env) {
  const db = await inbox();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(INBOX_STORE, "readwrite");
    const st = tx.objectStore(INBOX_STORE);
    st.add(env);
    // Bounded: an unopened app never grows the queue past 200 alerts.
    const count = st.count();
    count.onsuccess = () => {
      if (count.result > 200) st.openCursor().onsuccess = (e) => e.target.result && e.target.result.delete();
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function envelopeOf(data) {
  try {
    const d = data ? data.json() : null;
    const env = d && (d.mirror || d);
    return env && env.v === 1 && env.ct ? env : null;
  } catch (e) {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const env = envelopeOf(event.data);
  event.waitUntil(
    (async () => {
      if (env) await keep(env).catch(() => {});
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const t of tabs) t.postMessage({ type: "mirror-push" });
      // Generic on purpose: no amounts, markets or addresses ever reach the notification or the push service.
      await self.registration.showNotification("Mirror", {
        body: "New activity",
        tag: "mirror-activity",
        renotify: true,
        icon: SCOPE + "icon-192.png",
        data: { url: SCOPE + "alerts" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || SCOPE;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const t of tabs) {
        if ("focus" in t) {
          await t.focus();
          if ("navigate" in t) await t.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
