import { ALL_EDITOR_CONTEXTS } from '../../editor-context/editor-context'
import type { NodeTypeDef } from '../node-type'
import { inputPort, outputPort } from '../node-type'

/**
 * Input / Output - **エディタ専用のノード。**
 *
 * proto のノードにはならない(指示書 5.3)。変換のときに次のように対応する。
 *
 *   Input からの接続   → source が空の PortRef(グラフ入力)
 *   Output への接続     → ModelGraph.outputs
 *
 * カタログにエントリを置いているのは、ポートの色やラベルを UI が
 * ほかのノードと同じ仕組みで描けるようにするためである。
 * editorOnly: true なのでサイドバーには出ず(placeableNodeTypes が除く)、
 * ドラッグで増やすこともできない。グラフにそれぞれ 1 つだけ存在する。
 *
 * contexts に ALL_EDITOR_CONTEXTS を使っているのは、入出力はどの条件でも
 * 必要だからである。組み合わせを手で並べず列挙値から作っているので、
 * データ形式や手法が増えても追従する。
 */

export const graphInputType = {
  editorOnly: true,
  typeId: '__input__',
  label: 'Input',
  category: 'graph-io',
  description: 'モデルに入ってくるデータ(画像)。グラフにつき 1 つ。',
  inputs: [],
  outputs: [outputPort('y')],
  params: {},
  contexts: ALL_EDITOR_CONTEXTS,
} satisfies NodeTypeDef

export const graphOutputType = {
  editorOnly: true,
  typeId: '__output__',
  label: 'Output',
  category: 'graph-io',
  description: 'モデルの出力。当面 1 つだけ(model_graph.proto の outputs に対応)。',
  // 種類を any にしているのは、出力が特徴マップでもトークン列でもありうるため
  inputs: [inputPort('x', { kind: 'any' })],
  outputs: [],
  params: {},
  contexts: ALL_EDITOR_CONTEXTS,
} satisfies NodeTypeDef
