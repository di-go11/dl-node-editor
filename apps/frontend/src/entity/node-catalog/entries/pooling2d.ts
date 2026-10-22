import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Pooling2D(縮小。最大値または平均)。
 *
 * proto: Pooling2DSpec / PoolingType
 * ポート: NodePorts.hpp の nodePortsOf(const PoolingSpec&) - 入力 x / 出力 y
 *
 * なお C++ 側の型名は PoolingSpec、proto 側は Pooling2DSpec で食い違っている
 * (ポートの定義内容は同じ)。このカタログは proto の oneof 名 pooling2d に合わせる。
 * API に送る JSON のキーは proto 側で決まるためである。
 */
export const pooling2dType = {
  editorOnly: false,
  typeId: 'pooling2d',
  label: 'Pooling2D',
  category: 'pooling',
  description: '一定の窓ごとに代表値を取り、特徴マップを縮小する。',
  inputs: [inputPort('x')],
  outputs: [outputPort('y')],
  params: {
    pooling_type: {
      kind: 'enum',
      label: '種類',
      default: 'POOLING_TYPE_MAX',
      options: [
        { value: 'POOLING_TYPE_MAX', label: 'Max' },
        { value: 'POOLING_TYPE_AVERAGE', label: 'Average' },
      ],
      help: 'Max は窓の最大値、Average は平均値を取る。',
    },
    kernel_size: { kind: 'int', label: '窓のサイズ', default: 2, min: 1 },
    stride: {
      kind: 'int',
      label: 'ストライド',
      default: 2,
      min: 1,
      help: 'kernel_size と同じ値にすると、縦横がちょうど 1/kernel_size になる。',
    },
    padding: { kind: 'int', label: 'パディング', default: 0, min: 0 },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: '{pooling_type} k{kernel_size}',
} satisfies NodeTypeDef
