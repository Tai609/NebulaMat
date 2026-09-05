/**
 * dsh-vaspflow host: task file services — Node port of backend/services/task_files.py.
 *
 * @module dsh-vaspflow/host/task-files
 */
import { readdirSync, statSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STRUCTURE_FILE_PRIORITY = { POSCAR: 0, CONTCAR: 1 };
const MAX_TEXT_PREVIEW_SIZE = 500 * 1024;

export function taskDir(taskInfo) {
  return join(taskInfo.root_path, taskInfo.rel_path);
}

/** Case-insensitive file resolution inside the task directory. */
export function resolveTaskFile(taskInfo, fileName) {
  const directory = taskDir(taskInfo);
  const filePath = join(directory, fileName);
  if (isFile(filePath)) return filePath;

  if (!isDir(directory)) return null;

  for (const candidate of readdirSync(directory)) {
    if (candidate.toUpperCase() === fileName.toUpperCase()) {
      const candidatePath = join(directory, candidate);
      if (isFile(candidatePath)) return candidatePath;
    }
  }
  return null;
}

/** List files and dirs: {files: [{name, size, ext}], dirs: [{name}]}. */
export function listFilesAndDirs(directory) {
  const files = [];
  const dirs = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (isFile(fullPath)) {
      const dot = entry.lastIndexOf('.');
      const ext = dot >= 0 ? entry.slice(dot) : '';
      files.push({ name: entry, size: statSync(fullPath).size, ext });
    } else if (isDir(fullPath)) {
      dirs.push({ name: entry });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return { files, dirs };
}

/** Structure files (POSCAR / CONTCAR / *.vasp), priority-ordered. */
export function listStructureFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const fullPath = join(directory, name);
    if (!isFile(fullPath)) continue;
    const upper = name.toUpperCase();
    if (upper === 'POSCAR' || upper === 'CONTCAR' || upper.endsWith('.VASP')) {
      files.push(name);
    }
  }
  files.sort((a, b) => {
    const pa = STRUCTURE_FILE_PRIORITY[a.toUpperCase()] ?? 2;
    const pb = STRUCTURE_FILE_PRIORITY[b.toUpperCase()] ?? 2;
    return pa !== pb ? pa - pb : a.toLowerCase().localeCompare(b.toLowerCase());
  });
  return files;
}

/** Text preview with truncation + path-traversal guard. */
export function readTextPreview(taskInfo, fileName) {
  const directory = resolve(taskDir(taskInfo));
  const filePath = resolve(join(directory, fileName));
  if (!isWithin(directory, filePath)) {
    const err = new Error('Path traversal detected');
    err.statusCode = 403;
    throw err;
  }
  if (!isFile(filePath)) {
    const err = new Error('File not found');
    err.statusCode = 404;
    throw err;
  }

  const fileSize = statSync(filePath).size;
  let content;
  let truncated = false;
  if (fileSize > MAX_TEXT_PREVIEW_SIZE) {
    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(MAX_TEXT_PREVIEW_SIZE);
      readSync(fd, buf, 0, MAX_TEXT_PREVIEW_SIZE, fileSize - MAX_TEXT_PREVIEW_SIZE);
      content = buf.toString('utf-8');
    } finally {
      closeSync(fd);
    }
    truncated = true;
  } else {
    content = readFileText(filePath);
    truncated = false;
  }

  return { name: fileName, size: fileSize, content, truncated };
}

function isWithin(directory, filePath) {
  const dir = realpathSync(directory).toLowerCase();
  const file = realpathSync(filePath).toLowerCase();
  return file === dir || file.startsWith(dir + '\\') || file.startsWith(dir + '/');
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readFileText(p) {
  const fd = openSync(p, 'r');
  try {
    const size = statSync(p).size;
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, 0);
    return buf.toString('utf-8');
  } finally {
    closeSync(fd);
  }
}
