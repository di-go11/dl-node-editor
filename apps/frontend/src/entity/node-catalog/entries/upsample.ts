import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Upsample(補間による拡大)。
 *
 * proto: UpsampleSpec / UpsampleMode
 * ポート: NodePorts.hpp の nodePortsOf(const UpsampleSpec&) - 入力 x / 出力 y
 *
 * Unpooling と違い indices を必要としないので、単独で使える。
 * U-Net のデコーダのように、学習するパラメータを持たせずに拡大したいときに使う。
 */
export const upsampleType = {
  editorOnly: false,
  typeId: 'upsample',
  label: 'Upsample',
  category: 'upsample',
  description: '補間で特徴マップを拡大する。学習するパラメータを持たない。',
  inputs: [inputPort('x')],
  outputs: [outputPort('y')],
  params: {
    upsample_mode: {
      kind: 'enum',
      label: '補間方法',
      default: 'UPSAMPLE_MODE_NEAREST',
      options: [
        { value: 'UPSAMPLE_MODE_NEAREST', label: 'Nearest' },
        { value: 'UPSAMPLE_MODE_BILINEAR', label: 'Bilinear' },
      ],
      help: 'Nearest は最も近い画素をそのまま複製する。Bilinear は周囲 4 画素から線形補間する。',
    },
    scale_factor: {
      kind: 'int',
      label: '倍率',
      default: 2,
      min: 2,
      help: '縦横をこの倍数に拡大する。',
    },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: '{upsample_mode} ×{scale_factor}',
} satisfies NodeTypeDef
