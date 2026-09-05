export type MaterialsRequestKind = "discussion" | "design" | "dft-preparation" | "dft-execution";

const DFT_REQUEST_RE = /(?:\bdft\b|\bvasp\b|\bneb\b|\bincar\b|\bposcar\b|\bpotcar\b|\bdoscar\b|\bbader\b|\bvaspkit\b|密度泛函|第一性原理|从头算|结构优化|表面吸附|过渡态|能垒|电子结构|态密度|电荷密度|吸附能|弛豫|计算化学)/iu;

/** Classify once at the boundary; workflow stages consume this result rather
 * than applying unrelated prompt regexes repeatedly. */
export function classifyMaterialsRequest(text: string): MaterialsRequestKind {
  const normalized = text.trim();
  if (!DFT_REQUEST_RE.test(normalized)) return "discussion";
  return /(?:run|submit|execute|remote|hpc|sbatch|srun|qsub|计算|提交|运行)/iu.test(normalized)
    ? "dft-execution"
    : "dft-preparation";
}

export function shouldRouteToMaterialsWorkflow(text: string): boolean {
  return classifyMaterialsRequest(text) !== "discussion";
}
