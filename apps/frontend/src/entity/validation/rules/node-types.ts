import { formatEditorContext } from '../../editor-context/editor-context'
import { isAvailableInContext } from '../../node-catalog/node-type'
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
 * メッセージは指示書 4.3 の文言「このノードは現在の条件(例:1D / CNN)では使えません」に
 * 合わせ、どの条件なら使えるかも添える(条件の表記はヘッダの表示と同じ formatEditorContext)。
 *
 * 条件を切り替えてもノードを消さないのは、切り替えを試すだけで作業が消えるのを
 * 防ぐためである。代わりに赤色表示(presentation)とこの Issue で知らせる。
 */
export const validateContextCompat: ValidationRule = (input) => {
  const current = formatEditorContext(input.context)
  const issues: Issue[] = []
  for (const node of input.graph.nodes) {
    const def = nodeTypeOf(input.catalog, node)
    if (def === undefined) continue
    // 判定はカタログの isAvailableInContext に任せる(サイドバーの絞り込みと同じ関数)。
    // 2 か所で別々に判定すると、「サイドバーには出るのに赤くなる」ずれが起こりうる
    if (isAvailableInContext(def, input.context)) continue

    const supported = def.contexts.map(formatEditorContext).join('、')
    issues.push(
      issueError(
        'node/unavailable-in-context',
        `このノード(${def.label})は現在の条件(${current})では使えません。` +
          `使える条件: ${supported}`,
        { nodeId: node.id },
      ),
    )
  }
  return issues
}
