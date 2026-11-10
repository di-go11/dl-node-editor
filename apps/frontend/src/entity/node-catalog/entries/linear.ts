import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Linear(全結合)。
 *
 * proto: LinearSpec
 * ポート: NodePorts.hpp の nodePortsOf(const LinearSpec&) - 入力 x / 出力 y
 *
 * 分類の出力層などで使う。特徴マップ (N, C, H, W) をそのまま受けられないため、
 * 本来は前段に Flatten が必要だが、Flatten は MVP の範囲外である
 * (NodePorts.hpp では「これから追加する層」に入っている)。
 */
export const linearType = {
  editorOnly: false,
  typeId: 'linear',
  label: 'Linear',
  category: 'fully-connected',
  description: '入力のすべての要素に重みをかけて足す。分類の出力層などで使う。',
  inputs: [inputPort('x')],
  outputs: [outputPort('y')],
  params: {
    in_features: {
      kind: 'int',
      label: '入力の次元',
      default: 512,
      min: 1,
      help: '上流の要素数と一致させる。',
    },
    out_features: {
      kind: 'int',
      label: '出力の次元',
      default: 10,
      min: 1,
      help: '分類の出力層ならクラス数にする。',
    },
    bias: {
      kind: 'bool',
      label: 'バイアスを使う',
      default: true,
      help: '直後に BatchNorm を置く場合は、打ち消されるため false にすることが多い。',
    },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: '{in_features}→{out_features}',
} satisfies NodeTypeDef
