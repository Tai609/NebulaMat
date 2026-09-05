import { runtimePassword } from "./tauri";

export interface VaspFlowTask {
  id: number;
  rel_path: string;
  label: string;
  system: string;
  status: string;
  is_converged: boolean;
  n_ion_steps: number;
  final_energy: number | null;
  final_max_force?: number | null;
  magmom_total?: number | null;
  lattice_consts?: number[] | null;
  incar_summary?: Record<string, unknown>;
  error_message?: string;
  is_vasp_task?: boolean;
}

export interface VaspFlowScanResult {
  project_id: number;
  tasks: VaspFlowTask[];
  directories: Array<{ rel_path: string; label: string }>;
}

export interface VaspFlowConvergence {
  ion_steps: number[];
  energies: number[];
  max_forces: number[];
  error?: string;
}

export interface VaspFlowAtom {
  id: string;
  site_index: number;
  element: string;
  position: [number, number, number];
  fractional_position?: [number, number, number];
  image_offset?: [number, number, number];
  is_periodic_image: boolean;
}

export interface VaspFlowBond {
  id: string;
  family_key: string;
  start_atom_index: number;
  end_atom_index: number;
  length: number;
}

export interface VaspFlowScene {
  version: number;
  cell: {
    vectors: [[number, number, number], [number, number, number], [number, number, number]] | number[][];
    lengths: number[];
    angles: number[];
  };
  atoms: VaspFlowAtom[];
  bonds: VaspFlowBond[];
  bond_families: Array<{ key: string; elements: string[]; min_length?: number; max_length?: number }>;
  summary: {
    formula: string;
    atom_count: number;
    space_group?: string | null;
    space_group_number?: number | null;
    crystal_system?: string | null;
    bond_algorithm?: string | null;
  };
  warnings: string[];
  error?: string;
}

export interface VaspFlowFile {
  name: string;
  size: number;
  ext: string;
}

export interface VaspFlowTaskFiles {
  files: VaspFlowFile[];
  dirs: Array<{ name: string }>;
  error?: string;
}

export interface VaspFlowFileContent {
  name: string;
  size: number;
  content: string;
  truncated: boolean;
  error?: string;
}

async function request<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  if (!serverUrl) throw new Error("VASPFlow requires a connected research runtime");
  const token = await runtimePassword();
  const url = new URL(path, serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`);
  if (token) url.searchParams.set("token", token);
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `VASPFlow request failed (${response.status})`);
  if (body.error) throw new Error(body.error);
  return body;
}

function taskPath(taskId: number, action: string) {
  return `/plugins/dsh-vaspflow/task/${taskId}/${action}`;
}

export function scanVaspProject(serverUrl: string, rootPath: string): Promise<VaspFlowScanResult> {
  const path = `/plugins/dsh-vaspflow/scan?root_path=${encodeURIComponent(rootPath)}`;
  return request(serverUrl, path, { method: "POST" });
}

export function fetchVaspConvergence(serverUrl: string, taskId: number): Promise<VaspFlowConvergence> {
  return request(serverUrl, taskPath(taskId, "convergence"));
}

export function fetchVaspStructureFiles(serverUrl: string, taskId: number): Promise<string[]> {
  return request<{ files: string[] }>(serverUrl, taskPath(taskId, "structure-files")).then((value) => value.files);
}

export function fetchVaspScene(serverUrl: string, taskId: number, file = "CONTCAR"): Promise<VaspFlowScene> {
  const query = `file=${encodeURIComponent(file)}&include_connectivity=true&bond_algorithm=minimum-distance`;
  return request(serverUrl, `${taskPath(taskId, "structure-scene")}?${query}`);
}

export function fetchVaspTaskFiles(serverUrl: string, taskId: number): Promise<VaspFlowTaskFiles> {
  return request(serverUrl, taskPath(taskId, "files"));
}

export function fetchVaspFile(serverUrl: string, taskId: number, name: string): Promise<VaspFlowFileContent> {
  return request(serverUrl, `${taskPath(taskId, "file-content")}?name=${encodeURIComponent(name)}`);
}
