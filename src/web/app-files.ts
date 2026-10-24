import { existsSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vite builds the React app (ui/) into this folder; the service serves it at /app/.
export const defaultAppDirectory = fileURLToPath(new URL('../../ui/dist/', import.meta.url));
export const appPathPrefix = '/app/';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function isAppPath(pathname: string) {
  return pathname === '/app' || pathname.startsWith(appPathPrefix);
}
export function appIsBuilt(appDirectory: string) {
  return existsSync(resolve(appDirectory, 'index.html'));
}

// Returns null for anything that is not a regular file inside the app folder,
// including encoded traversal (`..%2f`) and symlinks that point outside it.
export function findAppFile(appDirectory: string, pathname: string) {
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice(appPathPrefix.length));
  } catch {
    return null;
  }
  if (relativePath.includes('\0')) {
    return null;
  }
  const contentType = contentTypes[extname(relativePath || 'index.html')];
  if (!contentType) {
    return null;
  }
  const appRoot = realpathSync(appDirectory);
  const requestedPath = resolve(appRoot, relativePath || 'index.html');
  if (!requestedPath.startsWith(appRoot + sep) || !existsSync(requestedPath)) {
    return null;
  }
  const realPath = realpathSync(requestedPath);
  if (!realPath.startsWith(appRoot + sep) || !statSync(realPath).isFile()) {
    return null;
  }
  return { path: realPath, contentType };
}
