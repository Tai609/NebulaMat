/**
 * dsh-vaspflow host: in-memory task store — Node port of backend/services/task_store.py.
 *
 * In-memory only (matches the demo); lost on restart. Projects are keyed by
 * realpath+casefold root; tasks by (root_key, rel_key).
 *
 * @module dsh-vaspflow/host/task-store
 */
import { normalize, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

export class TaskStore {
  constructor() {
    this.projects = new Map(); // id -> {root_path, tasks, directories}
    this.tasks = new Map(); // id -> {root_path, rel_path, label}
    this.projectIdsByRoot = new Map(); // root_key -> id
    this.taskIdsByPath = new Map(); // "root\0rel" -> id
    this.nextProjectId = 1;
    this.nextTaskId = 1;
    this.version = 0; // bumped on every mutation (reverse-linkage polling)
  }

  addProject(rootPath, tasksData, directories) {
    const rootKey = this.rootKey(rootPath);
    for (const task of tasksData) {
      this.addTask(rootPath, task);
    }
    let projectId = this.projectIdsByRoot.get(rootKey);
    if (projectId === undefined) {
      projectId = this.nextProjectId;
      this.nextProjectId += 1;
      this.projectIdsByRoot.set(rootKey, projectId);
    }
    this.projects.set(projectId, {
      root_path: rootPath,
      tasks: tasksData,
      directories,
    });
    this.version += 1;
    return projectId;
  }

  addTask(rootPath, taskData) {
    const rootKey = this.rootKey(rootPath);
    const relKey = this.relKey(taskData.rel_path);
    const pathKey = rootKey + '\u0000' + relKey;
    let taskId = this.taskIdsByPath.get(pathKey);
    if (taskId === undefined) {
      taskId = this.nextTaskId;
      this.nextTaskId += 1;
      this.taskIdsByPath.set(pathKey, taskId);
    }
    taskData.id = taskId;
    this.tasks.set(taskId, {
      root_path: rootPath,
      rel_path: taskData.rel_path,
      label: taskData.label,
    });
    this.version += 1;
    return taskId;
  }

  rootKey(rootPath) {
    return resolve(realpathSync(rootPath)).toLowerCase();
  }

  relKey(relPath) {
    return normalize(relPath).toLowerCase();
  }
}
