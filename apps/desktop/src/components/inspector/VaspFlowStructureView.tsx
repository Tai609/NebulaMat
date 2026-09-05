import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  catalogEntryFor,
  crystalFromApiPayload,
  fractionalToCartesianCoordinates,
  inferConservativeBonds,
  isMaterialsProjectId,
  parseCif,
  parsePoscar,
  type CrystalStructure,
} from "@/lib/crystal";
import {
  fetchVaspScene,
  fetchVaspStructureFiles,
  type VaspFlowScene,
} from "@/lib/vaspFlow";

const ELEMENT_COLORS: Record<string, string> = {
  H: "#ffffff", He: "#d9ffff", Li: "#cc80ff", Be: "#c2ff00", B: "#ffb5b5",
  C: "#909090", N: "#3050f8", O: "#ff0d0d", F: "#90e050", Ne: "#b3e3f5",
  Na: "#ab5cf2", Mg: "#8aff00", Al: "#bfa6a6", Si: "#f0c8a0", P: "#ff8000",
  S: "#ffff30", Cl: "#1ff01f", K: "#8f40d4", Ca: "#3dff00", Ti: "#bfc2c7",
  V: "#a6a6ab", Cr: "#8a99c7", Mn: "#9c7ac7", Fe: "#e06633", Co: "#f090a0",
  Ni: "#50d050", Cu: "#c88033", Zn: "#7d80b0", Zr: "#94e0e0", Mo: "#54b5b5",
  Ru: "#248f8f", Rh: "#0a7d8c", Pd: "#006985", Ag: "#c0c0c0", Sn: "#668080",
  I: "#940094", Pt: "#d0d0e0", Au: "#ffd123", Pb: "#575961", Bi: "#9e4fb5",
};

const VDW_RADIUS: Record<string, number> = {
  H: 1.2, Li: 1.82, C: 1.7, N: 1.55, O: 1.52, F: 1.47, Na: 2.27, Mg: 1.73,
  Al: 1.84, Si: 2.1, P: 1.8, S: 1.8, Cl: 1.75, K: 2.75, Ca: 2.31, Ti: 2.0,
  V: 2.0, Cr: 2.0, Mn: 2.0, Fe: 2.0, Co: 2.0, Ni: 1.63, Cu: 1.4, Zn: 1.39,
  Zr: 2.0, Mo: 2.0, Ru: 2.0, Rh: 2.0, Pd: 1.63, Ag: 1.72, Sn: 2.17,
  Pt: 1.72, Au: 1.66, Pb: 1.96, Bi: 2.02,
};

function colorOf(element: string) {
  return ELEMENT_COLORS[element] ?? "#8a949d";
}

function radiusOf(element: string) {
  return (VDW_RADIUS[element] ?? 1.7) * 0.34;
}

function centerOf(vectors: number[][]): [number, number, number] {
  return [0, 1, 2].map((axis) => vectors.reduce((sum, vector) => sum + (vector[axis] ?? 0), 0) / 2) as [number, number, number];
}

function cellEdges(vectors: number[][]): Array<[THREE.Vector3, THREE.Vector3]> {
  const o = new THREE.Vector3();
  const a = new THREE.Vector3().fromArray(vectors[0]);
  const b = new THREE.Vector3().fromArray(vectors[1]);
  const c = new THREE.Vector3().fromArray(vectors[2]);
  const ab = a.clone().add(b), ac = a.clone().add(c), bc = b.clone().add(c), abc = ab.clone().add(c);
  return [[o, a], [o, b], [o, c], [a, ab], [a, ac], [b, ab], [b, bc], [c, ac], [c, bc], [ab, abc], [ac, abc], [bc, abc]];
}

