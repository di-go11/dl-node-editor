import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Concat(チャンネル方向の結合)。U-Net の skip connection で使う。
 *
 * proto: ConcatSpec(パラメータなし。結合する次元は固定)
 * ポート: NodePorts.hpp の nodePortsOf(const ConcatSpec&)
 *         入力 x(種類 Any、**variadic、minCount 2**)/ 出力 y(Any)
 *
 * **つないだ順にチャンネルが並ぶため、inputs の並び順に意味がある。**
 * 編集操作(appendInput)が末尾に足すようになっているのはこのためである。
 */
export const concatType = {
  editorOnly: false,
  typeId: 'concat',
  label: 'Concat',
  category: 'merge',
  description:
    '複数の入力をチャンネル方向につなげる。つないだ順にチャンネルが並ぶため、順序に意味がある。',
  inputs: [inputPort('x', { kind: 'any', variadic: true, minCount: 2 })],
  outputs: [outputPort('y', 'any')],
  params: {},
  contexts: [{ dataDim: '2d', method: 'cnn' }],
} satisfies NodeTypeDef
