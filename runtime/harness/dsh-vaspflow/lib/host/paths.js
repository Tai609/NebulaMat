/**
 * dsh-vaspflow host: path helpers with Windows-safe semantics matching the
 * Python original (os.path.realpath / os.path.relpath / os.path.normpath /
 * os.path.basename / os.path.join).
 *
 * @module dsh-vaspflow/host/paths
 */
import { basename, join, normalize, relative, resolve, sep } from 'node:path';

/** os.path.join equivalent (node path.join handles Windows separators). */
export function joinPath(...parts) {
  return join(...parts);
}

/** os.path.normpath equivalent. */
export function normpath(p) {
  return normalize(p);
}

/** os.path.realpath equivalent. */
export function realpath(p) {
  return resolve(p);
}

/** os.path.relpath(path, start) equivalent. */
export function relpath(p, start) {
  const r = relative(resolve(start), resolve(p));
  return r === '' ? '.' : r;
}

export { basename, join, sep, normalize };
