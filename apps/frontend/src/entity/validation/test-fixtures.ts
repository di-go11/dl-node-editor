import { DEFAULT_EDITOR_CONTEXT } from '../editor-context/editor-context'
import type { EditorContext } from '../editor-context/editor-context'
import type { GraphNode, ModelGraph, NodeInput } from '../model-graph/model-graph'
import { nodeId } from '../model-graph/node-id'
import type { NodeKind, ParamValues } from '../model-graph/node-spec'
import { GRAPH_INPUT, nodeOutput } from '../model-graph/port'
import type { NodeOutputRef } from '../model-graph/port'
import { findNodeType } from '../node-catalog/catalog'
import { defaultNodeCatalog } from '../node-catalog/entries'
import { defaultParamsOf } from '../node-catalog/param-def'

import type { ValidationInput } from './validation-input'

/**
 * 検証ルールのテストで使うグラフの組み立て補助。
 *
 * 製品コードからは参照されない(ビルド時に取り除かれる)。
 * 5 つのルールのテストで同じ組み立てを繰り返さないために切り出している。
 */

/** `['conv1', 'y']` のような簡略表記。省略するとグラフ入力になる */
export type SourceSpec = readonly [nodeId: string, port: string] | 'graph-input'

export type NodeSpecShorthand = {
  readonly id: string
  readonly kind: NodeKind
  /** 既定値からの差分だけを書く。省略すればカタログの既定値になる */
  readonly params?: ParamValues
  /** ポート名 → 接続元。複数つなぐポートは配列で渡す */
  readonly inputs?: Readonly<Record<string, SourceSpec | readonly SourceSpec[]>>
}

/**
 * 1 本ぶんの指定か、複数本の配列かを見分ける。
 * ['conv1', 'y'] は前者、[['conv1', 'y'], ['relu1', 'y']] は後者。
 * 先頭要素が文字列なら前者、という判定で区別できる。
 */
function isSingleSource(spec: SourceSpec | readonly SourceSpec[]): spec is SourceSpec {
  if (spec === 'graph-input') return true
  return typeof spec[0] === 'string'
}

function toNodeInputs(inputs: NodeSpecShorthand['inputs']): readonly NodeInput[] {
  if (inputs === undefined) return []
  const result: NodeInput[] = []
  for (const [port, spec] of Object.entries(inputs)) {
    for (const one of isSingleSource(spec) ? [spec] : spec) {
      result.push({
        port,
        source: one === 'graph-input' ? GRAPH_INPUT : nodeOutput(nodeId(one[0]), one[1]),
      })
    }
  }
  return result
}

export function buildNode(shorthand: NodeSpecShorthand): GraphNode {
  const def = findNodeType(defaultNodeCatalog, shorthand.kind)
  if (def === undefined) throw new Error(`カタログに ${shorthand.kind} がありません`)
  return {
    id: nodeId(shorthand.id),
    spec: {
      kind: shorthand.kind,
      params: { ...defaultParamsOf(def.params), ...shorthand.params },
    },
    inputs: toNodeInputs(shorthand.inputs),
  }
}

export function buildGraph(
  nodes: readonly NodeSpecShorthand[],
  outputs: readonly (readonly [nodeId: string, port: string])[] = [],
): ModelGraph {
  const outputRefs: NodeOutputRef[] = outputs.map(([id, port]) => nodeOutput(nodeId(id), port))
  return { nodes: nodes.map(buildNode), outputs: outputRefs }
}

export function validationInput(
  graph: ModelGraph,
  context: EditorContext = DEFAULT_EDITOR_CONTEXT,
): ValidationInput {
  return { graph, context, catalog: defaultNodeCatalog }
}

/**
 * test_segnet_dag.json と同じ構造の、検証を通るグラフ。
 * 「正しいグラフでは Issue が出ない」ことを確かめる基準に使う。
 */
export function validSegnetGraph(): ModelGraph {
  return buildGraph(
    [
      {
        id: 'conv1',
        kind: 'conv2d',
        params: { in_channels: 3, out_channels: 64 },
        inputs: { x: 'graph-input' },
      },
      { id: 'relu1', kind: 'activation', inputs: { x: ['conv1', 'y'] } },
      {
        id: 'bn1',
        kind: 'batch_norm',
        params: { num_features: 64 },
        inputs: { x: ['relu1', 'y'] },
      },
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: ['bn1', 'y'] } },
      {
        id: 'unpool1',
        kind: 'unpooling',
        inputs: { x: ['pool1', 'y'], indices: ['pool1', 'indices'] },
      },
      {
        id: 'out_conv',
        kind: 'conv2d',
        params: { in_channels: 64, out_channels: 3 },
        inputs: { x: ['unpool1', 'y'] },
      },
    ],
    [['out_conv', 'y']],
  )
}
