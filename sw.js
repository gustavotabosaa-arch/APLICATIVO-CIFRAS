/* Tônica — Service Worker (PWA/offline, etapa mínima)
 *
 * Só intercepta o que o app precisa para abrir offline:
 *   1. a navegação para index.html (rede primeiro, cache como fallback);
 *   2. os dois arquivos do PDF.js 4.9.155 (cache primeiro; a URL é versionada, não muda).
 * Todo o resto (standard_fonts, outras origens, PDFs do usuário, etc.) passa direto para a rede,
 * sem nenhuma interferência. O localStorage não é tocado por este arquivo.
 */
const CACHE_NAME = 'tonica-v1';

const SCOPE_URL = self.registration.scope;                       // ex.: https://site/pasta/
const INDEX_URL = new URL('./index.html', SCOPE_URL).href;

const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/';
const PDFJS_URLS = [
  PDFJS_BASE + 'pdf.min.mjs',
  PDFJS_BASE + 'pdf.worker.min.mjs'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Obrigatório: se o index.html não for baixado, a instalação falha e é tentada de novo depois.
    await cache.add(new Request(INDEX_URL, { cache: 'reload' }));
    // Melhor esforço: se o CDN estiver fora do ar agora, o app ainda instala,
    // e o PDF.js entra no cache na primeira vez que for carregado online (ver fetch abaixo).
    await Promise.allSettled(
      PDFJS_URLS.map((u) => cache.add(new Request(u, { mode: 'cors', cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('tonica-') && n !== CACHE_NAME).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

function isAppNavigation(request) {
  if (request.mode !== 'navigate') return false;
  const u = new URL(request.url);
  u.search = '';
  u.hash = '';
  return u.href === SCOPE_URL || u.href === INDEX_URL;
}

async function networkFirstIndex(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      await cache.put(INDEX_URL, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(INDEX_URL, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstPdfjs(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request.url, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request.url, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (PDFJS_URLS.includes(request.url)) {
    event.respondWith(cacheFirstPdfjs(request));
    return;
  }
  if (isAppNavigation(request)) {
    event.respondWith(networkFirstIndex(request));
  }
  // qualquer outra requisição: não intercepta
});
