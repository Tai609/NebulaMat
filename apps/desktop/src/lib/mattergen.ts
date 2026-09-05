export const MATTERGEN_UPSTREAM = "https://github.com/microsoft/mattergen";
export const MATTERGEN_REVISION = "ac9ddd406171138c3f037d06b9b53fedbbb1c536";

export type MatterGenProperty = string | number;

export interface MatterGenStandardization {
  enabled: true;
  bulk_target_atoms: number;
  bulk_atom_tolerance: number;
  surface_miller_index: [number, number, number] | null;
  surface_layers: number | null;
  surface_target_atoms: number;
  surface_atom_tolerance: number;
  vacuum_angstrom: number;
  surface_min_lateral_angstrom: number;
  surface_max_cell_aspect_ratio: number;
  surface_max_slab_thickness_angstrom: number;
  min_distance_angstrom: number;
  termination_index: number;
}

export interface MatterGenRequest {
  schema_version: 1;
  output_dir: string;
  pretrained_name?: string;
  model_path?: string;
  batch_size: number;
  num_batches: number;
  properties_to_condition_on: Record<string, MatterGenProperty>;
  target_compositions: Array<Record<string, number>>;
  diffusion_guidance_factor?: number;
  record_trajectories: boolean;
  standardization: MatterGenStandardization;
}

export function buildMatterGenRequest(input: {
  chemicalSystem: string;
  samples: number;
  model?: string;
  outputDir?: string;
}): MatterGenRequest {
  const model = input.model?.trim() || "chemical_system";
  const samples = Math.max(1, Math.min(64, Math.round(input.samples)));
  const chemicalSystem = input.chemicalSystem.trim();
  if (!chemicalSystem) throw new Error("MatterGen chemical system is required");
  if (!/^[A-Z][A-Za-z0-9]*(?:-[A-Z][A-Za-z0-9]*)*$/.test(chemicalSystem)) {
    throw new Error("MatterGen chemical system must use dash-separated element symbols");
  }
  return {
    schema_version: 1,
    output_dir: input.outputDir ?? "materials/design/iteration-1/mattergen",
    pretrained_name: model,
    batch_size: samples,
    num_batches: 1,
    properties_to_condition_on: model === "chemical_system" ? { chemical_system: chemicalSystem } : {},
    target_compositions: [],
    record_trajectories: false,
    standardization: {
      enabled: true,
      bulk_target_atoms: 40,
      bulk_atom_tolerance: 0.2,
      surface_miller_index: null,
      surface_layers: null,
      surface_target_atoms: 96,
      surface_atom_tolerance: 0.2,
      vacuum_angstrom: 15,
      surface_min_lateral_angstrom: 12,
      surface_max_cell_aspect_ratio: 4,
      surface_max_slab_thickness_angstrom: 20,
      min_distance_angstrom: 0.8,
      termination_index: 0,
    },
  };
}

export function validateMatterGenRequest(request: MatterGenRequest): string[] {
  const errors: string[] = [];
  if (request.schema_version !== 1) errors.push("unsupported MatterGen request schema");
  if (!request.output_dir.trim() || request.output_dir.includes("..")) errors.push("output_dir must be workspace-relative");
  if (!!request.pretrained_name === !!request.model_path) errors.push("provide exactly one model source");
  if (!Number.isInteger(request.batch_size) || request.batch_size < 1 || request.batch_size > 64) errors.push("batch_size must be between 1 and 64");
  if (!Number.isInteger(request.num_batches) || request.num_batches < 1 || request.num_batches > 32) errors.push("num_batches must be between 1 and 32");
  if (request.batch_size * request.num_batches > 1024) errors.push("requested samples exceed 1024");
  if (!request.standardization || request.standardization.enabled !== true) errors.push("standardization.enabled must be true");
  if (!Number.isInteger(request.standardization?.bulk_target_atoms) || request.standardization.bulk_target_atoms < 1) errors.push("bulk_target_atoms must be positive");
  if (!Number.isFinite(request.standardization?.bulk_atom_tolerance) || request.standardization.bulk_atom_tolerance < 0 || request.standardization.bulk_atom_tolerance >= 1) errors.push("bulk_atom_tolerance must be between 0 and 1");
  if (!Number.isInteger(request.standardization?.surface_target_atoms) || request.standardization.surface_target_atoms < 1) errors.push("surface_target_atoms must be positive");
  if (!Number.isFinite(request.standardization?.surface_atom_tolerance) || request.standardization.surface_atom_tolerance < 0 || request.standardization.surface_atom_tolerance >= 1) errors.push("surface_atom_tolerance must be between 0 and 1");
  if (!Number.isFinite(request.standardization?.vacuum_angstrom) || request.standardization.vacuum_angstrom <= 0) errors.push("vacuum_angstrom must be positive");
  if (!Number.isFinite(request.standardization?.surface_min_lateral_angstrom) || request.standardization.surface_min_lateral_angstrom <= 0) errors.push("surface_min_lateral_angstrom must be positive");
  if (!Number.isFinite(request.standardization?.surface_max_cell_aspect_ratio) || request.standardization.surface_max_cell_aspect_ratio <= 0) errors.push("surface_max_cell_aspect_ratio must be positive");
  if (!Number.isFinite(request.standardization?.surface_max_slab_thickness_angstrom) || request.standardization.surface_max_slab_thickness_angstrom <= 0) errors.push("surface_max_slab_thickness_angstrom must be positive");
  const miller = request.standardization?.surface_miller_index;
  const layers = request.standardization?.surface_layers;
  if ((miller === null) !== (layers === null)) errors.push("surface_miller_index and surface_layers must be provided together");
  if (miller && miller.length !== 3) errors.push("surface_miller_index must contain three integers");
  if (request.diffusion_guidance_factor !== undefined && (!Number.isFinite(request.diffusion_guidance_factor) || request.diffusion_guidance_factor < 0 || request.diffusion_guidance_factor > 20)) {
    errors.push("diffusion_guidance_factor must be between 0 and 20");
  }
  return errors;
}

