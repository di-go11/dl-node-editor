import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * BatchNorm(バッチ正規化)。
 *
 * proto: BatchNormSpec
 * ポート: NodePorts.hpp の nodePortsOf(const BatchNormSpec&) - 入力 x / 出力 y
 *
 * ミニバッチごとにチャンネル単位で平均 0・分散 1 に正規化し、学習を安定させる。
 * num_features は入力のチャンネル数と一致していなければならない(検証層が警告する)。
 */
export const batchNormType = {
  editorOnly: false,
  typeId: 'batch_norm',
  label: 'BatchNorm',
  category: 'normalization',
  description: 'チャンネルごとに平均と分散をそろえ、学習を安定させる。',
  inputs: [inputPort('x')],
  outputs: [outputPort('y')],
  params: {
    num_features: {
      kind: 'int',
      label: 'チャンネル数',
      default: 64,
      min: 1,
      help: '入力のチャンネル数と一致させる。',
    },
    eps: {
      kind: 'float',
      label: 'eps',
      default: 1e-5,
      exclusiveMin: 0,
      help: '分散で割るときの 0 除算を避けるための微小値。慣例は 1e-5。',
    },
    momentum: {
      kind: 'float',
      label: 'momentum',
      default: 0.1,
      min: 0,
      max: 1,
      help: '推論時に使う移動平均の更新率。PyTorch の既定値は 0.1。',
    },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: 'C{num_features}',
} satisfies NodeTypeDef
