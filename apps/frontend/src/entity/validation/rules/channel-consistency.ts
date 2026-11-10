import { sourceOfPort } from '../../model-graph/graph-queries'
import { findNode } from '../../model-graph/model-graph'
import type { GraphNode, ModelGraph } from '../../model-graph/model-graph'
import type { NodeId } from '../../model-graph/node-id'
import { readNumberParam } from '../../model-graph/node-spec'
import type { NodeKind } from '../../model-graph/node-spec'
import type { PortRef } from '../../model-graph/port'
import type { Issue } from '../issue'
import { issueWarning } from '../issue'
import type { ValidationRule } from '../validation-input'

/**
 * チャンネル数の整合を調べる(指示書 8 章)。**severity は warning。**
 *
 * ## なぜ warning なのか
 *
 * C++ 側は形状を確認しない(model_graph.proto のコメント)。合っていなければ
 * 学習の開始時に失敗する。つまり本来は error にしたい類の問題である。
 *
 * しかしフロントが追跡できるのは一部の経路だけで、**判定できない経路が多い。**
 * たとえば Linear の in_features は Flatten を挟んだ後の要素数(C×H×W)であり、
 * チャンネル数とは別の量になる。H と W を追跡していないので確かめられない。
 *
 * 確実でない検査を error にして実行を止めると、正しいモデルが組めなくなる。
 * そこで「確実に分かる範囲だけを warning で知らせる」という設計にしている。
 * 指示書の「追跡できない経路はチェックしない」はこの考え方である。
 *
 * ## 追跡できる経路
 *
 *   出力チャンネル数が分かる層   conv2d(out_channels)、batch_norm(num_features)、
 *                                linear(out_features)
 *   そのまま通す層               activation、pooling2d、indexed_pooling、
 *                                unpooling、upsample
 *   足し算                       add(すべての入力が同じはずなので最初の入力)
 *   結合                         concat(入力の合計)
 *   グラフ入力                   分からない(データセット次第。data_spec にも含まれない)
 */

/** 入力のチャンネル数をそのまま出力する層 */
const PASS_THROUGH_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'activation',
  'pooling2d',
  'indexed_pooling',
  'unpooling',
  'upsample',
])

/**
 * 参照先の出力のチャンネル数。分からなければ undefined。
 *
 * 上流をたどるので、閉路があると止まらなくなる。visiting で防いでいる
 * (閉路そのものは graph/cycle が報告する)。
 */
function outputChannelsOf(
  graph: ModelGraph,
  ref: PortRef,
  visiting: Set<NodeId>,
): number | undefined {
  if (ref.kind === 'graph-input') return undefined

  // indices はチャンネルという概念を持たない
  if (ref.port === 'indices') return undefined

  const node = findNode(graph, ref.nodeId)
  if (node === undefined) return undefined
  if (visiting.has(node.id)) return undefined

  visiting.add(node.id)
  try {
    switch (node.spec.kind) {
      case 'conv2d':
        return readNumberParam(node.spec, 'out_channels')
      case 'batch_norm':
        return readNumberParam(node.spec, 'num_features')
      case 'linear':
        return readNumberParam(node.spec, 'out_features')
      case 'add': {
        // すべての入力が同じチャンネル数であることが前提なので、最初の 1 本で代表させる
        const first = sourceOfPort(node, 'x')
        return first === undefined ? undefined : outputChannelsOf(graph, first, visiting)
      }
      case 'concat': {
        // つないだ順に並ぶが、合計を求めるだけなので順序は影響しない
        const parts: number[] = []
        for (const nodeInput of node.inputs) {
          if (nodeInput.port !== 'x') continue
          const channels = outputChannelsOf(graph, nodeInput.source, visiting)
          if (channels === undefined) return undefined
          parts.push(channels)
        }
        return parts.length === 0 ? undefined : parts.reduce((sum, value) => sum + value, 0)
      }
      default: {
        if (!PASS_THROUGH_KINDS.has(node.spec.kind)) return undefined
        const x = sourceOfPort(node, 'x')
        return x === undefined ? undefined : outputChannelsOf(graph, x, visiting)
      }
    }
  } finally {
    visiting.delete(node.id)
  }
}

/** ノードの入力ポートにつながっている上流のチャンネル数 */
function upstreamChannelsOf(graph: ModelGraph, node: GraphNode, port: string): number | undefined {
  const source = sourceOfPort(node, port)
  return source === undefined ? undefined : outputChannelsOf(graph, source, new Set())
}

export const validateChannelConsistency: ValidationRule = (input) => {
  const issues: Issue[] = []
  const { graph } = input

  for (const node of graph.nodes) {
    switch (node.spec.kind) {
      case 'conv2d': {
        const declared = readNumberParam(node.spec, 'in_channels')
        const upstream = upstreamChannelsOf(graph, node, 'x')
        if (declared === undefined || upstream === undefined || declared === upstream) break
        issues.push(
          issueWarning(
            'channel/mismatch',
            `in_channels が ${declared} ですが、上流の出力は ${upstream} チャンネルです。` +
              `合っていないと学習の開始時に失敗します。`,
            { nodeId: node.id, port: 'x', paramName: 'in_channels' },
          ),
        )
        break
      }

      case 'batch_norm': {
        const declared = readNumberParam(node.spec, 'num_features')
        const upstream = upstreamChannelsOf(graph, node, 'x')
        if (declared === undefined || upstream === undefined || declared === upstream) break
        issues.push(
          issueWarning(
            'channel/mismatch',
            `num_features が ${declared} ですが、上流の出力は ${upstream} チャンネルです。`,
            { nodeId: node.id, port: 'x', paramName: 'num_features' },
          ),
        )
        break
      }

      case 'add': {
        // Add は入力すべてが同じ形状でなければならない
        const channels: number[] = []
        for (const nodeInput of node.inputs) {
          if (nodeInput.port !== 'x') continue
          const value = outputChannelsOf(graph, nodeInput.source, new Set())
          if (value === undefined) break
          channels.push(value)
        }
        const unique = [...new Set(channels)]
        if (channels.length < 2 || unique.length <= 1) break
        issues.push(
          issueWarning(
            'channel/mismatch',
            `Add の入力のチャンネル数がそろっていません(${unique.join(' と ')})。` +
              `要素ごとの足し算なので、すべて同じ形状である必要があります。`,
            { nodeId: node.id, port: 'x' },
          ),
        )
        break
      }

      default:
        break
    }
  }

  return issues
}
