import type { ModelGraph } from '../model-graph/model-graph'
import { findNode } from '../model-graph/model-graph'
import { readNumberParam, readStringParam } from '../model-graph/node-spec'
import { LOSS_TYPES } from '../training/loss'
import type { TrainingSettings } from '../training/training-settings'

import type { Issue } from './issue'
import { issueWarning } from './issue'

/**
 * Output の直前の活性化が、loss の期待する入力と合っているかを調べる(ユーザーと合意済み)。
 *
 * ## なぜ必要か
 *
 * C++ の loss は、期待する入力が種類によって違う(loss.ts の LossInput)。
 *
 *   CrossEntropy                    … logits を受け取り、中で softmax をかける
 *   Dice / Focal / Combo / Boundary … 確率を受け取る(中で softmax をかけない)
 *
 * 合っていなくても学習は動いてしまい、失敗するのではなく「うまく学習しない」という
 * 最も原因の分かりにくい形で現れる。
 *   - CrossEntropy の前に Softmax  → softmax が二重にかかり、勾配が小さくなる
 *   - Dice の前に Softmax がない    → 負の値を確率として扱い、log や重なりの計算が壊れる
 *
 * ## なぜ warning なのか
 *
 * 判定はグラフの形からの推測である。見ているのは「Output に直接つながったノード」だけで、
 * Softmax の後に別の層を挟んだ構成などは判定できない。確実でない判定で実行を止めると、
 * 正しい構成まで止めてしまう恐れがあるので、知らせるだけにする。
 */

export type OutputActivationInput = {
  readonly graph: ModelGraph
  readonly settings: TrainingSettings
}

const PROBABILITY_ACTIVATIONS = new Set(['ACTIVATION_TYPE_SOFTMAX', 'ACTIVATION_TYPE_SIGMOID'])

/** クラスの方向(N×C×H×W の C)の次元 */
const CHANNEL_DIM = 1

export function validateOutputActivation(input: OutputActivationInput): readonly Issue[] {
  const output = input.graph.outputs[0]
  if (output === undefined) return [] // Output が未接続なことは graph/no-output が報告する

  const node = findNode(input.graph, output.nodeId)
  if (node === undefined) return [] // 参照の誤りは reference/missing-node が報告する

  const loss = LOSS_TYPES[input.settings.loss.kind]
  const activation =
    node.spec.kind === 'activation' ? readStringParam(node.spec, 'activation_type') : undefined
  const producesProbabilities = activation !== undefined && PROBABILITY_ACTIVATIONS.has(activation)

  switch (loss.input) {
    case 'raw':
      return []
    case 'logits':
      if (!producesProbabilities) return []
      return [
        issueWarning(
          'training/output-activation',
          `loss「${loss.label}」は softmax をかける前の値(logits)を受け取り、中で softmax をかけます。` +
            `Output の直前の ${node.id}(活性化)を外してください(softmax が二重にかかります)。`,
          { nodeId: node.id },
        ),
      ]
    case 'probabilities': {
      if (!producesProbabilities) {
        return [
          issueWarning(
            'training/output-activation',
            `loss「${loss.label}」は確率を受け取ります(中で softmax をかけません)。` +
              `Output の直前に Softmax(dim = 1)の Activation を置いてください。`,
            { nodeId: node.id },
          ),
        ]
      }
      const dim = readNumberParam(node.spec, 'dim')
      if (activation === 'ACTIVATION_TYPE_SOFTMAX' && dim !== undefined && dim !== CHANNEL_DIM) {
        return [
          issueWarning(
            'training/output-activation',
            `${node.id} の Softmax の dim が ${dim} です。クラスの方向に確率を出すには dim = 1 にしてください。`,
            { nodeId: node.id, paramName: 'dim' },
          ),
        ]
      }
      return []
    }
  }
}
