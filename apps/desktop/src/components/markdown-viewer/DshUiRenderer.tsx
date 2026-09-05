/* eslint-disable i18next/no-literal-string -- renderer fallbacks mirror the dsh-genui protocol labels. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { openExternal } from "@/lib/tauri";

export type DshUiAction = (action: string, payload: Record<string, unknown>) => void;
type JsonObject = Record<string, unknown>;

interface DshUiContextValue {
  emit: DshUiAction | undefined;
  fields: Record<string, string>;
  setField: (id: string, value: string) => void;
  answers: Record<string, string>;
  setAnswer: (group: string, value: string) => void;
  meta: Record<string, DshUiQuestionMeta>;
  registerMeta: (group: string, meta: DshUiQuestionMeta) => void;
  reset: () => void;
  locked: boolean;
  setLocked: (locked: boolean) => void;
}

interface DshUiQuestionMeta {
  label: string;
  options: string[];
  answer?: number | string;
  explanation?: string;
}

const DshUiContext = createContext<DshUiContextValue | null>(null);

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function nodeItems(node: JsonObject): JsonObject[] {
  return Array.isArray(node.items) ? node.items.map(objectValue) : [];
}

function nodeLabel(node: JsonObject): string {
  return stringValue(node.label ?? node.title ?? node.content);
}

function actionPayload(node: JsonObject, extra: JsonObject = {}): JsonObject {
  const id = typeof node.id === "string" ? { id: node.id } : {};
  return { type: stringValue(node.type), ...id, ...extra };
}

function ControlLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium text-muted">{children}</span>;
}

function ButtonNode({ node }: { node: JsonObject }) {
  const context = useContext(DshUiContext);
  const action = typeof node.action === "string" ? node.action : "";
  const [fired, setFired] = useState(false);
  return (
    <button
      type="button"
      disabled={!action || !context?.emit}
      onClick={() => {
        if (!action || !context?.emit) return;
        context.emit(action, actionPayload(node));
        setFired(true);
        window.setTimeout(() => setFired(false), 1200);
      }}
      className={cn(
        "rounded-input border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        node.tone === "primary" && "border-accent bg-accent text-accent-fg hover:opacity-90",
        node.tone === "danger" && "border-error/40 bg-error/10 text-error hover:bg-error/20",
        node.tone === "success" && "border-success/40 bg-success/10 text-success hover:bg-success/20",
        node.tone === "ghost" && "border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-text",
        !["primary", "danger", "success", "ghost"].includes(stringValue(node.tone)) &&
          "border-border bg-surface-2 text-text hover:bg-surface",
      )}
    >
      {stringValue(node.icon)} {nodeLabel(node)}{fired ? " ✓" : ""}
    </button>
  );
}

function InputNode({ node, textarea = false }: { node: JsonObject; textarea?: boolean }) {
  const context = useContext(DshUiContext);
  const id = typeof node.id === "string" ? node.id : undefined;
  const initial = id ? context?.fields[id] ?? stringValue(node.value) : stringValue(node.value);
  const [value, setValue] = useState(initial);
  const [sentValue, setSentValue] = useState(initial);
  const action = typeof node.action === "string" ? node.action : "";
  const send = (submit = false) => {
    if (id) context?.setField(id, value);
    if (action && context?.emit && value !== sentValue) {
      context.emit(action, actionPayload(node, { value, ...(submit ? { submit: true } : {}) }));
      setSentValue(value);
    }
  };
  const common = {
    value,
    placeholder: stringValue(node.placeholder),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value),
    onBlur: () => send(false),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!textarea && event.key === "Enter") {
        event.preventDefault();
        send(true);
      }
      if (textarea && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        send(true);
      }
    },
    className: "w-full rounded-input border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-muted focus:border-accent",
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      {nodeLabel(node) && <ControlLabel>{nodeLabel(node)}</ControlLabel>}
      {textarea ? <textarea {...common} rows={Math.max(2, Number(node.rows) || 3)} /> : (
        <input {...common} type={node.inputType === "email" ? "email" : "text"} />
      )}
    </label>
  );
}

function SelectNode({ node }: { node: JsonObject }) {
  const context = useContext(DshUiContext);
  const options = Array.isArray(node.options) ? node.options.map((option) => stringValue(option)) : [];
  const initial = Number.isInteger(node.selected) && options[Number(node.selected)] !== undefined
    ? String(node.selected) : "";
  const [value, setValue] = useState(initial);
  const action = typeof node.action === "string" ? node.action : "";
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      {nodeLabel(node) && <ControlLabel>{nodeLabel(node)}</ControlLabel>}
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          const index = Number(next);
          const selected = options[index] ?? "";
          if (typeof node.id === "string") context?.setField(node.id, selected);
          if (action && context?.emit) context.emit(action, actionPayload(node, { index, value: selected }));
        }}
        className="w-full rounded-input border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
      >
        <option value="">{stringValue(node.placeholder, "Select...")}</option>
        {options.map((option, index) => <option key={`${option}-${index}`} value={index}>{option}</option>)}
      </select>
    </label>
  );
}

function SliderNode({ node }: { node: JsonObject }) {
  const context = useContext(DshUiContext);
  const min = Number.isFinite(Number(node.min)) ? Number(node.min) : 0;
  const max = Number.isFinite(Number(node.max)) ? Number(node.max) : 100;
  const step = Number.isFinite(Number(node.step)) && Number(node.step) > 0 ? Number(node.step) : 1;
  const [value, setValue] = useState(Number.isFinite(Number(node.value)) ? Number(node.value) : min);
  const action = typeof node.action === "string" ? node.action : "";
  return <label className="flex min-w-0 flex-1 flex-col gap-1.5"><div className="flex justify-between"><ControlLabel>{nodeLabel(node)}</ControlLabel><span className="text-xs tabular-nums text-text">{value}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => { const next = Number(event.target.value); setValue(next); if (typeof node.id === "string") context?.setField(node.id, String(next)); if (action && context?.emit) context.emit(action, actionPayload(node, { value: next })); }} className="accent-accent" /></label>;
}

function CheckNode({ node, role = "checkbox" }: { node: JsonObject; role?: "checkbox" | "switch" }) {
  const context = useContext(DshUiContext);
  const [checked, setChecked] = useState(node.checked === true);
  const action = typeof node.action === "string" ? node.action : "";
  return (
    <label className="flex items-center gap-2 text-xs text-text">
      <input
        type={role === "checkbox" ? "checkbox" : "checkbox"}
        role={role}
        checked={checked}
        onChange={() => {
          const next = !checked;
          setChecked(next);
          if (action && context?.emit) context.emit(action, actionPayload(node, { checked: next }));
        }}
        className={role === "switch" ? "sr-only" : "accent-accent"}
      />
      {role === "switch" && (
        <span className={cn("relative h-5 w-9 rounded-full bg-border transition-colors", checked && "bg-accent")}>
          <span className={cn("absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
        </span>
      )}
      <span>{nodeLabel(node)}</span>
    </label>
  );
}

function RadioNode({ node }: { node: JsonObject }) {
  const context = useContext(DshUiContext);
  const options = Array.isArray(node.options) ? node.options.map((option) => stringValue(option)) : [];
  const group = typeof node.group === "string" ? node.group : undefined;
  const stored = group ? context?.answers[group] : undefined;
  const [selected, setSelected] = useState(stored ?? (Number.isInteger(node.selected) ? options[Number(node.selected)] : ""));
  const action = typeof node.action === "string" ? node.action : "";
  const label = nodeLabel(node);
  const answer = typeof node.answer === "number" || typeof node.answer === "string" ? node.answer : undefined;
  const explanation = typeof node.explanation === "string" ? node.explanation : undefined;
  const optionsKey = options.join("\u0000");
  useEffect(() => {
    if (!group || !context?.registerMeta) return;
    context.registerMeta(group, {
      label,
      options,
      ...(answer !== undefined ? { answer } : {}),
      ...(explanation !== undefined ? { explanation } : {}),
    });
  // Parsed fence objects may be recreated while a response streams; use a
  // primitive fingerprint and let the context callback deduplicate updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, explanation, group, label, optionsKey, context?.registerMeta]);
  return (
    <fieldset className="flex flex-col gap-1.5 text-xs text-text" disabled={context?.locked}>
      {nodeLabel(node) && <legend className="mb-1 text-xs font-medium text-muted">{nodeLabel(node)}</legend>}
      {options.map((option) => (
        <label key={option} className="flex items-center gap-2">
          <input
            type="radio"
            name={group ?? `dsh-radio-${nodeLabel(node)}`}
            checked={selected === option}
            onChange={() => {
              setSelected(option);
              if (group) context?.setAnswer(group, option);
              else if (action && context?.emit) context.emit(action, actionPayload(node, { value: option }));
            }}
          />
          <span>{option}</span>
        </label>
      ))}
    </fieldset>
  );
}

function SubmitNode({ node }: { node: JsonObject }) {
  const context = useContext(DshUiContext);
  const groups = Array.isArray(node.groups) ? node.groups.map((group) => stringValue(group)) : Object.keys(context?.answers ?? {});
  const answered = groups.filter((group) => context?.answers[group] !== undefined).length;
  const ready = groups.length > 0 && answered >= groups.length;
  const action = typeof node.action === "string" ? node.action : "";
  const graded = groups.filter((group) => context?.meta[group]?.answer !== undefined);
  const score = graded.filter((group) => {
    const question = context?.meta[group];
    if (!question) return false;
    const expected = typeof question.answer === "number" ? question.options[question.answer] : question.answer;
    return expected !== undefined && context?.answers[group] === expected;
  }).length;
  if (context?.locked) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-success">
        <span>{graded.length > 0 ? `${score}/${graded.length}` : stringValue(node.label, "Submitted")} ✓</span>
        <button type="button" className="text-muted underline" onClick={context.reset}>Reset</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!ready}
        className="rounded-input border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-45"
        onClick={() => {
          if (!ready) return;
          const answers = Object.fromEntries(groups.map((group) => [group, context?.answers[group]]));
          if (action && context?.emit) context.emit(action, actionPayload(node, { answers, answered, total: groups.length }));
          context?.setLocked(true);
        }}
      >{stringValue(node.label, "Submit")}</button>
      {groups.length > 0 && <span className="text-[11px] text-muted">{answered}/{groups.length}</span>}
    </div>
  );
}

function ChartNode({ node }: { node: JsonObject }) {
  const data = Array.isArray(node.data) ? node.data.map(objectValue) : [];
  const values = data.map((item) => Number(item.value) || 0);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const kind = stringValue(node.kind, "bars");
  if (kind === "donut") {
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    let offset = 0;
    return (
      <div className="flex flex-wrap items-center gap-4">
        <svg viewBox="0 0 42 42" className="h-28 w-28 -rotate-90" role="img" aria-label={stringValue(node.title, "Chart")}>
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="8" />
          {values.map((value, index) => {
            const length = Math.max(0, value) / total * 100;
            const element = <circle key={index} cx="21" cy="21" r="15.9" fill="none" stroke={stringValue(data[index]?.color, "#4f8ef7")} strokeWidth="8" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-offset} />;
            offset += length;
            return element;
          })}
        </svg>
        <div className="flex flex-col gap-1 text-xs">{data.map((item, index) => <div key={index} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: stringValue(item.color, "#4f8ef7") }} /><span>{stringValue(item.label)}: {values[index]}</span></div>)}</div>
      </div>
    );
  }
  if (kind === "line") {
    const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${56 - (value / max) * 48}`).join(" ");
    return <svg viewBox="0 0 100 60" className="h-36 w-full overflow-visible" role="img" aria-label={stringValue(node.title, "Chart")}><polyline fill="none" stroke="#4f8ef7" strokeWidth="2" points={points} /><line x1="0" y1="56" x2="100" y2="56" stroke="currentColor" strokeOpacity=".2" /></svg>;
  }
  return (
    <div className="flex h-36 items-end gap-2 border-b border-border px-2 pb-1">
      {data.map((item, index) => <div key={index} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${stringValue(item.label)}: ${values[index]}`}>
        <span className="text-[10px] text-muted">{values[index]}</span>
        <span className="w-full rounded-t bg-accent/80" style={{ height: `${Math.max(3, Math.abs(values[index]) / max * 92)}px`, background: stringValue(item.color, "#4f8ef7") }} />
        <span className="max-w-full truncate text-[10px] text-muted">{stringValue(item.label)}</span>
      </div>)}
    </div>
  );
}

function DshUiNode({ node, depth }: { node: JsonObject; depth: number }) {
  if (depth > 8) return <div className="text-xs text-muted">Nested UI truncated.</div>;
  const type = stringValue(node.type);
  const items = nodeItems(node);
  const children = items.map((item, index) => <DshUiNode key={index} node={item} depth={depth + 1} />);
  switch (type) {
    case "text": return <div className={cn("text-text", node.size === "h1" ? "text-xl font-semibold" : node.size === "h2" ? "text-lg font-semibold" : node.size === "h3" ? "text-base font-semibold" : node.size === "caption" ? "text-[11px] text-muted" : node.size === "muted" ? "text-xs text-muted" : "text-sm", node.center === true && "text-center")}>{stringValue(node.content)}</div>;
    case "row": return <div className={cn("flex items-center gap-3", node.wrap === true && "flex-wrap")}>{children}</div>;
    case "col": return <div className="flex flex-col gap-3">{children}</div>;
    case "grid": return <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(6, Number(node.cols) || 1))}, minmax(0, 1fr))` }}>{children}</div>;
    case "card": return <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3"><>{node.title !== undefined && <h4 className="text-xs font-semibold text-text">{stringValue(node.title)}</h4>}</>{children}</section>;
    case "divider": return <hr className="border-border" />;
    case "spacer": return <div className="min-h-2 flex-1" />;
    case "stat": return <div className="rounded-card border border-border bg-surface p-3"><div className="text-xs text-muted">{stringValue(node.label)}</div><div className="mt-1 text-xl font-semibold text-text">{stringValue(node.value)}</div>{node.delta !== undefined && <div className={cn("mt-1 text-xs", String(node.delta).startsWith("-") ? "text-error" : "text-success")}>{stringValue(node.delta)}</div>}</div>;
    case "badge": return <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text">{stringValue(node.icon)} {nodeLabel(node)}</span>;
    case "progress": { const value = Math.max(0, Math.min(100, Number(node.value) || 0)); return <div className="flex flex-col gap-1"><div className="flex justify-between text-xs text-muted"><span>{stringValue(node.label)}</span><span>{stringValue(node.valueLabel, `${value}%`)}</span></div><div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} /></div></div>; }
    case "list": return <ul className="ml-4 list-disc space-y-1 text-sm text-text">{(Array.isArray(node.items) ? node.items : []).map((item, index) => { const value = objectValue(item); return <li key={index}>{Object.keys(value).length ? <><strong>{stringValue(value.title)}</strong>{value.desc !== undefined && <span className="text-muted">: {stringValue(value.desc)}</span>}</> : stringValue(item)}</li>; })}</ul>;
    case "table": { const columns = Array.isArray(node.columns) ? node.columns.map((column) => stringValue(column)) : []; const rows = Array.isArray(node.rows) ? node.rows : []; return <div className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead><tr>{columns.map((column) => <th key={column} className="border-b border-border px-2 py-1.5 text-left font-medium text-muted">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{(Array.isArray(row) ? row : []).map((cell, cellIndex) => <td key={cellIndex} className="border-b border-border/60 px-2 py-1.5 text-text">{stringValue(cell)}</td>)}</tr>)}</tbody></table></div>; }
    case "keyvalue": return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">{(Array.isArray(node.pairs) ? node.pairs : []).map((pair, index) => { const value = objectValue(pair); return <><dt key={`k-${index}`} className="text-muted">{stringValue(value.key)}</dt><dd key={`v-${index}`} className="text-text">{stringValue(value.value)}</dd></>; })}</dl>;
    case "timeline": return <ol className="space-y-3 border-l border-border pl-4 text-sm">{(Array.isArray(node.items) ? node.items : []).map((item, index) => { const value = objectValue(item); return <li key={index} className="relative"><span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-accent" /><div className="font-medium text-text">{stringValue(value.title)}</div><div className="text-xs text-muted">{stringValue(value.desc)} {value.time !== undefined && `· ${stringValue(value.time)}`}</div></li>; })}</ol>;
    case "breadcrumb": return <div className="flex flex-wrap items-center gap-1 text-xs text-muted">{(Array.isArray(node.items) ? node.items : []).map((item, index) => <span key={index}>{index > 0 && " / "}{stringValue(item)}</span>)}</div>;
    case "callout": return <div className="rounded-card border border-accent/30 bg-accent/10 p-3 text-sm"><div className="font-semibold text-text">{stringValue(node.title)}</div><div className="mt-1 text-muted">{stringValue(node.content)}</div></div>;
    case "steps": return <ol className="space-y-2 text-sm">{(Array.isArray(node.steps) ? node.steps : []).map((step, index) => { const value = objectValue(step); const active = index === Number(node.current); return <li key={index} className={cn("flex gap-2", active ? "text-text" : "text-muted")}><span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]", active && "border-accent bg-accent text-accent-fg")}>{index + 1}</span><span><strong>{stringValue(value.title)}</strong>{value.desc !== undefined && <span className="ml-1 text-muted">{stringValue(value.desc)}</span>}</span></li>; })}</ol>;
    case "diff": return <div className="overflow-x-auto rounded-input bg-surface-2 p-2 font-mono text-xs">{(Array.isArray(node.diffs) ? node.diffs : []).map((diff, index) => { const value = objectValue(diff); return <div key={index} className="mb-2 last:mb-0"><div className="text-muted">{stringValue(value.path)}</div>{value.oldText !== undefined && <div className="text-error">- {stringValue(value.oldText)}</div>}<div className="text-success">+ {stringValue(value.newText)}</div></div>; })}</div>;
    case "json": return <pre className="overflow-x-auto rounded-input bg-surface-2 p-2 font-mono text-xs text-text">{JSON.stringify(node.value, null, 2)}</pre>;
    case "code": return <pre className="overflow-x-auto rounded-input bg-surface-2 p-2 font-mono text-xs text-text"><code>{stringValue(node.code)}</code></pre>;
    case "chart": return <ChartNode node={node} />;
    case "plot": return <div className="rounded-input border border-border bg-surface-2 p-3 text-xs text-muted"><div className="font-medium text-text">{stringValue(node.title, "Plot")}</div><div className="mt-1 font-mono">{(Array.isArray(node.series) ? node.series : []).map((series) => stringValue(objectValue(series).expr)).join("\n")}</div><div className="mt-1">Plot rendering is available in the DSH web host; the desktop view preserves the expression.</div></div>;
    case "mermaid": return <pre className="overflow-x-auto rounded-input bg-surface-2 p-3 font-mono text-xs text-text">{stringValue(node.code)}</pre>;
    case "scene3d": return <div className="rounded-input border border-border bg-surface-2 p-3 text-xs text-muted"><div className="font-medium text-text">{stringValue(node.title, "3D scene")}</div><div className="mt-1">{Array.isArray(node.meshes) ? `${node.meshes.length} mesh${node.meshes.length === 1 ? "" : "es"}` : "No meshes"}</div></div>;
    case "button": return <ButtonNode node={node} />;
    case "input": return <InputNode node={node} />;
    case "textarea": return <InputNode node={node} textarea />;
    case "select": return <SelectNode node={node} />;
    case "slider": return <SliderNode node={node} />;
    case "checkbox": return <CheckNode node={node} />;
    case "switch": return <CheckNode node={node} role="switch" />;
    case "radio": return <RadioNode node={node} />;
    case "submit": return <SubmitNode node={node} />;
    case "copy": return <CopyNode node={node} />;
    case "tabs": return <TabsNode node={node} depth={depth} />;
    case "accordion": return <AccordionNode node={node} depth={depth} />;
    case "quiz": return <QuizNode node={node} />;
    case "avatar": return <div className="flex items-center gap-2 text-xs text-text"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-accent">{stringValue(node.name, "?").slice(0, 1)}</span>{stringValue(node.name)}</div>;
    case "file-tree": return <ul className="space-y-1 font-mono text-xs text-text">{(Array.isArray(node.items) ? node.items : []).map((item, index) => <li key={index}>{stringValue(objectValue(item).name, stringValue(item))}</li>)}</ul>;
    case "link": { const href = stringValue(node.href); return /^https?:\/\//i.test(href) ? <a className="text-link underline" href={href} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternal(href); }}>{nodeLabel(node)}</a> : <span className="text-muted">{nodeLabel(node)}</span>; }
    default: return items.length ? <div className="flex flex-col gap-3">{children}</div> : null;
  }
}

function TabsNode({ node, depth }: { node: JsonObject; depth: number }) {
  const tabs = Array.isArray(node.tabs) ? node.tabs.map(objectValue) : [];
  const [selected, setSelected] = useState(0);
  const tab = tabs[selected] ?? {};
  return <div className="flex flex-col gap-3"><div className="flex gap-1 border-b border-border">{tabs.map((item, index) => <button type="button" key={index} className={cn("border-b-2 px-2 py-1.5 text-xs", selected === index ? "border-accent text-text" : "border-transparent text-muted")} onClick={() => setSelected(index)}>{stringValue(item.label)}</button>)}</div><div className="flex flex-col gap-3">{nodeItems(tab).map((item, index) => <DshUiNode key={index} node={item} depth={depth + 1} />)}</div></div>;
}

function AccordionNode({ node, depth }: { node: JsonObject; depth: number }) {
  const entries = Array.isArray(node.items) ? node.items.map(objectValue) : [];
  return <div className="divide-y divide-border rounded-input border border-border">{entries.map((entry, index) => <details key={index} className="p-2"><summary className="cursor-pointer text-xs font-medium text-text">{stringValue(entry.title)}</summary><div className="mt-2 flex flex-col gap-3">{nodeItems(entry).map((item, itemIndex) => <DshUiNode key={itemIndex} node={item} depth={depth + 1} />)}</div></details>)}</div>;
}

function CopyNode({ node }: { node: JsonObject }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="rounded-input border border-border bg-surface-2 px-3 py-1.5 text-xs text-text hover:bg-surface" onClick={() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(stringValue(node.text)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }}>{copied ? "Copied" : stringValue(node.label, "Copy")}</button>;
}

function QuizNode({ node }: { node: JsonObject }) {
  const context = useContext(DshUiContext);
  const options = Array.isArray(node.options) ? node.options.map(objectValue) : [];
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const correct = selected !== null && options[selected]?.correct === true;
  const action = typeof node.action === "string" ? node.action : "";
  return <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3 text-sm"><div className="font-medium text-text">{stringValue(node.question)}</div>{options.map((option, index) => <button type="button" key={index} disabled={checked} className={cn("rounded-input border px-2 py-1.5 text-left text-xs", checked && option.correct === true && "border-success text-success", checked && selected === index && option.correct !== true && "border-error text-error", !checked && "border-border hover:bg-surface-2")} onClick={() => setSelected(index)}>{stringValue(option.label)}</button>)}<button type="button" disabled={selected === null || checked} className="w-fit rounded-input border border-accent px-2.5 py-1.5 text-xs text-text disabled:opacity-45" onClick={() => { if (selected === null) return; setChecked(true); if (action && context?.emit) context.emit(action, actionPayload(node, { index: selected, value: stringValue(options[selected]?.label), correct })); }}>Check</button>{checked && <div className={correct ? "text-xs text-success" : "text-xs text-error"}>{correct ? "Correct" : "Try again"}{node.explanation !== undefined && <span className="ml-1 text-muted">{stringValue(node.explanation)}</span>}</div>}</div>;
}

export function parseDshUiSpec(raw: string): JsonObject | null {
  const parse = (text: string): JsonObject | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const object = parsed as JsonObject;
      if (!Array.isArray(object.items) && typeof object.type !== "string") return null;
      return object;
    } catch {
      return null;
    }
  };
  const strict = parse(raw.trim());
  if (strict) return strict;
  // Match the official plugin's safe punctuation repair. Structural errors
  // remain code so a malformed fence cannot be executed as a UI tree.
  try {
    const repaired = raw.trim().replace(/,\s*([}\]])/g, "$1");
    return parse(repaired);
  } catch {
    return null;
  }
}

export function DshUiRenderer({ spec, onAction }: { spec: JsonObject; onAction?: DshUiAction }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, DshUiQuestionMeta>>({});
  const [locked, setLocked] = useState(false);
  const setField = useCallback((id: string, value: string) => setFields((previous) => ({ ...previous, [id]: value })), []);
  const setAnswer = useCallback((group: string, value: string) => setAnswers((previous) => ({ ...previous, [group]: value })), []);
  const registerMeta = useCallback((group: string, question: DshUiQuestionMeta) => setMeta((previous) => {
    const current = previous[group];
    if (current && JSON.stringify(current) === JSON.stringify(question)) return previous;
    return { ...previous, [group]: question };
  }), []);
  const reset = useCallback(() => { setAnswers({}); setFields({}); setLocked(false); }, []);
  const context = useMemo<DshUiContextValue>(() => ({ emit: onAction, fields, setField, answers, setAnswer, meta, registerMeta, reset, locked, setLocked }), [answers, fields, locked, meta, onAction, registerMeta, reset, setAnswer, setField]);
  const items = typeof spec.type === "string" ? [spec] : nodeItems(spec);
  return <DshUiContext.Provider value={context}><div className="my-3 flex flex-col gap-3 rounded-card border border-border bg-surface/60 p-3" data-dsh-ui>{spec.title !== undefined && <div className="border-b border-border pb-2 text-sm font-semibold text-text">{stringValue(spec.title)}</div>}{items.map((item, index) => <DshUiNode key={index} node={item} depth={0} />)}</div></DshUiContext.Provider>;
}

export function DshUiFence({ raw, onAction }: { raw: string; onAction?: DshUiAction }) {
  const spec = parseDshUiSpec(raw);
  // The Markdown `pre` renderer unwraps this function component. Keep an
  // explicit pre for an incomplete/invalid fence so streaming JSON remains a
  // normal code block instead of being mistaken for a rendered UI.
  if (!spec) return <pre className="whitespace-pre-wrap"><code>{raw}</code></pre>;
  return <DshUiRenderer spec={spec} onAction={onAction} />;
}
