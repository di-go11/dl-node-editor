import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Add(要素ごとの足し算)。ResNet の残差接続や FPN で使う。
 *
 * proto: AddSpec
 * ポート: NodePorts.hpp の nodePortsOf(const AddSpec&)
 *         入力 x(種類 Any、**variadic、minCount 2**)/ 出力 y(Any)
 *
 * 同じ 'x' というポートに 2 本以上つなぐ。入力はすべて同じ形状・同じ種類である
 * 必要があるが、形状の検証は C++ 側でも行われないため、ここでは本数と種類だけを見る。
 */
export const addType = {
  editorOnly: false,
  typeId: 'add',
  label: 'Add',
  category: 'merge',
  description: '複数の入力を要素ごとに足す。形状が同じでなければ学習開始時に失敗する。',
  inputs: [inputPort('x', { kind: 'any', variadic: true, minCount: 2 })],
  outputs: [outputPort('y', 'any')],
  params: {
    alpha: {
      kind: 'float',
      label: 'alpha',
      default: 1,
      help: '2 番目以降の入力にかける係数。1 なら単純な足し算になる。',
    },
  },
  contexts: [{ dataDim: '2d', method: 'cnn' }],
  summaryTemplate: 'α={alpha}',
} satisfies NodeTypeDef
