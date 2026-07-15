// Entry for the vendored Yjs browser bundle. Rebuild after upgrading yjs:
//   npx esbuild scripts/y-entry.js --bundle --minify --format=iife --global-name=YB --outfile=public/vendor/y.js
// The output is committed (no build step in production).
export * as Y from 'yjs';
export * as awarenessProtocol from 'y-protocols/awareness';
