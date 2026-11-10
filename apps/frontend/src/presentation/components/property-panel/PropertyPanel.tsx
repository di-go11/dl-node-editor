import { isGraphInputNode, isGraphOutputNode } from '../../../entity/graph-editing/endpoint'
import { findNode } from '../../../entity/model-graph/model-graph'
import type { NodeId } from '../../../entity/model-graph/node-id'
import { findNodeType } from '../../../entity/node-catalog/catalog'
import type { Issue } from '../../../entity/validation/issue'
import { issuesOfNode } from '../../../entity/validation/issue'
import { useEditorStore } from '../../stores/editor-store-context'
import { ParamField } from '../param-form/ParamField'

import { GraphSummary } from './GraphSummary'
import { NodeIdField } from './NodeIdField'
import styles from './PropertyPanel.module.css'

/**
 * プロパティパネル(インスペクタ)。UE の Details パネル / Unity の Inspector に相当する(指示書 4.2)。
 *
 *   何も選んでいない        → グラフ全体の情報(GraphSummary)
 *   モデルのノードを 1 つ    → ID とパラメータの編集
 *   Input / Output を 1 つ  → 説明(パラメータはない)
 *   複数                   → 選んでいる数だけ
 *
 * パラメータの入力欄は、カタログの ParamDef から ParamField が自動で作る。
 * この部品は「どのノードの、どの定義を並べるか」だけを決める。
 */
export function PropertyPanel({ issues }: { readonly issues: readonly Issue[] }) {
  const selectedIds = useEditorStore((state) => state.selection.nodeIds)

  if (selectedIds.length === 0) return <GraphSummary issues={issues} />
  if (selectedIds.length > 1) {
    return <p className={styles.hint}>{selectedIds.length} 個のノードを選択しています。</p>
  }

  const id = selectedIds[0]
  if (id === undefined) return null
  if (isGraphInputNode(id) || isGraphOutputNode(id)) return <GraphIoDetails typeId={id} />
  return <NodeDetails nodeId={id} issues={issues} />
}

function NodeDetails({
  nodeId,
  issues,
}: {
  readonly nodeId: NodeId
  readonly issues: readonly Issue[]
}) {
  const node = useEditorStore((state) => findNode(state.document.graph, nodeId))
  const catalog = useEditorStore((state) => state.catalog)
  const updateParams = useEditorStore((state) => state.updateParams)

  // 選択の直後にノードが消えた(Delete キーなど)場合は何も出さない
  if (node === undefined) return null

  const def = findNodeType(catalog, node.spec.kind)
  // パラメータ以外の問題(未接続など)は、欄の横ではなくまとめて出す
  const otherIssues = issuesOfNode(issues, nodeId).filter((issue) => issue.paramName === undefined)

  return (
    <section aria-label="ノードの詳細">
      <h2 className={styles.heading}>
        {def?.label ?? node.spec.kind}
        <span className={styles.typeId}>{node.spec.kind}</span>
      </h2>
      {def?.description !== undefined && <p className={styles.description}>{def.description}</p>}

      {/* ID を付け替えると key が変わり、入力途中の状態を持ち越さない */}
      <NodeIdField key={nodeId} nodeId={nodeId} />

      {def === undefined ? (
        <p className={styles.error}>この層の種類({node.spec.kind})はカタログにありません。</p>
      ) : Object.keys(def.params).length === 0 ? (
        <p className={styles.hint}>この層に設定するパラメータはありません。</p>
      ) : (
        <div className={styles.params}>
          {Object.entries(def.params).map(([name, paramDef]) => (
            <ParamField
              // ノードを切り替えたら入力途中の状態を捨てるよう、ノード ID もキーに含める
              key={`${nodeId}:${name}`}
              name={name}
              def={paramDef}
              value={node.spec.params[name]}
              onCommit={(value) => updateParams(nodeId, { [name]: value })}
            />
          ))}
        </div>
      )}

      {otherIssues.length > 0 && (
        <ul className={styles.issues} aria-label="このノードの問題">
          {otherIssues.map((issue, index) => (
            <li key={index} className={issue.severity === 'error' ? styles.error : styles.warning}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GraphIoDetails({ typeId }: { readonly typeId: string }) {
  const catalog = useEditorStore((state) => state.catalog)
  const output = useEditorStore((state) => state.document.graph.outputs[0])
  const def = findNodeType(catalog, typeId)

  return (
    <section aria-label="ノードの詳細">
      <h2 className={styles.heading}>{def?.label ?? typeId}</h2>
      {def?.description !== undefined && <p className={styles.description}>{def.description}</p>}
      {isGraphOutputNode(typeId) && (
        <dl className={styles.summary}>
          <dt>つながっている出力</dt>
          <dd className={styles.mono}>
            {output === undefined ? '未接続' : `${output.nodeId}.${output.port}`}
          </dd>
        </dl>
      )}
      <p className={styles.hint}>エディタ専用のノードなので、ID やパラメータはありません。</p>
    </section>
  )
}
