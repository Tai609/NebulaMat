/**
 * dsh-vaspflow host plugin — full data service.
 *
 * HTTP routes under /plugins/dsh-vaspflow/* (port plan §4.3):
 *   POST /plugins/dsh-vaspflow/scan?root_path=            → {project_id, tasks, directories}
 *   GET  /plugins/dsh-vaspflow/tasks/{id}                 → task list of a project
 *   POST /plugins/dsh-vaspflow/task/open-by-path?root_path=&rel_path=
 *   GET  /plugins/dsh-vaspflow/task/{id}/convergence
 *   GET  /plugins/dsh-vaspflow/task/{id}/structure?file=
 *   GET  /plugins/dsh-vaspflow/task/{id}/structure-scene?file=&include_connectivity=&bond_algorithm=
 *   GET  /plugins/dsh-vaspflow/task/{id}/files
 *   GET  /plugins/dsh-vaspflow/task/{id}/structure-files
 *   GET  /plugins/dsh-vaspflow/task/{id}/file-content?name=
 *   GET  /plugins/dsh-vaspflow/ping                       → {ok:true}
 *
 * Agent tools (port plan §4.4), registered on ctx.tools:
 *   vasp_scan / vasp_convergence / vasp_structure_scene / vasp_task_files / vasp_read_file
 *
 * Routes register lazily once the Web server service binds, mirroring
 * dsh-token-panel.
 *
 * @module dsh-vaspflow
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { scanProject, scanSingleDir } from './host/scanner.js';
import { parseConvergence, parseConvergenceSummary } from './host/parser.js';
import { getStructure, getStructureScene } from './host/structure.js';
import {
  listFilesAndDirs,
  listStructureFiles,
  readTextPreview,
  resolveTaskFile,
  taskDir,
} from './host/task-files.js';
import { TaskStore } from './host/task-store.js';

export const name = 'dsh-vaspflow';
export const inject = ['tools'];

export const Config = z.object({
  defaultScanRoot: z.string().default(''),
});

const WEB_SERVER_KEYS = ['webServer', 'httpServer'];

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** Parse the query string of a Node request into a plain object. */
function parseQuery(url) {
  const q = url.split('?')[1] ?? '';
  const out = {};
  for (const part of q.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    out[decodeURIComponent(key)] = decodeURIComponent(value ?? '');
  }
  return out;
}

