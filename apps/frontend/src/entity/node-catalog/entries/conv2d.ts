import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Conv2D(2 次元の畳み込み)。
 *
 * proto: model_graph.proto の Conv2DSpec
 * ポート: NodePorts.hpp の nodePortsOf(const Conv2DSpec&) - 入力 x / 出力 y
 *
 * satisfies を使っているのは、NodeTypeDef への適合を検査しつつ
 * params のキーをリテラル型として保つためである。これにより
 * src/api/node-catalog-params.contract.test.ts が、パラメータ名が契約
 * (Conv2DSpec)と一致していることをコンパイル時に検査できる。
 */
export const conv2dType = {
  editorOnly: false,
  typeId: 'conv2d',
  label: 'Conv2D',
  category: 'convolution',
  description: 'カーネルを滑らせて局所的な特徴を取り出す。CNN の基本となる層。',
  inputs: [inputPort('x')],
  outputs: [outputPort('y')],
  params: {
    in_channels: {
      kind: 'int',
      label: '入力チャンネル数',
      default: 3,
      min: 1,
      help: '上流の出力チャンネル数と一致させる。画像を直接受けるなら 3(RGB)。',
    },
    out_channels: {
      kind: 'int',
      label: '出力チャンネル数',
      default: 64,
      min: 1,
      help: 'カーネルの枚数。この層が取り出す特徴の種類の数にあたる。',
    },
    kernel_size: {
      kind: 'int',
      label: 'カーネルサイズ',
      default: 3,
      min: 1,
      help: '一度に見る範囲の一辺の長さ。3 が最もよく使われる。',
    },
    stride: {
      kind: 'int',
      label: 'ストライド',
      default: 1,
      min: 1,
      help: 'カーネルを動かす歩幅。2 にすると出力の縦横が半分になる。',
    },
    padding: {
      kind: 'int',
      label: 'パディング',
      default: 1,
      min: 0,
      help: '周囲に足す 0 の幅。kernel_size 3 / stride 1 のとき 1 にすると縦横が保たれる。',
    },
    dilation: {
      kind: 'int',
      label: '拡張率',
      default: 1,
      min: 1,
      help: 'カーネルの要素の間隔。大きくすると計算量を増やさず広い範囲を見られる。',
    },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: '{in_channels}→{out_channels}, k{kernel_size}',
} satisfies NodeTypeDef
