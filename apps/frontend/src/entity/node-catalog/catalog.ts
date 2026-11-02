import type { EditorContext } from '../editor-context/editor-context'

import type { NodeCategory, NodeTypeDef, NodeTypeId } from './node-type'
import { NODE_CATEGORIES, NODE_CATEGORY_LABELS, isAvailableInContext } from './node-type'

/**
 * ノードカタログ - ノード定義の集合に対する問い合わせ。
 *
 * 配列をそのまま持ち回らず型にしているのは、次の 2 つのためである。
 *   - typeId による検索を毎回 find せずに済ませる(Map を一緒に持つ)
 *   - 「ノードの種類の集合」という概念に名前を付け、引数の意味を明確にする
 */
export type NodeCatalog = {
  /** 定義の並び順。サイドバーでの表示順にも使う */
  readonly types: readonly NodeTypeDef[]
  readonly byTypeId: ReadonlyMap<NodeTypeId, NodeTypeDef>
}

/**
 * 定義の配列からカタログを作る。
 *
 * typeId の重複はプログラムの誤りなので例外にする。黙って後の定義で上書きすると、
 * 「サイドバーには出るのに検証が別の定義を見ている」という追いにくい不具合になる。
 */
export function createNodeCatalog(types: readonly NodeTypeDef[]): NodeCatalog {
  const byTypeId = new Map<NodeTypeId, NodeTypeDef>()
  for (const def of types) {
    if (byTypeId.has(def.typeId)) {
      throw new Error(`ノードの種類 ${def.typeId} が重複しています`)
    }
    byTypeId.set(def.typeId, def)
  }
  return { types, byTypeId }
}

export function findNodeType(catalog: NodeCatalog, typeId: string): NodeTypeDef | undefined {
  return catalog.byTypeId.get(typeId as NodeTypeId)
}

/** 今の条件で使える種類だけを、定義の並び順で返す */
export function nodeTypesForContext(
  catalog: NodeCatalog,
  context: EditorContext,
): readonly NodeTypeDef[] {
  return catalog.types.filter((def) => isAvailableInContext(def, context))
}

/**
 * サイドバーに並べる種類。
 *
 * エディタ専用(Input / Output)は除く。グラフに 1 つだけ存在するノードであり、
 * ドラッグで増やせてはいけないためである。
 */
export function placeableNodeTypes(
  catalog: NodeCatalog,
  context: EditorContext,
): readonly NodeTypeDef[] {
  return nodeTypesForContext(catalog, context).filter((def) => !def.editorOnly)
}

export type CategoryGroup = {
  readonly category: NodeCategory
  readonly label: string
  readonly types: readonly NodeTypeDef[]
}

/**
 * サイドバーの折りたたみ式ディレクトリ用に、カテゴリ別にまとめる。
 *
 * 並び順は NODE_CATEGORIES の順に固定する。使える種類が 0 件のカテゴリは返さない
 * (空のディレクトリを見せる意味がないため)。
 */
export function placeableNodeTypesByCategory(
  catalog: NodeCatalog,
  context: EditorContext,
): readonly CategoryGroup[] {
  const placeable = placeableNodeTypes(catalog, context)
  return NODE_CATEGORIES.map((category) => ({
    category,
    label: NODE_CATEGORY_LABELS[category],
    types: placeable.filter((def) => def.category === category),
  })).filter((group) => group.types.length > 0)
}