export function serializeMatterGenRequest(request: MatterGenRequest): string {
  const errors = validateMatterGenRequest(request);
  if (errors.length) throw new Error(errors.join("; "));
  return `${JSON.stringify(request, null, 2)}\n`;
}

export function buildMatterGenTaskPrompt(request: MatterGenRequest, requestPath = `${request.output_dir}/request.json`): string {
  return [
    "请执行一次可审计的 MatterGen 晶体结构生成任务。",
    `先读取请求文件：${requestPath}`,
    `请求内容（若当前运行在浏览器预览，请将这段内容写入上述路径后再执行）：\n\`\`\`json\n${JSON.stringify(request, null, 2)}\n\`\`\``,
    "先读取 NEBULAMAT_MATTERGEN_RUNNER 环境变量指向的安装包内 runner，并用它执行 `--request " + requestPath + " --dry-run` 做参数、样本数和工作区路径预检；不要假设用户 workspace 里存在 runtime/mattergen。若预检显示 chemical_system 权重尚未安装，先引导用户到科学计算环境点击 MatterGen 权重的安装按钮，等待下载和 SHA-256 校验完成后再继续；预检失败就停止并报告原因。",
    "如果运行器提示 Windows 应用托管 venv 尚未就绪，先按 AGENTS.md 的规则执行 WSL2 只读预检：`wsl.exe --exec /root/mattergen/venv/bin/python -c \"import torch, mattergen; print(torch.__version__); print(mattergen.__file__)\"`。若 WSL2 预检通过，优先使用已登记的 WSL2 MatterGen 环境，不要因为 native venv 为空而重新安装 PyTorch 或权重；只有 WSL2 不可用时，才执行 NEBULAMAT_MATTERGEN_SETUP 指向的安装器，并请求审批。",
    "环境准备完成后再运行同一命令（去掉 --dry-run）。在 Windows 上使用 WSL2 时，将请求、runner、模型目录转换为 `/mnt/c/...` 路径后通过 `/root/mattergen/venv/bin/python` 执行；如果当前平台无法提供上游要求的 CUDA/PyG wheel，说明缺口，并使用已登记的 Linux/Slurm/SSH GPU 计算机执行。",
    `输出目录必须保持为 ${request.output_dir}，不要覆盖其他迭代的结果。生成完成后读取 mattergen-run.json，确认每个 structure-*.cif 的 SHA-256 和数量。`,
    "所有请求、脚本、CIF、manifest 和计算结果都必须写入当前会话工作区；不得使用仓库根目录、其他会话目录或历史上记住的绝对路径作为输出位置。",
    "这里的‘标准化’只指：将 MatterGen 原始小晶胞扩展到声明的可比 bulk 原子数窗口（默认约 40 原子）；如果需要表面，surface_layers 必须表示沿 cross(a,b) 真实表面法向统计的原子平面数，vacuum_angstrom 必须表示总真空间隔，并且只做面内扩展到默认约 96 原子。标准表面还必须满足最短面内边不小于 12 Å、c/min(a,b) 不大于 4、实体厚度不大于 20 Å。原子排序、化学式约分、对称性改写或原子数不变的 CIF/POSCAR 重写都不算标准化。对旧的原始 CIF，必须调用 `standardize_mattergen_structure`，不得自建简化脚本替代。",
    "MatterGen 结果只是候选结构，不是稳定性或实验结论。生成完成后必须先读取 mattergen-run.json 中的 standardization 记录和 standardized/standardization-manifest.json：原始 structure-*.cif 和旧版 manifest 永远不能直接进入计算。MatterSim 只能使用 manifest 登记且 hash 一致的 standardized bulk（固定 MatterSim-v1.0.0-5M），但它是可选 bulk 代理，不是进入表面动力学前的必经热稳定性阶段。若要做表面，必须在请求中明确给出 Miller 面、真实原子平面数、表面目标原子数和总真空厚度，并使用 standardized surface。UMA 吸附能只能调用 run_uma_adsorption_energy_screen：slab、孤立 adsorbate、adsorbed slab 三份结构必须都有标准化 provenance，默认固定底部 3 个真实平面，三者全部先弛豫且全部收敛后才能求能；relax=false、未收敛结果和自建直接单点能脚本一律保持 hold。表面动力学必须调用 run_uma_surface_md：对完整吸附体系默认做 2×2×1 面内扩胞以保持覆盖度，固定底部两层，使用 ASE 积分和 UMA 势；不得沿真空方向扩胞或对 slab 使用普通三维 NPT。缺少标准化 manifest、hash 不匹配、层数或横向尺寸不一致时保持 hold，不得绕过门控。",
  ].join("\n\n");
}
