/**
 * Service worker MINIMAL (cahier Lot E, Partie 3 / section 53 du master
 * prompt) : met en cache le strict shell applicatif (manifest + icônes)
 * pour que l'app soit installable, SANS PROMETTRE de fonctionnement
 * hors-ligne complet. Les pages du dashboard et les appels réseau
 * (Server Actions, données Supabase) passent toujours directement par le
 * réseau — on ne sert jamais de données potentiellement périmées à la
 * place d'une vraie réponse serveur.
 */

const CACHE_NAME = "sme-os-shell-v1";
const SHELL_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first UNIQUEMENT pour le shell listé ci-dessus. Tout le reste
// (navigation, API, données tenant) va directement au réseau — pas
// d'interception, pas de fallback offline pour le contenu dynamique.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !SHELL_ASSETS.includes(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});

/**
 * Lot I, Partie 1 — notifications push réelles. Étend le SW minimal
 * ci-dessus SANS toucher au comportement install/activate/fetch existant.
 * Payload attendu (voir push-service.ts::sendPush) : { title, body, url }.
 */
self.addEventListener("push", (event) => {
  let payload = {
    title: "SME-OS",
    body: "Vous avez une nouvelle notification.",
    url: "/dashboard/notifications",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      // Payload non-JSON (ne devrait pas arriver côté SME-OS, mais un
      // service worker doit rester défensif face à n'importe quel push) :
      // on garde au moins le texte brut comme corps du message.
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // `tag` regroupe les notifications répétées d'un même type plutôt que
      // d'empiler des dizaines d'entrées identiques dans le centre de
      // notifications du système d'exploitation.
      tag: payload.url,
      renotify: true,
      data: { url: payload.url },
    }),
  );
});

// Focalise un onglet déjà ouvert sur la bonne page plutôt que d'en ouvrir
// un nouveau à chaque clic — comportement standard attendu par les
// utilisateurs pour une notification d'application déjà installée.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : "/dashboard/notifications";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});

// Le navigateur peut faire tourner (rarement) l'endpoint d'une souscription
// push existante — sans ce listener, la souscription deviendrait
// silencieusement obsolète et l'appareil cesserait de recevoir des
// notifications jusqu'à un désabonnement/réabonnement manuel. Best-effort :
// en cas d'échec, la ligne DB deviendra simplement invalide et sera
// nettoyée automatiquement par push-service.ts::sendPush au prochain envoi
// (réponse 404/410 du service push).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
        const applicationServerKey = event.oldSubscription
          ? event.oldSubscription.options.applicationServerKey
          : null;
        if (!oldEndpoint || !applicationServerKey) return;

        const newSubscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        await fetch("/api/push/resubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldEndpoint, subscription: newSubscription.toJSON() }),
        });
      } catch {
        // Best-effort — voir commentaire du listener ci-dessus.
      }
    })(),
  );
});
