import type { EditorContext } from '../editor-context/editor-context'
import type { GraphNode, ModelGraph } from '../model-graph/model-graph'
import type { NodeCatalog } from '../node-catalog/catalog'
import { findNodeType } from '../node-catalog/catalog'
import type { NodeTypeDef } from '../node-catalog/node-type'

import type { Issue } from './issue'

/**
 * 検証ルールの共通の入力と型。
 *
 * ルールを「ValidationInput を受けて Issue[] を返す純粋関数」に統一すると、
 * 配列に並べるだけで合成でき、1 件ずつ独立に単体テストできる。
 * ルールの追加は配列への 1 行で済む(開放閉鎖原則)。
 */
export type ValidationInput = {
  readonly graph: ModelGraph
  readonly context: EditorContext
  readonly catalog: NodeCatalog
}

export type ValidationRule = (input: ValidationInput) => readonly Issue[]

/**
 * ノードに対応するカタログの定義を引く。
 *
 * 定義が見つからないことは rules/node-types.ts が 1 か所で報告する。
 * ほかのルールは定義が引けないノードを黙って飛ばす。そうしないと、
 * 1 つの原因(知らない層の種類)に対して 5 件も 6 件も Issue が並び、
 * 本当の原因が埋もれてしまう。
 */
export function nodeTypeOf(catalog: NodeCatalog, node: GraphNode): NodeTypeDef | undefined {
  return findNodeType(catalog, node.spec.kind)
}
