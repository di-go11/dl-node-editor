import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Activation(活性化関数)。
 *
 * proto: ActivationSpec / ActivationType
 * ポート: NodePorts.hpp の nodePortsOf(const ActivationSpec&)
 *         入力 x / 出力 y。**どちらも種類は Any**
 *
 * 種類が Any なのは、特徴マップにもトークン列にも使えるためである
 * (NodePorts.hpp のコメント)。出力の種類は入力に合わせて決まる。
 */
export const activationType = {
  editorOnly: false,
  typeId: 'activation',
  label: 'Activation',
  category: 'activation',
  description:
    '要素ごとに非線形な関数を通す。これがないと層を重ねても 1 つの線形変換と等価になる。',
  inputs: [inputPort('x', { kind: 'any' })],
  outputs: [outputPort('y', 'any')],
  params: {
    activation_type: {
      kind: 'enum',
      label: '種類',
      default: 'ACTIVATION_TYPE_RELU',
      options: [
        { value: 'ACTIVATION_TYPE_RELU', label: 'ReLU' },
        { value: 'ACTIVATION_TYPE_SIGMOID', label: 'Sigmoid' },
        { value: 'ACTIVATION_TYPE_SOFTMAX', label: 'Softmax' },
        { value: 'ACTIVATION_TYPE_TANH', label: 'Tanh' },
      ],
      help: '中間層は ReLU が基本。Softmax は分類の出力層でクラス確率にするときに使う。',
    },
    dim: {
      kind: 'int',
      label: 'dim',
      default: 1,
      help: 'Softmax を取る次元。チャンネル方向なら 1。ほかの種類では使われない。',
    },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: '{activation_type}',
} satisfies NodeTypeDef
