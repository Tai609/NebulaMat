/**
 * The recursive render dispatcher: maps the white-listed GenuiNode union to
 * concrete components. Leaf cases render inline; compound families live in
 * the sibling block modules. Depth-guarded against pathological specs.
 * @module @omdsh-dev/dsh-genui/client/blocks/render-node
 */
import { type ReactNode } from 'react';
import type { GenuiNode } from '../spec.ts';
import type { AnswersState, GenuiBlockProps } from './state.ts';
export declare function renderNode(node: GenuiNode, key: number, onAction: GenuiBlockProps['onAction'] | undefined, depth?: number, answers?: AnswersState): ReactNode;