function bondHalf(start: THREE.Vector3, end: THREE.Vector3, color: string) {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const direction = midpoint.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, direction.length(), 12),
    new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.86 }),
  );
  mesh.position.copy(start).add(midpoint).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function addBond(group: THREE.Group, start: number[], end: number[], first: string, second: string) {
  const a = new THREE.Vector3().fromArray(start);
  const b = new THREE.Vector3().fromArray(end);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  group.add(bondHalf(a, b, first));
  group.add(bondHalf(b, a, second));
  // Keep the two half cylinders exactly joined even after numerical rounding.
  const children = group.children.slice(-2) as THREE.Mesh[];
  children[0].position.copy(a.clone().add(midpoint).multiplyScalar(0.5));
  children[1].position.copy(b.clone().add(midpoint).multiplyScalar(0.5));
}

function CrystalCanvas({ scene, resetKey, showBonds, showCell }: { scene: VaspFlowScene; resetKey: number; showBonds: boolean; showCell: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || scene.atoms.length === 0) return;
    const world = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.replaceChildren(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.01, 10_000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    const vectors = scene.cell.vectors;
    const center = centerOf(vectors);
    const diagonal = new THREE.Vector3(...vectors[0]).add(new THREE.Vector3(...vectors[1])).add(new THREE.Vector3(...vectors[2])).length();
    camera.position.set(center[0] + diagonal * 1.1, center[1] + diagonal * 0.75, center[2] + Math.max(diagonal * 1.6, 12));
    camera.zoom = Math.max(0.35, 28 / Math.max(diagonal, 3));
    camera.updateProjectionMatrix();
    controls.target.set(...center);
    world.add(new THREE.HemisphereLight(0xffffff, 0x445065, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 8);
    world.add(key);
    const model = new THREE.Group();
    for (const atom of scene.atoms) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(radiusOf(atom.element), 28, 20),
        new THREE.MeshPhongMaterial({ color: colorOf(atom.element), shininess: 42, specular: 0x777777 }),
      );
      sphere.position.fromArray(atom.position);
      sphere.userData = { element: atom.element, siteIndex: atom.site_index };
      model.add(sphere);
    }
    if (showBonds) {
      for (const bond of scene.bonds) {
        const start = scene.atoms[bond.start_atom_index];
        const end = scene.atoms[bond.end_atom_index];
        if (start && end) addBond(model, start.position, end.position, colorOf(start.element), colorOf(end.element));
      }
    }
    if (showCell && vectors.length === 3) {
      const points = cellEdges(vectors).flatMap(([a, b]) => [...a.toArray(), ...b.toArray()]);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      model.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x4d9fff, transparent: true, opacity: 0.9 })));
    }
    world.add(model);
    const resize = () => {
      const width = mount.clientWidth || 420;
      const height = mount.clientHeight || 360;
      const aspect = width / Math.max(height, 1);
      camera.left = -20 * aspect;
      camera.right = 20 * aspect;
      camera.top = 20;
      camera.bottom = -20;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    let disposed = false;
    let frame = 0;
    const draw = () => {
      if (disposed) return;
      controls.update();
      renderer.render(world, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      world.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose();
      });
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [resetKey, scene, showBonds, showCell]);

  return <div ref={mountRef} data-vaspflow-structure-view className="h-full min-h-[300px] w-full bg-[radial-gradient(circle_at_50%_40%,rgba(77,159,255,0.08),transparent_62%)]" />;
}

