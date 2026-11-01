/**
 * A file from public/ (catalog.json, models/…) at the site's base path, so the app works from a
 * sub-folder of a static host (openspec static-lite-site). Paths may start with `/`, as the
 * catalog's `modelUrl`s do. In dev the base is `/`, so the path is unchanged.
 */
export function assetUrl(file) {
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${String(file).replace(/^\//, '')}`;
}
