/* eslint-disable i18next/no-literal-string -- Chinese-first materials studio prototype; navigation remains localized. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Atom,
  Beaker,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  FlaskConical,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useRuntimeStore } from "@/lib/runtime";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { listDir, writeWorkspaceFile } from "@/lib/artifactFile";
import { isTauri, listDshMcpServers } from "@/lib/tauri";
import { buildDftCacheKey, writeMaterialsCheckpoint } from "@/lib/dftCache";
import { buildMatterGenRequest, buildMatterGenTaskPrompt, serializeMatterGenRequest } from "@/lib/mattergen";
import type { MaterialsDesignStage } from "@ai4s/shared";

// Keep the visual route on the same namespaced stage vocabulary as the shared
// DFT state machine. A page label must never invent a parallel "synthesis"
// state that the scheduler/provenance layer cannot resume.
type StageId = MaterialsDesignStage;
const MATTERGEN_STATE_KEY = "openscience.materials.mattergen.iteration-1";

const stages: Array<{ id: StageId; label: string; short: string }> = [
  { id: "materials.goal", label: "定义目标", short: "目标" },
  { id: "materials.evidence", label: "证据对标", short: "证据" },
  { id: "materials.hypothesis", label: "设计假设", short: "设计" },
  { id: "materials.synthesis", label: "合成方案", short: "合成" },
  { id: "materials.experiment", label: "实验迭代", short: "实验" },
];

const benchmarks = [
  {
    id: "mp-19017",
    name: "LiFePO₄",
    source: "Materials Project · mp-19017",
    strength: "热稳定性高，资源丰富",
    gap: "倍率性能和低温电导率受限",
    property: "3.4 V",
    metric: "工作电压",
    tone: "accent",
  },
  {
    id: "oqmd-88421",
    name: "LiMnPO₄",
    source: "OQMD · oqmd-88421",
    strength: "更高电压平台，结构稳定",
    gap: "电子电导率低，合成窗口窄",
    property: "4.1 V",
    metric: "工作电压",
    tone: "blue",
  },
  {
    id: "aflow-2249",
    name: "LiFe₀.₅Mn₀.₅PO₄",
    source: "AFLOW · aflow-2249",
    strength: "兼顾成本与能量密度",
    gap: "相分离风险，循环衰减快",
    property: "162 mAh g⁻¹",
    metric: "理论容量",
    tone: "green",
  },
];

const synthesisSteps = [
  { title: "前驱体配比", detail: "Li₂CO₃、FeC₂O₄·2H₂O、MnC₂O₄·2H₂O，按化学计量比称量" },
  { title: "湿法球磨", detail: "乙醇介质，400 rpm · 6 h；记录浆料固含量和粒径" },
  { title: "预烧结", detail: "Ar 气氛 · 350 °C · 4 h，去除有机物并固定前驱体形貌" },
  { title: "主烧结", detail: "Ar/H₂ (95:5) · 680 °C · 8 h；升温速率 3 °C min⁻¹" },
];

function MoleculePreview({ generated }: { generated: boolean }) {
  return (
    <div className="relative h-[188px] overflow-hidden rounded-input border border-border bg-[#202a2b] p-4 text-white">
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="relative flex h-full items-center justify-center">
        <div className="relative h-32 w-44">
          {[...Array(9)].map((_, index) => {
            const x = [18, 76, 134, 18, 76, 134, 18, 76, 134][index];
            const y = [12, 12, 12, 58, 58, 58, 104, 104, 104][index];
            const center = index === 4;
            return (
              <span
                key={index}
                className={cn(
                  "absolute grid h-7 w-7 place-items-center rounded-full border text-[9px] font-semibold shadow-[0_0_18px_rgba(89,201,166,.45)]",
                  center
                    ? "border-[#f2c66d] bg-[#d99d43] text-[#2b2012]"
                    : generated
                      ? "border-[#6de0bd] bg-[#267560] text-[#d9fff1]"
                      : "border-[#9bb8bd] bg-[#496266] text-[#e9f7f7]",
                )}
                style={{ left: x, top: y }}
              >
                {center ? "Fe" : index % 3 === 0 ? "O" : "P"}
              </span>
            );
          })}
          <span className="absolute left-[39px] top-[26px] h-px w-[92px] rotate-0 bg-[#9bc9bf]/50" />
          <span className="absolute left-[39px] top-[72px] h-px w-[92px] rotate-0 bg-[#9bc9bf]/50" />
          <span className="absolute left-[39px] top-[50px] h-[46px] w-px bg-[#9bc9bf]/50" />
          <span className="absolute left-[97px] top-[50px] h-[46px] w-px bg-[#9bc9bf]/50" />
        </div>
      </div>
      <div className="absolute bottom-3 left-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/60">
        <Atom size={13} />
        {generated ? "MatterGen · CIF output available" : "MatterGen · awaiting generated CIF"}
      </div>
    </div>
  );
}

export function MaterialsDesignPage() {
  const navigate = useNavigate();
  const runtimeStatus = useRuntimeStore((s) => s.status);
  const startDraft = useRuntimeStore((s) => s.startDraft);
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);
  const [activeStage, setActiveStage] = useState<StageId>("materials.goal");
  const [workflowStage, setWorkflowStage] = useState<StageId>("materials.goal");
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [goal, setGoal] = useState("高温磷酸盐正极");
  const [selectedBenchmark, setSelectedBenchmark] = useState(0);
  const [generationPhase, setGenerationPhase] = useState<"idle" | "submitted" | "ready">(() => {
    try {
      const persisted = localStorage.getItem(MATTERGEN_STATE_KEY);
      return persisted === "submitted" || persisted === "ready" ? persisted : "idle";
    } catch {
      return "idle";
    }
  });
  const [mattergenModel, setMattergenModel] = useState("chemical_system");
  const [mattergenChemicalSystem, setMattergenChemicalSystem] = useState("Li-Fe-Mn-Mg-P-O");
  const [mattergenSamples, setMattergenSamples] = useState(4);
  const [mattergenArtifactCount, setMattergenArtifactCount] = useState(0);
  const [mattergenSubmitError, setMattergenSubmitError] = useState<string | null>(null);
  const [experimentNotes, setExperimentNotes] = useState("");
  const [experimenterId, setExperimenterId] = useState("");
  const [measurementSummary, setMeasurementSummary] = useState("");
  const [deviations, setDeviations] = useState("");
  const [rawDataPaths, setRawDataPaths] = useState("");
  const [experimentLogged, setExperimentLogged] = useState(false);
  const [experimentArtifactPath, setExperimentArtifactPath] = useState<string | null>(null);
  const [experimentSaveError, setExperimentSaveError] = useState<string | null>(null);
  const [materialsMcpState, setMaterialsMcpState] = useState<"checking" | "connected" | "missing" | "failed">("checking");
  const [mcpRefreshKey, setMcpRefreshKey] = useState(0);

  useEffect(() => {
    if (generationPhase === "idle") return;
    let cancelled = false;
    const checkForGeneratedCifs = async () => {
      const entries = await listDir("materials/design/iteration-1/mattergen").catch(() => []);
      const count = entries.filter((entry) => !entry.isDir && /^structure-\d+\.cif$/i.test(entry.name)).length;
      if (!cancelled && count > 0) {
        setMattergenArtifactCount(count);
        setGenerationPhase("ready");
        try {
          localStorage.setItem(MATTERGEN_STATE_KEY, "ready");
        } catch {
          /* localStorage is only a resume hint */
        }
      }
    };
    void checkForGeneratedCifs();
    if (generationPhase !== "submitted") return () => {
      cancelled = true;
    };
    const timer = window.setInterval(() => void checkForGeneratedCifs(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [generationPhase]);

  useEffect(() => {
    let cancelled = false;
    const checkMaterialsMcp = async () => {
      if (runtimeStatus !== "ready") {
        setMaterialsMcpState("missing");
        return;
      }
      try {
        const server = (await listDshMcpServers()).find((item) => item.name === "materials-mcp");
        if (cancelled) return;
        setMaterialsMcpState(
          server?.status === "configured" ? "connected" : server ? "failed" : "missing",
        );
      } catch {
        if (!cancelled) setMaterialsMcpState("failed");
      }
    };
    void checkMaterialsMcp();
    return () => {
      cancelled = true;
    };
  }, [mcpRefreshKey, runtimeStatus]);

  const selected = benchmarks[selectedBenchmark];
  const materialsConnected = materialsMcpState === "connected";
  const generated = generationPhase === "ready";
  const designInputKey = useMemo(
    () => buildDftCacheKey({ code: "materials-design-v1", model: selected.name, parameters: { goal, benchmark: selected.id }, software: "dsh" }),
    [goal, selected],
  );
  const checkpoint = (stage: StageId, taskId: string, reason?: string): boolean => {
    try {
      writeMaterialsCheckpoint("materials-design", stage, taskId, designInputKey, true, reason);
      setWorkflowStage(stage);
      setActiveStage(stage);
      setWorkflowError(null);
      return true;
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const designBrief = useMemo(
    () =>
      `请作为材料设计负责人，调用 materials-mcp.create_materials_workflow 并设置 design_mode=true，围绕“${goal}”设计一轮可验证的新材料方案。\n\n` +
      `目标：在保留 LiFePO₄ 热稳定性和低成本优势的同时，提高低温电导率与倍率性能。\n` +
      `对标：${selected.name}（${selected.source}）。优点：${selected.strength}。已知短板：${selected.gap}。\n` +
      `请先做文献与数据库检索，再提出至少 3 个不复刻原材料的设计假设；对每个假设给出结构/组分变化、预期机制、风险和可证伪实验。\n` +
      `对最优假设输出带安全注意事项、关键参数、表征项目和失败分支的合成方案，并把证据、假设和待验证项分开标记。`,
    [goal, selected],
  );

  const benchmarkSearchBrief = useMemo(
    () =>
      `请作为 materials-discovery，调用 materials-mcp.search_materials 检索“${goal}”及其近邻组成。\n` +
      `返回至少 3 个可对标材料，逐条保留 provider、material_id、化学式、关键性能的原始单位、结构文件和来源链接；缺失字段必须明确标记。\n` +
      `不要把检索结果直接当作新材料结论，另列出每个对标材料的已知优势、失败模式和需要文献复核的字段，并写入当前材料设计工作流。`,
    [goal],
  );

  const openAgent = () => {
    if (!checkpoint("materials.goal", "materials:design:1")) return;
    startDraft();
    setComposerDraft(designBrief);
    navigate("/live");
  };

  const openBenchmarkSearch = () => {
    if (!checkpoint("materials.goal", "materials:design:1") || !checkpoint("materials.evidence", "materials:benchmark:1")) return;
    startDraft();
    setComposerDraft(benchmarkSearchBrief);
    navigate("/live");
  };

  const submitMatterGen = async () => {
    setMattergenSubmitError(null);
    let request: ReturnType<typeof buildMatterGenRequest>;
    try {
      request = buildMatterGenRequest({
        chemicalSystem: mattergenChemicalSystem,
        samples: mattergenSamples,
        model: mattergenModel,
      });
    } catch (error) {
      setMattergenSubmitError(error instanceof Error ? error.message : String(error));
      return;
    }
    const requestPath = `${request.output_dir}/request.json`;
    try {
      await writeWorkspaceFile(requestPath, serializeMatterGenRequest(request));
    } catch (error) {
      if (isTauri) {
        setMattergenSubmitError(error instanceof Error ? error.message : "无法写入 MatterGen 请求文件");
        return;
      }
      // Browser preview has no workspace bridge; the prompt still carries the
      // complete request for testing and agent handoff.
    }
    if (!checkpoint("materials.hypothesis", "materials:mattergen:1", "MatterGen request submitted; candidate structures pending")) return;
    setGenerationPhase("submitted");
    try {
      localStorage.setItem(MATTERGEN_STATE_KEY, "submitted");
    } catch {
      /* localStorage is only a resume hint */
    }
    setMattergenArtifactCount(0);
    startDraft();
    setComposerDraft(buildMatterGenTaskPrompt(request, requestPath));
    navigate("/live");
  };

  const experimentArtifact = useMemo(() => {
    const paths = rawDataPaths
      .split(/[,\n]/)
      .map((path) => path.trim())
      .filter(Boolean);
    return [
      "# Human experiment record",
      "",
      "- workflow_stage: experiment:record:1",
      `- human_actor: ${experimenterId.trim()}`,
      `- benchmark: ${selected.name} (${selected.source})`,
      "- status: human-authored; interpretation pending",
      "",
      "## Observation",
      experimentNotes.trim() || "(not provided)",
      "",
      "## Measurements",
      measurementSummary.trim() || "(not provided)",
      "",
      "## Deviations and failures",
      deviations.trim() || "None reported",
      "",
      "## Raw data paths",
      ...(paths.length ? paths.map((path) => `- ${path}`) : ["- (not provided)"]),
      "",
      "This record is immutable input to experiment:interpret:1. Do not replace it with AI-generated text.",
      "",
    ].join("\n");
  }, [deviations, experimentNotes, experimenterId, measurementSummary, rawDataPaths, selected]);

  const saveExperiment = async () => {
    if (experimentLogged || !experimenterId.trim() || !experimentNotes.trim()) return;
    if (!generated) {
      setExperimentSaveError("请先生成并审核至少一个候选假设，再记录实验结果。");
      return;
    }
    if (!checkpoint("materials.synthesis", "materials:synthesis:1")) return;
    const path = "materials/design/iteration-1/experiment-record.md";
    setExperimentSaveError(null);
    try {
      await writeWorkspaceFile(path, experimentArtifact);
      setExperimentArtifactPath(path);
    } catch {
      if (isTauri) {
        setExperimentSaveError("实验记录写入失败，请确认当前工作区可写后重试。");
        return;
      }
      // Browser preview has no workspace write bridge; keep the record in this
      // page and include it verbatim when handing the task to the agent.
      setExperimentArtifactPath(null);
    }
    if (!checkpoint("materials.experiment", "materials:experiment:record:1", "human experiment record pending interpretation")) return;
    setExperimentLogged(true);
  };

  const interpretExperiment = () => {
    if (!checkpoint("materials.interpretation", "materials:experiment:interpret:1")) return;
    const artifact = experimentArtifactPath ?? "the human experiment record shown in the Materials Lab";
    startDraft();
    setComposerDraft(
      `请作为 materials-designer 执行 experiment:interpret:1。只读取并引用人类实验记录 ${artifact}，不要改写或补齐缺失数据。\n` +
        `将预测与测量逐项对照，保留失败假设，明确 stop、scale 或 iterate 的唯一建议，并列出下一轮设计需要的证据。` +
        (experimentArtifactPath ? " 记录已写入工作区，请先读取该文件。" : `\n\n当前记录内容：\n${experimentArtifact}`),
    );
    navigate("/live");
  };

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-[1480px] px-5 pb-12 pt-5 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              <Atom size={14} strokeWidth={1.8} />
              NebulaMat · Materials Lab
            </div>
            <h1 className="mt-2 font-serif text-[29px] leading-tight text-text sm:text-[34px]">材料设计工作台</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
              从证据出发，设计比对标材料更进一步的候选，并把每个假设变成可执行的合成与实验。
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5", materialsConnected ? "border-ok/25 bg-ok/10 text-ok" : materialsMcpState === "failed" ? "border-warn/30 bg-warn/10 text-warn" : "border-border bg-surface-2 text-muted")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", materialsConnected ? "bg-ok" : materialsMcpState === "failed" ? "bg-warn" : "bg-muted")} />
              {materialsMcpState === "checking" ? "正在检查材料 MCP" : materialsConnected ? "材料 MCP 已连接" : materialsMcpState === "failed" ? "材料 MCP 连接异常" : "材料 MCP 待连接"}
            </span>
            <button
              onClick={() => setMcpRefreshKey((value) => value + 1)}
              title="刷新材料 MCP 状态"
              aria-label="刷新材料 MCP 状态"
              className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={openAgent}
              className="inline-flex items-center gap-2 rounded-input bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg shadow-card transition-transform active:translate-y-px"
            >
              <Sparkles size={15} />
              交给 AI 设计代理
            </button>
          </div>
        </header>

        <nav aria-label="材料设计阶段" className="mt-5 overflow-x-auto pb-1">
          <ol className="flex min-w-[720px] items-center">
            {stages.map((stage, index) => {
              const isActive = activeStage === stage.id;
              const reached = stages.findIndex((stage) => stage.id === workflowStage);
              const isComplete = index < reached || (index === reached && index === stages.length - 1 && experimentLogged);
              return (
                <li key={stage.id} className="flex min-w-0 flex-1 items-center">
                  <button
                    onClick={() => setActiveStage(stage.id)}
                    className={cn(
                      "group flex min-w-0 items-center gap-2 text-left outline-none",
                      isActive ? "text-text" : "text-muted hover:text-text",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors",
                        isActive && "border-accent bg-accent text-accent-fg",
                        !isActive && isComplete && "border-ok/50 bg-ok/10 text-ok",
                        !isActive && !isComplete && "border-border bg-surface text-muted",
                      )}
                    >
                      {isComplete && !isActive ? <Check size={13} /> : index + 1}
                    </span>
                    <span className="hidden text-xs font-medium sm:block">{stage.label}</span>
                    <span className="text-xs font-medium sm:hidden">{stage.short}</span>
                  </button>
                  {index < stages.length - 1 && <span className="mx-3 h-px flex-1 bg-border" />}
                </li>
              );
            })}
          </ol>
        </nav>
        {workflowError && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-input border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
            <CircleAlert size={14} className="mt-0.5 shrink-0" /> {workflowError}
          </p>
        )}

        <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(250px,0.82fr)_minmax(420px,1.48fr)_minmax(290px,0.92fr)]">
          <div className="space-y-4">
            <section className="rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">01 · 研究目标</p>
                  <input
                    aria-label="材料设计目标"
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    className="mt-1 w-full min-w-0 bg-transparent text-[15px] font-semibold text-text outline-none placeholder:text-muted focus:border-b focus:border-accent"
                  />
                </div>
                <BookOpen size={17} className="text-muted" />
              </div>
              <div className="mt-4 space-y-3">
                {[
                  ["核心指标", "低温电导率", "> 10⁻⁴ S cm⁻¹ @ 25 °C"],
                  ["保留优势", "热稳定性", "> 650 °C · 低成本元素"],
                  ["约束条件", "可放大合成", "空气敏感性低 · 原料可得"],
                ].map(([label, title, value]) => (
                  <div key={label} className="border-l-2 border-accent/35 pl-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
                    <div className="mt-1 text-[13px] font-medium text-text">{title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-muted">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-input bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
                设计原则：明确区分已知证据、推断机制和需要实验验证的假设。
              </div>
            </section>

            <section className="rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">02 · 对标材料</p>
                  <h2 className="mt-1 text-[15px] font-semibold text-text">优点与缺口</h2>
                </div>
                <button onClick={openBenchmarkSearch} title="重新检索数据库" aria-label="重新检索数据库" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                  <RotateCcw size={14} />
                </button>
              </div>
              <div className="mt-3 divide-y divide-border">
                {benchmarks.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedBenchmark(index);
                      setActiveStage("materials.evidence");
                    }}
                    className={cn(
                      "group flex w-full items-start gap-3 py-3 text-left first:pt-1 last:pb-1",
                      selectedBenchmark === index && "text-text",
                    )}
                  >
                    <span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", item.tone === "accent" && "bg-accent", item.tone === "blue" && "bg-link", item.tone === "green" && "bg-ok")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium">{item.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted">{item.property}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted">{item.source}</span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-muted">优点：{item.strength}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-warn">缺口：{item.gap}</span>
                    </span>
                    <ChevronRight size={14} className={cn("mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5", selectedBenchmark === index && "text-accent")} />
                  </button>
                ))}
              </div>
              <button onClick={openAgent} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
                <ArrowUpRight size={13} /> 查看证据链与原始来源
              </button>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">03 · 设计空间</p>
                  <h2 className="mt-1 text-[15px] font-semibold text-text">不复刻，寻找可证伪的新组合</h2>
                </div>
                <span className="rounded-full border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] font-medium text-warn">假设 · 待验证</span>
              </div>
              <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">
                AI 将从对标材料的机制优点与失效模式出发，在允许的元素、结构和工艺空间内提出候选；每个候选都必须绑定证据、风险和实验判据。
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-[1.04fr_0.96fr]">
                <MoleculePreview generated={generated} />
                <div className="rounded-input border border-border bg-surface-2 p-3">
                  {generated ? (
                    <>
                      <div className="flex items-center gap-2 text-xs font-semibold text-ok"><Check size={14} /> MatterGen 结构已生成</div>
                      <h3 className="mt-3 text-base font-semibold text-text">{mattergenArtifactCount} 个 CIF 候选</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">真实晶胞和原子坐标已写入工作区；请在结构查看器中检查几何，再进入 MatterSim/DFT 验证。</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                        <div><span className="text-muted">模型</span><div className="mt-0.5 font-medium text-text">{mattergenModel}</div></div>
                        <div><span className="text-muted">输出</span><div className="mt-0.5 font-medium text-warn">待稳定性验证</div></div>
                      </div>
                    </>
                  ) : generationPhase === "submitted" ? (
                    <>
                      <div className="flex items-center gap-2 text-xs font-semibold text-accent"><Sparkles size={14} /> MatterGen 任务已提交</div>
                      <p className="mt-3 text-[11px] leading-relaxed text-muted">代理会先执行 dry-run 预检，再在已安装的 MatterGen/CUDA 环境中生成 CIF。生成文件出现后，这里会显示实际数量。</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-xs font-semibold text-text"><Sparkles size={14} className="text-accent" /> 等待设计假设</div>
                      <p className="mt-3 text-[11px] leading-relaxed text-muted">配置 MatterGen 的化学体系和样本数。提交后会生成请求文件，由代理在本地或已登记的 GPU 计算机执行。</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.35fr_0.7fr]">
                        <label className="text-[10px] text-muted">预训练模型<select aria-label="MatterGen 模型" value={mattergenModel} onChange={(event) => setMattergenModel(event.target.value)} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent"><option value="chemical_system">chemical_system</option><option value="mattergen_base">mattergen_base</option></select></label>
                        <label className="text-[10px] text-muted">化学体系<input aria-label="MatterGen 化学体系" value={mattergenChemicalSystem} onChange={(event) => setMattergenChemicalSystem(event.target.value)} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent" placeholder="Li-Fe-Mn-Mg-P-O" /></label>
                        <label className="text-[10px] text-muted">样本数<input aria-label="MatterGen 样本数" type="number" min={1} max={64} value={mattergenSamples} onChange={(event) => setMattergenSamples(Number(event.target.value) || 1)} className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus:border-accent" /></label>
                      </div>
                      <button
                        onClick={() => void submitMatterGen()}
                        className="mt-4 inline-flex items-center gap-2 rounded-input bg-text px-3 py-2 text-xs font-medium text-surface transition-transform active:translate-y-px disabled:cursor-wait disabled:opacity-60"
                      >
                        <Sparkles size={13} />
                        提交 MatterGen 结构生成
                      </button>
                      {mattergenSubmitError && <p role="alert" className="mt-2 text-[11px] leading-relaxed text-danger">{mattergenSubmitError}</p>}
                    </>
                  )}
                </div>
              </div>
              {generated && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <div className="flex items-center gap-2 text-[11px] text-muted"><FileText size={14} /> 6 篇文献 · 3 个数据库记录 · 2 条机制证据</div>
                  <button onClick={openAgent} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">让 AI 再提出 2 个备选 <ChevronRight size={13} /></button>
                </div>
              )}
            </section>

            <section className="rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">04 · 合成方案</p>
                  <h2 className="mt-1 text-[15px] font-semibold text-text">把结构假设变成实验动作</h2>
                </div>
                {generated ? <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ok"><Check size={13} /> 参数草案就绪</span> : <span className="text-[11px] text-muted">生成候选后解锁</span>}
              </div>
              <div className={cn("mt-3 space-y-0", !generated && "opacity-50") }>
                {synthesisSteps.map((step, index) => (
                  <div key={step.title} className="flex gap-3 border-l border-border pb-3 pl-4 last:pb-0">
                    <span className="relative -ml-[21px] mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-border bg-surface text-[9px] font-semibold text-muted">{index + 1}</span>
                    <div className="min-w-0"><div className="text-xs font-medium text-text">{step.title}</div><div className="mt-0.5 text-[11px] leading-relaxed text-muted">{step.detail}</div></div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-input border border-warn/25 bg-warn/10 px-3 py-2.5 text-[11px] leading-relaxed text-warn"><CircleAlert size={14} className="mt-0.5 shrink-0" /> 所有温度、气氛和升温速率是待审参数；提交实验前请由实验人员核对设备上限、SDS 和废弃物处置要求。</div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">05 · 实验迭代</p><h2 className="mt-1 text-[15px] font-semibold text-text">人类结果，回到设计空间</h2></div>
                <FlaskConical size={17} className="text-muted" />
              </div>
              <div className="mt-4 rounded-input border border-dashed border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-text">Iteration 01 · 尚未开始</span><span className="text-[10px] text-muted">需要实验结果</span></div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">记录 XRD、SEM、ICP、倍率和循环数据。AI 只会基于你确认的结果更新下一轮假设。</p>
                <button onClick={() => setActiveStage("materials.experiment")} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"><FileText size={13} /> 打开实验记录</button>
              </div>
              <div className="mt-3 space-y-2">
                {["结构是否形成目标相", "目标性能是否超过对标", "失败模式是否解释得通"].map((item) => <div key={item} className="flex items-center gap-2 text-[11px] text-muted"><span className="h-3.5 w-3.5 rounded border border-border bg-surface" />{item}</div>)}
              </div>
            </section>

            <section className="rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">实验反馈</p><h2 className="mt-1 text-[15px] font-semibold text-text">先记录，再让 AI 解释</h2></div><span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] text-muted">可追溯</span></div>
              <input aria-label="实验者 ID" value={experimenterId} onChange={(event) => setExperimenterId(event.target.value)} placeholder="实验者 ID（必填）" className="mt-3 w-full rounded-input border border-border bg-surface-2 px-3 py-2 text-xs text-text outline-none placeholder:text-muted focus:border-accent" />
              <textarea aria-label="实验观察" value={experimentNotes} onChange={(event) => setExperimentNotes(event.target.value)} placeholder="实验观察（必填）：例如 650 °C 样品出现少量杂相" className="mt-2 min-h-[82px] w-full resize-y rounded-input border border-border bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-text outline-none placeholder:text-muted focus:border-accent" />
              <textarea aria-label="测量结果" value={measurementSummary} onChange={(event) => setMeasurementSummary(event.target.value)} placeholder="测量结果：XRD、SEM、ICP、倍率、循环和电导率" className="mt-2 min-h-[70px] w-full resize-y rounded-input border border-border bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-text outline-none placeholder:text-muted focus:border-accent" />
              <textarea aria-label="实验偏差与失败" value={deviations} onChange={(event) => setDeviations(event.target.value)} placeholder="偏差、失败和未完成项目" className="mt-2 min-h-[58px] w-full resize-y rounded-input border border-border bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-text outline-none placeholder:text-muted focus:border-accent" />
              <input aria-label="原始数据路径" value={rawDataPaths} onChange={(event) => setRawDataPaths(event.target.value)} placeholder="原始数据路径（可用逗号分隔）" className="mt-2 w-full rounded-input border border-border bg-surface-2 px-3 py-2 text-xs text-text outline-none placeholder:text-muted focus:border-accent" />
              <button onClick={() => void saveExperiment()} disabled={experimentLogged || !experimenterId.trim() || !experimentNotes.trim()} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-input border border-border bg-surface px-3 py-2 text-xs font-medium text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"><Check size={13} /> {experimentLogged ? "已保存到迭代记录" : "保存实验结果"}</button>
              {experimentSaveError && <p role="alert" className="mt-2 text-[11px] leading-relaxed text-danger">{experimentSaveError}</p>}
              {experimentLogged && <>
                <p className="mt-2 text-[11px] leading-relaxed text-ok">结果已锁定为实验事实；记录不会被 AI 覆盖。</p>
                <button onClick={interpretExperiment} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-input bg-accent px-3 py-2 text-xs font-medium text-accent-fg"><Sparkles size={13} /> 交给 AI 解读并规划下一轮</button>
              </>}
            </section>

            <section className="rounded-card border border-accent/25 bg-accent/5 p-4">
              <div className="flex items-start gap-3"><Beaker size={18} className="mt-0.5 shrink-0 text-accent" /><div><h2 className="text-[14px] font-semibold text-text">下一步建议</h2><p className="mt-1.5 text-xs leading-relaxed text-muted">先检索 2020 年后的 Mn/Mg 共掺杂证据，再用 3 个候选配方做小试矩阵，优先验证相纯度与低温电导率。</p><button onClick={openAgent} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">创建这轮设计任务 <ArrowUpRight size={13} /></button></div></div>
            </section>
          </div>
        </section>

        <section className="mt-4 rounded-card border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">设计记录</p><h2 className="mt-1 text-[15px] font-semibold text-text">证据、假设与结果的同一条时间线</h2></div><button onClick={openAgent} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">查看完整工作流 <ChevronRight size={13} /></button></div>
          <div className="grid gap-0 md:grid-cols-3">
            {[
              ["已完成", "文献 + 数据库对标", "6 篇文献 · 3 个来源", "text-ok"],
              [generated ? "已生成" : "下一步", "AI-01 设计假设", generated ? "机制、风险、判据已拆分" : "等待生成候选", generated ? "text-ok" : "text-accent"],
              [experimentLogged ? "已记录" : "待实验", "人类实验反馈", experimentLogged ? "结果进入下一轮" : "用真实结果闭环", experimentLogged ? "text-ok" : "text-muted"],
            ].map(([status, title, detail, tone], index) => (
              <div key={title} className={cn("flex gap-3 px-4 py-4", index > 0 && "border-t border-border md:border-l md:border-t-0")}><span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", status === "已完成" || status === "已生成" || status === "已记录" ? "bg-ok" : "bg-accent")} /><div><div className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", tone)}>{status}</div><div className="mt-1 text-xs font-medium text-text">{title}</div><div className="mt-0.5 text-[11px] text-muted">{detail}</div></div></div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
