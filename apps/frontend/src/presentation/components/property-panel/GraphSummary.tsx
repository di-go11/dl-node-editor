import { formatEditorContext } from '../../../entity/editor-context/editor-context'
import type { Issue } from '../../../entity/validation/issue'
import { useEditorStore } from '../../stores/editor-store-context'

import styles from './PropertyPanel.module.css'

/**
 * 何も選んでいないときのプロパティパネル。グラフ全体の情報を出す(指示書 4.2)。
 */
export function GraphSummary({ issues }: { readonly issues: readonly Issue[] }) {
  const graph = useEditorStore((state) => state.document.graph)
  const context = useEditorStore((state) => state.document.context)
  const name = useEditorStore((state) => state.document.meta.name)

  const connectionCount =
    graph.nodes.reduce((sum, node) => sum + node.inputs.length, 0) + graph.outputs.length
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const output = graph.outputs[0]

  return (
    <section aria-label="グラフの情報">
      <h2 className={styles.heading}>グラフ</h2>
      <dl className={styles.summary}>
        <dt>名前</dt>
        <dd>{name}</dd>
        <dt>条件</dt>
        <dd>{formatEditorContext(context)}</dd>
        <dt>ノード数</dt>
        <dd>{graph.nodes.length}</dd>
        <dt>接続数</dt>
        <dd>{connectionCount}</dd>
        <dt>モデルの出力</dt>
        <dd className={styles.mono}>
          {output === undefined ? '未接続' : `${output.nodeId}.${output.port}`}
        </dd>
        <dt>問題</dt>
        <dd>
          エラー {errorCount} / 警告 {issues.length - errorCount}
        </dd>
      </dl>
      <p className={styles.hint}>ノードを選ぶと、ここでパラメータを編集できます。</p>
    </section>
  )
}
