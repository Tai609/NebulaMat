/**
 * three.js scene renderer — the HEAVY half. This module imports three and is
 * bundled ONLY into the lazy asset bundle `lib/assets/three.js`, loaded on
 * demand by the scene3d-lazy loader when a spec contains a `scene3d` node;
 * the main client bundle stays small.
 *
 * Security: the model only supplies white-listed primitive shapes, numeric
 * transforms, and colors. No textures, no external URLs, no scripts, no
 * custom shaders — everything is geometry + material colors constructed
 * locally. The renderer mounts into a caller-owned container and returns a
 * disposer that tears down the WebGL context.
 * @module @omdsh-dev/dsh-genui/client/scene3d-core
 */
import type { GenuiScene3D } from './spec.ts';
/**
 * Mount a GenUI 3D scene into `container`.
 * @param container - the DOM node to host the WebGL canvas.
 * @param scene - the declarative scene spec.
 * @returns a disposer that removes the renderer and its context.
 */
export declare function mountScene(container: HTMLElement, scene: GenuiScene3D): Promise<() => void>;