export function apply(ctx, config) {
  const store = new TaskStore();

  // ---- agent tools ----------------------------------------------------------

  ctx.tools.register(defineTool({
    name: 'vasp_scan',
    description: '扫描一个 VASP 项目目录树，返回所有被识别为 VASP 任务（含 OUTCAR 或 vasprun.xml）的目录元数据与目录清单。面板与 agent 共用同一数据层。',
    parameters: {
      rootPath: { type: 'string', required: true, description: '要扫描的根目录绝对路径。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: { type: 'number' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'number' },
                rel_path: { type: 'string' },
                label: { type: 'string' },
                system: { type: 'string' },
                status: { type: 'string' },
                is_converged: { type: 'boolean' },
                n_ion_steps: { type: 'number' },
                final_energy: { type: 'number' },
              },
            },
          },
          directories: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                rel_path: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `扫描完成：${value.tasks.length} 个 VASP 任务，${value.directories.length} 个目录（project_id=${value.project_id}）`,
      }],
    },
    async execute(args) {
      const scanResult = await scanProject(args.rootPath);
      const projectId = store.addProject(args.rootPath, scanResult.tasks, scanResult.directories);
      return { project_id: projectId, tasks: scanResult.tasks, directories: scanResult.directories };
    },
    presentCall: (args) => ({ card: 'generic', title: 'Scan VASP project', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_convergence',
    description: '读取一个已扫描 VASP 任务的收敛数据（每个离子步的能量与最大力）。返回 {ion_steps, energies, max_forces}。',
    parameters: {
      taskId: { type: 'number', required: true, description: '任务 id（来自 vasp_scan 的 tasks[].id）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ion_steps: { type: 'array', items: { type: 'number' } },
          energies: { type: 'array', items: { type: 'number' } },
          max_forces: { type: 'array', items: { type: 'number' } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error
          ? `收敛数据不可用: ${value.error}`
          : `收敛数据：${value.ion_steps.length} 个离子步，最终能量 ${value.energies.at(-1)?.toFixed(6)} eV`,
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) {
        return { ion_steps: [], energies: [], max_forces: [], error: `Task ${args.taskId} not found` };
      }
      return parseConvergence(taskDir(info));
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP convergence', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_structure_scene',
    description: '读取一个已扫描 VASP 任务的 3D 结构场景 JSON（晶胞、原子、键、键族、摘要）。file 可选（默认 CONTCAR）。',
    parameters: {
      taskId: { type: 'number', required: true, description: '任务 id。' },
      file: { type: 'string', description: '结构文件名，默认 CONTCAR。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'number' },
          cell: { type: 'object', additionalProperties: true },
          atoms: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                site_index: { type: 'number' },
                element: { type: 'string' },
                position: { type: 'array', items: { type: 'number' } },
                is_periodic_image: { type: 'boolean' },
              },
            },
          },
          bonds: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                family_key: { type: 'string' },
                start_atom_index: { type: 'number' },
                end_atom_index: { type: 'number' },
                length: { type: 'number' },
              },
            },
          },
          bond_families: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                key: { type: 'string' },
                elements: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          summary: { type: 'object', additionalProperties: true },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.summary
          ? `结构：${value.summary.formula}，${value.summary.atom_count} 原子，${value.atoms.length} 个原子位点，${value.bonds.length} 条键`
          : JSON.stringify(value),
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) return { error: `Task ${args.taskId} not found` };
      const filePath = resolveTaskFile(info, args.file ?? 'CONTCAR');
      if (!filePath) return { error: `File ${args.file ?? 'CONTCAR'} not found at ${taskDir(info)}` };
      return getStructureScene(filePath, { includeConnectivity: true, bondAlgorithm: 'minimum-distance' });
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP structure scene', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_task_files',
    description: '列出已扫描 VASP 任务目录内的文件与子目录（{files: [{name,size,ext}], dirs: [{name}]}）。',
    parameters: {
      taskId: { type: 'number', required: true, description: '任务 id。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string' },
                size: { type: 'number' },
                ext: { type: 'string' },
              },
            },
          },
          dirs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `目录内容：${value.files.length} 个文件，${value.dirs.length} 个子目录`,
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) return { files: [], dirs: [], error: `Task ${args.taskId} not found` };
      return listFilesAndDirs(taskDir(info));
    },
    presentCall: (args) => ({ card: 'generic', title: 'VASP task files', kind: 'other', rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: 'vasp_read_file',
    description: '读取已扫描 VASP 任务目录内的一个文本文件（截断到 500KB，返回 truncated 标志）。',
    parameters: {
      taskId: { type: 'number', required: true, description: '任务 id。' },
      name: { type: 'string', required: true, description: '文件名（如 INCAR、OUTCAR、CONTCAR）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          size: { type: 'number' },
          content: { type: 'string' },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `文件 ${value.name}（${value.size} 字节${value.truncated ? '，已截断' : ''}）：\n${value.content}`,
      }],
    },
    async execute(args) {
      const info = store.tasks.get(args.taskId);
      if (!info) return { name: args.name, size: 0, content: '', truncated: false, error: `Task ${args.taskId} not found` };
      return readTextPreview(info, args.name);
    },
    presentCall: (args) => ({ card: 'generic', title: 'Read VASP file', kind: 'other', rawInput: args }),
  }));

  // ---- HTTP routes ------------------------------------------------------------

  let webRegistered = false;
  const registerWebSurface = () => {
    if (webRegistered) return;
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1]);
    if (webServer === undefined) return;
    webRegistered = true;

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/ping',
      handler: async (_req, res) => {
        json(res, 200, { ok: true, plugin: 'dsh-vaspflow', version: 3 });
      },
    }), 'dsh-vaspflow: ping route');

    // TaskStore version (reverse-linkage: the panel polls this and refreshes
    // when an agent tool bumped the store).
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/version',
      handler: async (_req, res) => {
        json(res, 200, { version: store.version, projectId: store.projects.size > 0 ? store.nextProjectId - 1 : null });
      },
    }), 'dsh-vaspflow: version route');

    // Project scan (POST /scan?root_path=)
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/scan',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req.url ?? '');
          const rootPath = query.root_path ?? '';
          if (rootPath === '') {
            json(res, 400, { error: 'root_path required' });
            return;
          }
          const scanResult = await scanProject(rootPath);
          const projectId = store.addProject(rootPath, scanResult.tasks, scanResult.directories);
          json(res, 200, { project_id: projectId, tasks: scanResult.tasks, directories: scanResult.directories });
        } catch (error) {
          json(res, 500, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: scan route');

    // Task list of a project (GET /tasks/{id})
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/plugins/dsh-vaspflow/tasks',
      handler: async (req, res) => {
        try {
          const pathname = new URL(req.url ?? '/', 'http://x').pathname;
          const id = Number(pathname.split('/').pop());
          const project = store.projects.get(id);
          if (!project) {
            json(res, 404, { error: 'Project not found' });
            return;
          }
          json(res, 200, project.tasks);
        } catch (error) {
          json(res, 500, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: tasks route');

    // Open one directory as a task (POST /task/open-by-path?root_path=&rel_path=)
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-vaspflow/task/open-by-path',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req.url ?? '');
          const rootPath = query.root_path ?? '';
          const relPath = query.rel_path ?? '.';
          const fullPath = joinPath(rootPath, relPath);
          if (!isDirectory(fullPath)) {
            json(res, 404, { error: 'Directory not found' });
            return;
          }
          let taskData = scanSingleDir(fullPath, rootPath);
          if (taskData === null) {
            taskData = {
              rel_path: relPath,
              label: basename(fullPath) || relPath,
              system: 'unknown',
              status: 'directory',
              is_converged: false,
              n_ion_steps: 0,
              final_energy: null,
              final_max_force: null,
              magmom_total: null,
              lattice_consts: null,
              incar_summary: {},
              error_message: '',
              is_vasp_task: false,
            };
          }
          store.addTask(rootPath, taskData);
          json(res, 200, taskData);
        } catch (error) {
          json(res, 500, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: open-by-path route');

    // Task-scoped routes (GET /task/{id}/...)
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/plugins/dsh-vaspflow/task',
      handler: async (req, res) => {
        try {
          const pathname = new URL(req.url ?? '/', 'http://x').pathname;
          const rest = pathname.slice('/plugins/dsh-vaspflow/task/'.length);
          const slash = rest.indexOf('/');
          const idText = slash < 0 ? rest : rest.slice(0, slash);
          const action = slash < 0 ? '' : rest.slice(slash + 1);
          const taskId = Number(idText);
          if (!Number.isFinite(taskId)) {
            json(res, 400, { error: `invalid task id: ${idText}` });
            return;
          }
          const info = store.tasks.get(taskId);
          if (!info) {
            json(res, 404, { error: `Task ${taskId} not found` });
            return;
          }
          const query = parseQuery(req.url ?? '');

          switch (action) {
            case 'convergence': {
              const result = await parseConvergence(taskDir(info));
              json(res, 200, result);
              return;
            }
            case 'structure': {
              const filePath = resolveTaskFile(info, query.file ?? 'CONTCAR');
              if (!filePath) {
                json(res, 404, { error: `File ${query.file ?? 'CONTCAR'} not found at ${taskDir(info)}` });
                return;
              }
              json(res, 200, getStructure(filePath));
              return;
            }
            case 'structure-scene': {
              const filePath = resolveTaskFile(info, query.file ?? 'CONTCAR');
              if (!filePath) {
                json(res, 404, { error: `File ${query.file ?? 'CONTCAR'} not found at ${taskDir(info)}` });
                return;
              }
              const includeConnectivity = query.include_connectivity !== 'false';
              const bondAlgorithm = query.bond_algorithm ?? 'minimum-distance';
              json(res, 200, getStructureScene(filePath, { includeConnectivity, bondAlgorithm }));
              return;
            }
            case 'files': {
              json(res, 200, listFilesAndDirs(taskDir(info)));
              return;
            }
            case 'structure-files': {
              json(res, 200, { files: listStructureFiles(taskDir(info)) });
              return;
            }
            case 'file-content': {
              try {
                json(res, 200, readTextPreview(info, query.name ?? ''));
              } catch (error) {
                json(res, error.statusCode ?? 500, { error: error.message });
              }
              return;
            }
            default:
              json(res, 404, { error: `unknown task action: ${action}` });
          }
        } catch (error) {
          json(res, 500, { error: String(error) });
        }
      },
    }), 'dsh-vaspflow: task routes');
  };
  registerWebSurface();
  ctx.on('internal/service', (serviceName) => {
    if (WEB_SERVER_KEYS.includes(serviceName)) {
      registerWebSurface();
    }
  });
  ctx.logger.info('dsh-vaspflow: host half active (phase 1 data service)');
}

// Local path helpers (kept tiny to avoid a second import cycle).
import { join as joinPath, basename } from 'node:path';
import { statSync } from 'node:fs';
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
