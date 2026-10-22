import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Unpooling(indices を使って元の位置に戻す拡大)。
 *
 * proto: UnpoolingSpec
 * ポート: NodePorts.hpp の nodePortsOf(const UnpoolingSpec&)
 *         入力 x と indices(indices)/ 出力 y
 *
 * **入力ポートが 2 つある唯一の MVP ノード。** indices ポートは種類が Indices なので、
 * IndexedPooling の indices 出力以外にはつながらない(検証層が確かめる)。
 */
export const unpoolingType = {
  editorOnly: false,
  typeId: 'unpooling',
  label: 'Unpooling',
  category: 'upsample',
  description: 'IndexedPooling が出した indices を使い、最大値だった位置に値を戻して拡大する。',
  inputs: [inputPort('x'), inputPort('indices', { kind: 'indices' })],
  outputs: [outputPort('y')],
  params: {
    kernel_size: {
      kind: 'int',
      label: '窓のサイズ',
      default: 2,
      min: 1,
      help: '対になる IndexedPooling と同じ値にする。',
    },
    stride: { kind: 'int', label: 'ストライド', default: 2, min: 1 },
    padding: { kind: 'int', label: 'パディング', default: 0, min: 0 },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: 'k{kernel_size}',
} satisfies NodeTypeDef
