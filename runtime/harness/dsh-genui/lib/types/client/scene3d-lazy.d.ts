import type { GenuiScene3D } from './spec.ts';
/**
 * Mount a GenUI 3D scene into `container` (engine loaded on demand).
 * @param container - the DOM node to host the WebGL canvas.
 * @param scene - the declarative scene spec.
 * @returns a disposer that removes the renderer and its context.
 */
export declare function mountScene(container: HTMLElement, scene: GenuiScene3D): Promise<() => void>;
