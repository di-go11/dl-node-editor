import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * IndexedPooling(最大値の位置も出す Max Pooling)。
 *
 * proto: IndexedPoolingSpec
 * ポート: NodePorts.hpp の nodePortsOf(const IndexedPoolingSpec&)
 *         入力 x / 出力 y と indices(indices は種類 Indices)
 *
 * 縮小のときに「どこが最大だったか」を indices として出し、Unpooling がそれを使って
 * 元の位置に戻す。SegNet のエンコーダ・デコーダはこの対で作る。
 */
export const indexedPoolingType = {
  editorOnly: false,
  typeId: 'indexed_pooling',
  label: 'IndexedPooling',
  category: 'pooling',
  description: 'Max Pooling に加えて、最大値だった位置(indices)を出力する。Unpooling と対で使う。',
  inputs: [inputPort('x')],
  outputs: [outputPort('y'), outputPort('indices', 'indices')],
  params: {
    kernel_size: { kind: 'int', label: '窓のサイズ', default: 2, min: 1 },
    stride: { kind: 'int', label: 'ストライド', default: 2, min: 1 },
    padding: { kind: 'int', label: 'パディング', default: 0, min: 0 },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: 'k{kernel_size}',
} satisfies NodeTypeDef
