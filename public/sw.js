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
