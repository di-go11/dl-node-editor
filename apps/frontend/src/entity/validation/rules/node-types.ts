import { NODE_CATEGORY_LABELS } from '../../node-catalog/node-type'
import type { Issue } from '../issue'
import { issueError } from '../issue'
import type { ValidationRule } from '../validation-input'
import { nodeTypeOf } from '../validation-input'

/**
 * カタログに定義のない層の種類を使っていないかを調べる。
 *
 * **このルールが「定義が引けない」を報告する唯一の場所である。**
 * ほかのルールは定義が引けないノードを黙って飛ばす。そうしないと 1 つの原因に対して
 * 「ポートが不明」「パラメータが不明」と Issue が何件も並び、原因が埋もれる。
 *
 * 実際に起こる経路: 新しい層が proto に追加された版で保存したファイルを、
 * カタログが古い版のフロントで読み込んだとき。
 */
export const validateNodeTypes: ValidationRule = (input) => {
  const issues: Issue[] = []
  for (const node of input.graph.nodes) {
    if (nodeTypeOf(input.catalog, node) !== undefined) continue
    issues.push(
      issueError(
        'node/unknown-type',
        `知らない層の種類です: ${node.spec.kind}。` +
          `このフロントエンドのノードカタログに定義がありません。`,
        { nodeId: node.id },
      ),
    )
  }
  return issues
}

/**
 * 今の条件(データ形式 / 特徴抽出手法)で使えないノードが残っていないかを調べる(指示書 4.3)。
 *
 * severity を error にしているのは、指示書が「このノードが残っている間は
 * 整合性チェックを通さない」としているためである。文中では「警告」と書かれているが、
 * 実行を止める以上、この型では error が正しい。
 *
 * 条件を切り替えてもノードを消さないのは、切り替えを試すだけで作業が消えるのを
 * 防ぐためである。代わりに赤色表示(presentation)とこの Issue で知らせる。
 */
export const validateContextCompat: ValidationRule = (input) => {
  const issues: Issue[] = []
  for (const node of input.graph.nodes) {
    const def = nodeTypeOf(input.catalog, node)
    if (def === undefined) continue
    if (
      def.contexts.some(
        (c) => c.dataDim === input.context.dataDim && c.method === input.context.method,
      )
    ) {
      continue
    }
    const supported = def.contexts.map((c) => `${c.dataDim.toUpperCase()} / ${c.method}`).join('、')
    issues.push(
      issueError(
        'node/unavailable-in-context',
        `${def.label}(${NODE_CATEGORY_LABELS[def.category]})は現在の条件では使えません。` +
          `使える条件: ${supported}`,
        { nodeId: node.id },
      ),
    )
  }
  return issues
}
