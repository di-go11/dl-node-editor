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
 * Output の意味(ユーザーと合意済み):Output につないだ値は「loss に渡す値(logits)」である。
 * 確率からクラスへの変換(argmax)は微分できないので、グラフの中には入れない。
 * 評価のときに学習エンジン(C++ の TorchModelEvaluator)が後処理として行う。
 * また、libtorch の cross_entropy は内部で log_softmax をとるので、Output の直前に
 * Softmax を置くと二重にかかる(フェーズ 5 の整合性チェックで警告する予定)。
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
  description:
    'ここにつないだ値(logits)が、そのまま loss に渡される。' +
    'セグメンテーション・クラス分類の評価では、学習エンジンがこの値を argmax でクラスに変換する。' +
    '当面 1 つだけ(model_graph.proto の outputs に対応)。',
  // 種類を any にしているのは、出力が特徴マップでもトークン列でもありうるため
  inputs: [inputPort('x', { kind: 'any' })],
  // ノードの上に、この値の行き先を表示する(パラメータを参照しない固定の文字列)
  summaryTemplate: 'logits → loss',
  outputs: [],
  params: {},
  contexts: ALL_EDITOR_CONTEXTS,
} satisfies NodeTypeDef
