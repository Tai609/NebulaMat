export type MaterialsRequestKind = "discussion" | "design" | "dft-preparation" | "dft-execution";

const DFT_REQUEST_RE = /(?:\bdft\b|\bvasp\b|\bneb\b|\bincar\b|\bposcar\b|\bpotcar\b|\bdoscar\b|\bbader\b|\bvaspkit\b|密度泛函|第一性原理|从头算|结构优化|表面吸附|过渡态|能垒|电子结构|态密度|电荷密度|吸附能|弛豫|计算化学)/iu;
const DISCOVERY_REQUEST_RE = /(?:github|gitlab|开源|代码(?:仓库|项目)?|仓库|repo(?:sitory)?|skill|技能|agent|智能体|工具|插件)/iu;
const DISCOVERY_INTENT_RE = /(?:搜索|搜寻|查找|寻找|检索|浏览|有没有|是否有|推荐|search|find|look\s*(?:for|up)|browse|discover)/iu;
const CAPABILITY_DISCOVERY_RE = /(?:能够|可以|能否|能(?=\s*(?:运行|执行|做|进行))|用于|帮助|辅助|可用来|capable|can|helps?|support(?:s|ed)?)/iu;
// Keep this list imperative. Nouns such as "DFT calculation" or "workflow"
// describe the capability being discovered and must not turn a repository
// search into an execution request.
const MATERIAL_OPERATION_RE = /(?:运行|执行|提交|开始|准备|生成|设计|构建|优化|模拟|筛选|弛豫|run|execute|submit|start|prepare|generate|design|build|optim(?:ize|ise)|simulat(?:e|ion)|screen|relax)/iu;

/** Classify once at the boundary; workflow stages consume this result rather
 * than applying unrelated prompt regexes repeatedly. */
export function classifyMaterialsRequest(text: string): MaterialsRequestKind {
  const normalized = text.trim();
  // A request to find code, skills, agents, or repositories is a research or
  // browsing task even when it mentions DFT. Do not turn discovery into a
  // materials workflow unless the same request explicitly asks to operate it.
  if (DISCOVERY_REQUEST_RE.test(normalized)
    && DISCOVERY_INTENT_RE.test(normalized)
    && (CAPABILITY_DISCOVERY_RE.test(normalized) || !MATERIAL_OPERATION_RE.test(normalized))) {
    return "discussion";
  }
  if (!DFT_REQUEST_RE.test(normalized)) return "discussion";
  return /(?:run|submit|execute|remote|hpc|sbatch|srun|qsub|计算|提交|运行)/iu.test(normalized)
    ? "dft-execution"
    : "dft-preparation";
}

export function shouldRouteToMaterialsWorkflow(text: string): boolean {
  return classifyMaterialsRequest(text) !== "discussion";
}