export function crystalStructureToVaspFlowScene(structure: CrystalStructure): VaspFlowScene {
  const vectors = ([
    fractionalToCartesianCoordinates([1, 0, 0], structure.lattice),
    fractionalToCartesianCoordinates([0, 1, 0], structure.lattice),
    fractionalToCartesianCoordinates([0, 0, 1], structure.lattice),
  ] satisfies Array<[number, number, number]>);
  const atoms = structure.sites.map((site, index) => ({
    id: `${site.element}-${index}`,
    site_index: index,
    element: site.element,
    position: fractionalToCartesianCoordinates(site.frac, structure.lattice),
    fractional_position: site.frac,
    image_offset: [0, 0, 0] as [number, number, number],
    is_periodic_image: false,
  }));
  const bonds = structure.bonds?.length ? structure.bonds : inferConservativeBonds(structure);
  const sceneBonds = bonds.flatMap((bond, index) => {
    const start = atoms[bond.siteIndexA];
    const baseEnd = atoms[bond.siteIndexB];
    if (!start || !baseEnd) return [];
    let endIndex = bond.siteIndexB;
    if (bond.imageShift.some(Boolean)) {
      const offset = fractionalToCartesianCoordinates(bond.imageShift, structure.lattice);
      atoms.push({
        ...baseEnd,
        id: `${baseEnd.id}-image-${bond.imageShift.join("-")}`,
        position: baseEnd.position.map((value, axis) => value + offset[axis]) as [number, number, number],
        image_offset: bond.imageShift,
        is_periodic_image: true,
      });
      endIndex = atoms.length - 1;
    }
    return [{
      id: `bond-${index}`,
      family_key: [start.element, baseEnd.element].sort().join("|"),
      start_atom_index: bond.siteIndexA,
      end_atom_index: endIndex,
      length: bond.lengthAngstrom ?? new THREE.Vector3(...start.position).distanceTo(new THREE.Vector3(...atoms[endIndex].position)),
    }];
  });
  const formula = structure.formula ?? structure.sites.reduce<Record<string, number>>((counts, site) => ({ ...counts, [site.element]: (counts[site.element] ?? 0) + 1 }), {});
  return {
    version: 1,
    cell: { vectors, lengths: structure.lattice.lengths, angles: structure.lattice.angles },
    atoms,
    bonds: sceneBonds,
    bond_families: [],
    summary: {
      formula: typeof formula === "string" ? formula : Object.entries(formula).map(([element, count]) => `${element}${count === 1 ? "" : count}`).join(""),
      atom_count: structure.sites.length,
      space_group: structure.spaceGroup ?? null,
      crystal_system: structure.crystalSystem ?? null,
      bond_algorithm: "minimum-distance",
    },
    warnings: [],
  };
}

async function loadStructure(materialId: string, text?: string | null): Promise<CrystalStructure | null> {
  const inline = text?.trim();
  if (inline) {
    const pathParts = materialId.split(/[\\/]/);
    const basename = (pathParts[pathParts.length - 1] ?? materialId).toLowerCase();
    if (inline.startsWith("{")) {
      try {
        const parsed = crystalFromApiPayload(JSON.parse(inline), materialId);
        if (parsed) return parsed;
      } catch {
        // Continue with text parsers.
      }
    }
    const poscar = basename === "poscar" || basename === "contcar" || basename.endsWith(".poscar");
    const parsed = poscar ? parsePoscar(inline, materialId) : parseCif(inline, materialId) ?? parsePoscar(inline, materialId);
    if (parsed) return parsed;
  }
  const catalog = catalogEntryFor(materialId);
  if (catalog) return catalog;
  if (!isMaterialsProjectId(materialId)) return null;
  for (const url of [
    `https://api.materialsproject.org/materials/summary/${encodeURIComponent(materialId)}?_fields=structure,formula_pretty,symmetry`,
    `https://materialsproject.org/materials/${encodeURIComponent(materialId)}/cif`,
  ]) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json,text/plain" } });
      if (!response.ok) continue;
      const body = await response.text();
      const parsed = body.trim().startsWith("{")
        ? crystalFromApiPayload(JSON.parse(body), materialId)
        : parseCif(body, materialId);
      if (parsed) return parsed;
    } catch {
      // The public endpoint may require credentials; surface not-found below.
    }
  }
  return null;
}

