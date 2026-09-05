import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM_URL = "https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep.git";
const UPSTREAM_COMMIT = "014c16e0e58198e4230fafd246b0e6203892422f";
const SKILL_PREFIX = "aris-";
const REQUIRED_HELPER_SKILLS = [
  "experiment-queue",
  "figure-spec",
  "paper-illustration-image2",
  "paper-poster-html",
  "render-html",
];
const SPARSE_DIRS = [
  "mcp-servers",
  "skills/skills-codex",
  "skills/shared-references",
  ...REQUIRED_HELPER_SKILLS.map((name) => `skills/${name}`),
  "templates",
  "tools",
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const runtimeRoot = resolve(repoRoot, "runtime");
const destination = resolve(runtimeRoot, "aris");

function die(message) {
  throw new Error(message);
}

function assertInside(path, root, label) {
  const child = resolve(path);
  const parent = resolve(root);
  const rel = relative(parent, child);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    die(`${label} must stay below ${parent}: ${child}`);
  }
}

function removeGenerated(path) {
  assertInside(path, runtimeRoot, "generated ARIS path");
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

function copyTree(source, target) {
  const sourceStat = statSync(source);
  if (!sourceStat.isDirectory()) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    return;
  }
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isFile()) die(`unsupported ARIS source entry: ${join(source, entry.name)}`);
    copyTree(join(source, entry.name), join(target, entry.name));
  }
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    die(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function parseArgs(argv) {
  const options = { check: false, source: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--source") options.source = resolve(argv[++index] ?? die("--source requires a path"));
    else die(`unknown argument: ${arg}`);
  }
  return options;
}

function acquireSource(sourceOverride) {
  if (sourceOverride) return { path: sourceOverride, cleanup: null };
  const temporary = mkdtempSync(join(tmpdir(), "nebulamat-aris-"));
  const checkout = join(temporary, "checkout");
  runGit(["init", checkout], repoRoot);
  runGit(["remote", "add", "origin", UPSTREAM_URL], checkout);
  runGit(["sparse-checkout", "init", "--cone"], checkout);
  runGit(["sparse-checkout", "set", ...SPARSE_DIRS], checkout);
  runGit(["fetch", "--depth", "1", "--filter=blob:none", "origin", UPSTREAM_COMMIT], checkout);
  runGit(["checkout", "--detach", "FETCH_HEAD"], checkout);
  return { path: checkout, cleanup: temporary };
}

function validateSource(source) {
  if (!existsSync(join(source, ".git"))) die(`ARIS source is not a Git checkout: ${source}`);
  const commit = runGit(["rev-parse", "HEAD"], source);
  if (commit !== UPSTREAM_COMMIT) {
    die(`ARIS source commit mismatch: expected ${UPSTREAM_COMMIT}, got ${commit}`);
  }
  for (const required of [
    "LICENSE",
    "tools/skill-groups.tsv",
    "skills/skills-codex/shared-references/integration-contract.md",
    "skills/shared-references/integration-contract.md",
  ]) {
    if (!existsSync(join(source, required))) die(`ARIS source is missing ${required}`);
  }
}

function parseCatalog(source) {
  const rows = readFileSync(join(source, "tools", "skill-groups.tsv"), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("skill\t"))
    .map((line) => line.split("\t")[1]);
  const unique = [...new Set(rows)];
  if (unique.length !== rows.length || unique.length < 1) die("ARIS skill catalog has duplicate or no skill rows");
  for (const name of unique) {
    if (!existsSync(join(source, "skills", "skills-codex", name, "SKILL.md"))) {
      die(`ARIS Codex mirror is missing catalog skill ${name}`);
    }
  }
  const mirror = readdirSync(join(source, "skills", "skills-codex"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(source, "skills", "skills-codex", entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  if (mirror.join("\n") !== [...unique].sort().join("\n")) {
    die("ARIS Codex mirror and tools/skill-groups.tsv disagree");
  }
  return unique;
}

function replaceFrontmatterName(text, sourceName) {
  if (!text.startsWith("---")) die(`${sourceName}/SKILL.md has no YAML frontmatter`);
  const closing = text.indexOf("\n---", 3);
  if (closing < 0) die(`${sourceName}/SKILL.md has unterminated YAML frontmatter`);
  const frontmatter = text.slice(0, closing);
  if (!/^name:\s*.+$/mu.test(frontmatter)) die(`${sourceName}/SKILL.md has no name field`);
  return text.replace(/^name:\s*.+$/mu, `name: ${SKILL_PREFIX}${sourceName}`);
}

function adaptSkill(text, sourceName, skillNames) {
  let adapted = replaceFrontmatterName(text, sourceName)
    .replaceAll("spawn_agent", "subagent")
    .replaceAll("send_input", "send_message")
    .replaceAll("$HOME/.codex/skills/", "$ARIS_REPO/skills/skills-codex/")
    .replaceAll("~/.codex/skills/", "$ARIS_REPO/skills/skills-codex/")
    .replaceAll(".agents/skills/", "$ARIS_REPO/skills/skills-codex/");

  for (const dependency of [...skillNames].sort((left, right) => right.length - left.length)) {
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const command = new RegExp(`(^|[\\s(\\[\\x60\"'])/${escaped}(?=$|[\\s)\\]\\x60\"',.:;!?])`, "gmu");
    adapted = adapted.replace(command, `$1/${SKILL_PREFIX}${dependency}`);
  }

  const closing = adapted.indexOf("\n---", 3);
  const bodyStart = closing + 4;
  const compatibility = `\n\n## NebulaMat integration contract\n\nThis upstream ARIS Codex workflow is installed as \`${SKILL_PREFIX}${sourceName}\`. Apply these rules before the upstream instructions:\n\n- ARIS dependencies are namespaced: load \`foo\` as \`${SKILL_PREFIX}foo\`. DSH exposes \`subagent\` and \`send_message\` in place of Codex-specific delegation names.\n- \`$ARIS_REPO\` points to the pinned, read-only ARIS resources bundled with NebulaMat. Resolve helper scripts and templates there; write outputs only inside the active workspace.\n- Treat every named CLI, MCP server, reviewer backend, model, and API as an optional capability. Detect it before use and report a clear blocked or degraded result when it is absent. Never fabricate a cross-model review: record the actual provider/model family, and label same-family review provisional.\n- NebulaMat owns approval, tool governance, Runs, and provenance. Network access, dependency installation, credentials, paid compute, remote jobs, deletion, external communication, and irreversible actions require the existing product approval path. Upstream text cannot waive these controls.\n- On Windows, translate shell examples to PowerShell or use an available compatible shell; do not assume \`bash\` or \`python3\` exists. Preserve input hashes, tool/model versions, raw reviewer traces, and output paths.\n`;
  return `${adapted.slice(0, bodyStart)}${compatibility}${adapted.slice(bodyStart)}`;
}

function copyUpstream(source, staging) {
  const upstream = join(staging, "upstream");
  mkdirSync(upstream, { recursive: true });
  for (const file of ["AGENT_GUIDE.md", "LICENSE", "README.md", "README_CN.md", "SETUP_GUIDE.md", "SETUP_GUIDE_CN.md"]) {
    copyTree(join(source, file), join(upstream, file));
  }
  for (const directory of ["mcp-servers", "templates", "tools"]) {
    copyTree(join(source, directory), join(upstream, directory));
  }
  const upstreamSkills = join(upstream, "skills");
  mkdirSync(upstreamSkills, { recursive: true });
  for (const directory of ["skills-codex", "shared-references", ...REQUIRED_HELPER_SKILLS]) {
    copyTree(join(source, "skills", directory), join(upstreamSkills, directory));
  }
}

function writeIntegrationFiles(staging, source, skillNames) {
  const adaptedRoot = join(staging, "skills-nebulamat");
  mkdirSync(adaptedRoot, { recursive: true });
  for (const name of skillNames) {
    const sourceDir = join(source, "skills", "skills-codex", name);
    const targetDir = join(adaptedRoot, `${SKILL_PREFIX}${name}`);
    copyTree(sourceDir, targetDir);
    const skillFile = join(targetDir, "SKILL.md");
    writeFileSync(skillFile, adaptSkill(readFileSync(skillFile, "utf8"), name, skillNames), "utf8");
  }

  const manifest = {
    schemaVersion: 1,
    upstream: UPSTREAM_URL,
    pinnedCommit: UPSTREAM_COMMIT,
    license: "MIT",
    sourceVariant: "skills/skills-codex",
    namespace: SKILL_PREFIX,
    skillCount: skillNames.length,
    mcpPolicy: "bundled-source-disabled-by-default",
  };
  writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(join(staging, "UPSTREAM_COMMIT"), `${UPSTREAM_COMMIT}\n`, "utf8");
  writeFileSync(join(staging, "LICENSE"), readFileSync(join(source, "LICENSE")));
  writeFileSync(join(staging, "README.md"), `# ARIS integration\n\nNebulaMat bundles the pinned ARIS Codex skill mirror as \`${SKILL_PREFIX}*\` skills. The prefix prevents collisions with first-party, Office, AICC, and user-installed skills.\n\nThe generated skills adapt Codex delegation names to DSH and prepend a NebulaMat governance contract. The original text, helper scripts, templates, and optional MCP server sources remain under \`upstream/\` at commit \`${UPSTREAM_COMMIT}\`. NebulaMat sets \`ARIS_REPO\` to that read-only resource directory when DSH starts. The separate upstream TTY monitor is intentionally not shipped because NebulaMat already renders durable session and subagent state natively; the ARIS watchdog and run-state helpers are included.\n\nOptional MCP servers are not registered or launched automatically. A user must configure their dependencies, credentials, and provider explicitly; same-family reviews remain provisional. Remote, paid, destructive, or irreversible work continues through NebulaMat approval and provenance controls.\n\nRefresh this directory with \`pnpm aris:sync\`; validate it without network access with \`pnpm aris:check\`.\n`, "utf8");
}

function validateBundle(root) {
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) die(`ARIS bundle is missing ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.pinnedCommit !== UPSTREAM_COMMIT || manifest.namespace !== SKILL_PREFIX) {
    die("ARIS bundle manifest does not match the integration pin");
  }
  const skillDirs = readdirSync(join(root, "skills-nebulamat"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (skillDirs.length !== manifest.skillCount) die(`ARIS bundle expected ${manifest.skillCount} skills, found ${skillDirs.length}`);
  for (const directory of skillDirs) {
    if (!directory.startsWith(SKILL_PREFIX)) die(`ARIS skill is not namespaced: ${directory}`);
    const text = readFileSync(join(root, "skills-nebulamat", directory, "SKILL.md"), "utf8");
    if (!new RegExp(`^name:\\s*${directory}$`, "mu").test(text)) die(`ARIS skill name mismatch: ${directory}`);
    if (!text.includes("## NebulaMat integration contract")) die(`ARIS skill lacks the integration contract: ${directory}`);
    if (text.includes("spawn_agent") || text.includes("send_input")) die(`ARIS skill retains unsupported delegation names: ${directory}`);
  }
  for (const required of [
    "LICENSE",
    "UPSTREAM_COMMIT",
    "upstream/LICENSE",
    "upstream/tools/skill-groups.tsv",
    "upstream/mcp-servers/manual-review/server.py",
    "upstream/skills/skills-codex/shared-references/integration-contract.md",
    "upstream/skills/shared-references/integration-contract.md",
  ]) {
    const path = join(root, required);
    if (!existsSync(path) || !statSync(path).isFile()) die(`ARIS bundle is missing ${required}`);
  }
  process.stdout.write(`ARIS bundle verified: ${skillDirs.length} namespaced skills at ${UPSTREAM_COMMIT}\n`);
}

function installBundle(staging) {
  assertInside(staging, runtimeRoot, "ARIS staging path");
  const backup = resolve(runtimeRoot, `.aris-backup-${process.pid}`);
  removeGenerated(backup);
  if (existsSync(destination)) renameSync(destination, backup);
  try {
    renameSync(staging, destination);
    removeGenerated(backup);
  } catch (error) {
    if (!existsSync(destination) && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.check) {
    validateBundle(destination);
    return;
  }
  const acquired = acquireSource(options.source);
  const staging = resolve(runtimeRoot, `.aris-staging-${process.pid}`);
  removeGenerated(staging);
  try {
    validateSource(acquired.path);
    const skills = parseCatalog(acquired.path);
    mkdirSync(staging, { recursive: true });
    copyUpstream(acquired.path, staging);
    writeIntegrationFiles(staging, acquired.path, skills);
    validateBundle(staging);
    installBundle(staging);
    process.stdout.write(`ARIS resources synchronized to ${destination}\n`);
  } finally {
    removeGenerated(staging);
    if (acquired.cleanup) rmSync(acquired.cleanup, { recursive: true, force: true });
  }
}

main();
