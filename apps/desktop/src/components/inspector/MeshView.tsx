import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { extOf } from "@/lib/artifacts";
import { cn } from "@/lib/cn";

/**
 * Interactive 3D viewer for mesh / CAD-export files (stl, obj, ply, gltf, glb),
 * rendered locally with three.js + WebGL — no service. A warm studio: soft
 * hemisphere + key/fill lights, a neutral physical material for meshes that
 * carry none, a subtle contact-shadow ground, and a gradient backdrop that
 * matches the app's warm palette. The scene is theme-independent (a model reads
 * the same in light or dark mode), like the molecule and Office previews.
 * Drag to orbit, scroll to zoom, right-drag to pan.
 */
export function MeshView({ filename, bytes }: { filename: string; bytes: ArrayBuffer }) {
  const { t } = useTranslation(["inspector", "common"]);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const homeRef = useRef<(() => void) | null>(null);
  // Each mesh with its shaded material, so wireframe mode can swap in a dark
  // high-contrast line material and swap back — the shaded material's own color
  // (light clay) would draw near-invisible lines on the warm backdrop.
  const meshesRef = useRef<Array<{ mesh: THREE.Mesh; shaded: THREE.Material | THREE.Material[] }>>([]);
  const wireMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const [shaded, setShaded] = useState(true);
  const shadedRef = useRef(true);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ tris: number } | null>(null);
  // Set when the file loaded but nothing renders — a warning so the user knows
  // the FILE is the problem (e.g. an incomplete/corrupt export), not the viewer.
  const [notice, setNotice] = useState<string | null>(null);

  const ext = extOf(filename);

  const resetView = useCallback(() => homeRef.current?.(), []);

  // Wireframe toggle without rebuilding the scene.
  useEffect(() => {
    shadedRef.current = shaded;
  }, [shaded]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let raf = 0;
    setRendering(true);
    setError(null);
    setMeta(null);
    setNotice(null);

    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;

    const scene = new THREE.Scene();
    // Warm vertical gradient backdrop (drawn to a canvas texture).
    scene.background = gradientTexture();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    // A soft studio environment so PBR (metalness/roughness) materials from
    // glTF/GLB render correctly — without an env map a metallic material has
    // nothing to reflect and renders black.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    // Studio lighting: soft sky/ground fill + a key light casting a soft shadow.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9cbb8, 1.15));
    const key = new THREE.DirectionalLight(0xfff4ea, 2.1);
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.5);
    fill.position.set(-6, 3, -4);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    const root = new THREE.Group();
    scene.add(root);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    (async () => {
      try {
        const object = await loadModel(ext, bytes);
        if (cancelled) {
          disposeObject(object);
          return;
        }

        // Normalize: apply a neutral material where none exists, enable shadows,
        // and count triangles for the badge.
        let tris = 0;
        const meshes: Array<{ mesh: THREE.Mesh; shaded: THREE.Material | THREE.Material[] }> = [];
        const wireMat = new THREE.MeshBasicMaterial({ color: 0x6b6155, wireframe: true });
        wireMatRef.current = wireMat;
        const neutral = new THREE.MeshStandardMaterial({
          color: 0xd8cfc4,
          metalness: 0.05,
          roughness: 0.68,
          side: THREE.DoubleSide,
          flatShading: false,
        });
        object.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const geom = mesh.geometry as THREE.BufferGeometry;
          if (geom && !geom.attributes.normal) geom.computeVertexNormals();
          const hasMaterial = Array.isArray(mesh.material) ? mesh.material.length > 0 : !!mesh.material;
          // STL/PLY carry no material; give them the neutral clay so lighting reads.
          if (!hasMaterial || ext === "stl" || ext === "ply") mesh.material = neutral;
          // Render both faces: agent-generated meshes often have inconsistent
          // winding, and single-sided culling would make them vanish.
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            if (m) (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
          meshes.push({ mesh, shaded: mesh.material });
          const idx = geom?.index?.count ?? geom?.attributes.position?.count ?? 0;
          tris += Math.floor(idx / 3);
        });
        meshesRef.current = meshes;
        // Honor the current toggle if the user flipped it before load finished.
        if (!shadedRef.current) for (const { mesh } of meshes) mesh.material = wireMat;
        root.add(object);

        // Frame the model: recenter to origin, sit it on a shadow-catching
        // ground, and pull the camera back to fit the bounding sphere.
        const box = new THREE.Box3().setFromObject(root);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const center = sphere.center.clone();
        root.position.sub(center);

        const box2 = new THREE.Box3().setFromObject(root);
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(sphere.radius * 40, sphere.radius * 40),
          new THREE.ShadowMaterial({ opacity: 0.16 }),
        );
        ground.rotation.x = -Math.PI / 2;
        // Drop the ground a hair below the model so a flat bottom face (e.g. a
        // cube) doesn't sit coplanar with it and z-fight (flicker on rotation).
        ground.position.y = box2.min.y - sphere.radius * 0.01;
        ground.receiveShadow = true;
        scene.add(ground);

        const r = sphere.radius || 1;
        const dir = new THREE.Vector3(1, 0.7, 1).normalize();
        const dist = r / Math.sin((camera.fov * Math.PI) / 360);
        const home = () => {
          camera.position.copy(dir.clone().multiplyScalar(dist * 1.3));
          camera.near = r / 100;
          camera.far = r * 100;
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
        };
        homeRef.current = home;
        home();
        key.shadow.camera.near = r / 10;
        key.shadow.camera.far = r * 40;
        const sc = key.shadow.camera as THREE.OrthographicCamera;
        sc.left = sc.bottom = -r * 2;
        sc.right = sc.top = r * 2;
        sc.updateProjectionMatrix();

        setMeta({ tris });

        // Integrity check: render the model once offscreen over a magenta
        // clear (no backdrop) and see if it paints any pixels. A valid model
        // covers many; a file that parses but has no real faces (a truncated /
        // corrupt export) paints ~none — warn so the user blames the file.
        const savedBg = scene.background;
        scene.background = null;
        const rt = new THREE.WebGLRenderTarget(width, height);
        renderer.setClearColor(0xff00ff, 1);
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, camera);
        const px = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, width, height, px);
        renderer.setRenderTarget(null);
        rt.dispose();
        scene.background = savedBg;
        let drawn = 0;
        for (let i = 0; i < px.length; i += 4)
          if (!(px[i] > 250 && px[i + 1] < 5 && px[i + 2] > 250)) drawn++;
        if (drawn < width * height * 0.0008) setNotice(t("mesh.noGeometry"));

        if (!cancelled) {
          setRendering(false);
          animate();
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setRendering(false);
        }
      }
    })();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            const w = mount.clientWidth || 1;
            const h = mount.clientHeight || 1;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
          })
        : null;
    observer?.observe(mount);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      controls.dispose();
      controlsRef.current = null;
      homeRef.current = null;
      scene.traverse((o) => disposeObject(o));
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [bytes, ext, t]);

  // Swap between each mesh's shaded material and the shared dark wire material.
  const applyWireframe = useCallback((wire: boolean) => {
    const wm = wireMatRef.current;
    for (const { mesh, shaded } of meshesRef.current) mesh.material = wire && wm ? wm : shaded;
  }, []);

  return (
    <div className="relative h-full min-h-[420px] w-full touch-none select-none overflow-hidden">
      <div ref={mountRef} className="absolute inset-0" aria-label={t("mesh.modelViewerAria", { filename })} />

      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-input border border-border/70 bg-surface/90 p-1 shadow-card backdrop-blur">
        <div className="flex items-center gap-1 px-1.5 text-xs font-medium text-muted">
          <Box size={13} /> {t("mesh.badge3D")}
        </div>
        <div className="flex rounded bg-surface-2 p-0.5">
          {[
            { v: true, label: t("mesh.mode.shaded") },
            { v: false, label: t("mesh.mode.wireframe") },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                setShaded(o.v);
                applyWireframe(!o.v);
              }}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition-colors",
                shaded === o.v ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={resetView}
          aria-label={t("mesh.resetView")}
          title={t("mesh.resetView")}
          className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-text"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 rounded-input border border-border/70 bg-surface/90 px-3 py-1.5 text-xs text-muted shadow-card backdrop-blur">
        <span className="font-medium text-text">{ext.toUpperCase()}</span>
        {meta && (
          <span className="ml-2">
            {t("mesh.triangleCount", { count: meta.tris, formatted: meta.tris.toLocaleString() })}
          </span>
        )}
      </div>

      {(rendering || error) && (
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] rounded-input border border-border/70 bg-surface/95 px-3 py-1.5 text-xs text-muted shadow-card backdrop-blur">
          {rendering ? t("mesh.rendering") : error}
        </div>
      )}

      {notice && !rendering && !error && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 max-w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-input border border-warn/40 bg-surface/95 px-4 py-3 text-center text-sm text-text shadow-card backdrop-blur">
          <div className="mb-1 flex items-center justify-center gap-1.5 font-medium text-warn">
            <AlertTriangle size={14} /> {t("mesh.fileProblem")}
          </div>
          {notice}
        </div>
      )}
    </div>
  );
}

/** Load bytes into a three.js Object3D, dispatching on extension. */
async function loadModel(ext: string, bytes: ArrayBuffer): Promise<THREE.Object3D> {
  switch (ext) {
    case "stl": {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const geom = new STLLoader().parse(bytes);
      // STL face normals are often missing or zero (→ an unlit black surface);
      // recompute them. Non-indexed geometry yields correct faceted shading.
      geom.computeVertexNormals();
      return new THREE.Mesh(geom);
    }
    case "ply": {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
      const geom = new PLYLoader().parse(bytes);
      if (!geom.attributes.normal) geom.computeVertexNormals();
      return new THREE.Mesh(geom);
    }
    case "obj": {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      return new OBJLoader().parse(new TextDecoder().decode(bytes));
    }
    case "gltf":
    case "glb": {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().parseAsync(bytes, "");
      return gltf.scene;
    }
    default:
      throw new Error(i18n.t("inspector:mesh.unsupportedFormat", { ext }));
  }
}

/** A warm top-to-bottom gradient, matching the app's paper tones. */
function gradientTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#f3ede4");
  grad.addColorStop(1, "#d8cdbe");
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Free GPU resources for an object subtree. */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m?.dispose?.();
    }
  });
}