export function VaspFlowStructureView({
  materialId,
  text,
  trajectoryStructures,
  trajectoryFrame = 0,
  taskId,
  serverUrl,
  scene: suppliedScene,
}: {
  materialId: string;
  text?: string | null;
  trajectoryStructures?: readonly CrystalStructure[];
  trajectoryFrame?: number;
  taskId?: number;
  serverUrl?: string;
  scene?: VaspFlowScene | null;
}) {
  const { t } = useTranslation("inspector");
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState("");
  const [scene, setScene] = useState<VaspFlowScene | null>(suppliedScene ?? null);
  const [loading, setLoading] = useState(!suppliedScene);
  const [error, setError] = useState<string | null>(null);
  const [showBonds, setShowBonds] = useState(true);
  const [showCell, setShowCell] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const trajectoryStructure = trajectoryStructures?.[trajectoryFrame] ?? trajectoryStructures?.[0];

  useEffect(() => {
    if (suppliedScene) {
      setScene(suppliedScene);
      setLoading(false);
      setError(null);
      return;
    }
    if (taskId !== undefined && serverUrl) {
      let cancelled = false;
      setLoading(true);
      void fetchVaspStructureFiles(serverUrl, taskId)
        .then((nextFiles) => {
          if (cancelled) return;
          setFiles(nextFiles);
          const preferred = nextFiles.find((file) => file.toUpperCase() === "CONTCAR") ?? nextFiles.find((file) => file.toUpperCase() === "POSCAR") ?? nextFiles[0] ?? "";
          setActiveFile(preferred);
          if (!preferred) throw new Error(t("crystal.notFound"));
          return fetchVaspScene(serverUrl, taskId, preferred);
        })
        .then((nextScene) => { if (!cancelled && nextScene) setScene(nextScene); })
        .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    let cancelled = false;
    setLoading(true);
    const compatible = trajectoryStructure ? Promise.resolve(trajectoryStructure) : loadStructure(materialId, text);
    void compatible
      .then((structure) => {
        if (cancelled) return;
        if (!structure) throw new Error(t("crystal.notFound"));
        setScene(crystalStructureToVaspFlowScene(structure));
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [materialId, serverUrl, suppliedScene, t, taskId, text, trajectoryStructure]);

  useEffect(() => {
    if (taskId === undefined || !serverUrl || !activeFile) return;
    let cancelled = false;
    setLoading(true);
    void fetchVaspScene(serverUrl, taskId, activeFile)
      .then((next) => { if (!cancelled) setScene(next); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeFile, serverUrl, taskId]);

  const summary = useMemo(() => scene ? `${scene.summary.formula} · ${scene.summary.atom_count} atoms · ${scene.bonds.length} bonds` : "", [scene]);

  return (
    <div className="relative flex h-full min-h-[320px] w-full flex-col overflow-hidden bg-surface" aria-label={t("crystal.viewerAria", { materialId })}>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted">
        {files.length > 0 && <select value={activeFile} onChange={(event) => setActiveFile(event.target.value)} className="rounded-input border border-border bg-bg px-2 py-1 font-mono text-xs text-text">{files.map((file) => <option key={file} value={file}>{file}</option>)}</select>}
        <label className="flex items-center gap-1"><input type="checkbox" checked={showBonds} onChange={(event) => setShowBonds(event.target.checked)} />{t("crystal.bonds")}</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showCell} onChange={(event) => setShowCell(event.target.checked)} />{t("crystal.toggleCell")}</label>
        <span className="min-w-0 flex-1 truncate font-mono">{summary}</span>
        <button onClick={() => setResetKey((value) => value + 1)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text" title={t("crystal.resetView")}><RotateCcw size={14} /></button>
      </div>
      <div className="relative min-h-0 flex-1">
        {scene && <CrystalCanvas scene={scene} resetKey={resetKey} showBonds={showBonds} showCell={showCell} />}
        {(loading || error) && <div className="pointer-events-none absolute bottom-3 left-3 max-w-[82%] rounded-input border border-border bg-surface/95 px-3 py-1.5 text-xs text-muted shadow-card">{loading ? t("crystal.loading") : error}</div>}
      </div>
      <div className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-muted">{t("crystal.vaspFlowControls")}</div>
    </div>
  );
}
