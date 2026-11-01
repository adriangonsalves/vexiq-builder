/**
 * Where the app saves, runs smart actions and gets updates (openspec static-lite-site): the dev
 * server's bridge, or nothing but the browser on the static site. Chosen when the app is built
 * (`VITE_STATIC`, set by `npm run build:static`), so the static site has no bridge code.
 */
import * as bridge from './bridge.js';
import * as staticSite from './static.js';

const backend = import.meta.env.VITE_STATIC === 'true' ? staticSite : bridge;

export default backend;
