import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { memo } from 'react'

import type { PortKind } from '../../../entity/model-graph/port'
import type { InputPortDef, OutputPortDef } from '../../../entity/node-catalog/node-type'
import type { ModelFlowNode } from '../../mappers/graph-to-flow'

import styles from './Canvas.module.css'

/**
 * キャンバス上のノード 1 つ(React Flow のカスタムノード)。
 *
 * 見た目は UE のマテリアルエディタ / Unity の Shader Graph に倣う(指示書 4.2)。
 *
 *   ┌──────────────────────┐
 *   │ Conv2D        conv1  │ ← タイトル(層の種類)と ID
 *   │ 3→64, k3             │ ← 主要パラメータの要約(表示だけ。編集はプロパティパネル)
 *   ├──────────────────────┤
 *   │● x              y ●│ ← 左が入力ポート、右が出力ポート。色はポートの種類
 *   └──────────────────────┘
 *
 * すべてカタログの定義(data.inputs / data.outputs)から描く汎用の部品であり、
 * 層の種類ごとの部品は作らない。ノードを 1 種類増やしても、ここは変わらない。
 *
 * memo で包んでいるのは、ほかのノードを動かしただけで全ノードを描き直さないためである
 * (React Flow の公式の推奨でもある)。
 */

const KIND_LABELS: Readonly<Record<PortKind, string>> = {
  feature: '特徴マップ',
  tokens: 'トークン列',
  indices: '位置(indices)',
  any: '任意',
}

function portClassName(kind: PortKind, variadic: boolean): string {
  return [styles.handle, styles[`port_${kind}`], variadic ? styles.variadic : undefined]
    .filter(Boolean)
    .join(' ')
}

function inputPortTitle(port: InputPortDef): string {
  const many = port.variadic ? `、複数接続可(${port.minCount} 本以上)` : ''
  return `入力 ${port.name}: ${KIND_LABELS[port.kind]}${many}`
}

function outputPortTitle(port: OutputPortDef): string {
  return `出力 ${port.name}: ${KIND_LABELS[port.kind]}`
}

function ModelNodeComponent({ id, data, selected }: NodeProps<ModelFlowNode>) {
  const classNames = [
    styles.node,
    selected ? styles.selected : undefined,
    data.unavailable ? styles.unavailable : undefined,
    data.issueSeverity === 'error' ? styles.hasError : undefined,
    data.editorOnly ? styles.graphIo : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  // 行の数は入力と出力の多いほうに合わせ、入出力を左右に並べる
  const rowCount = Math.max(data.inputs.length, data.outputs.length)

  return (
    <div className={classNames} data-testid={`model-node-${id}`}>
      <div className={styles.title}>
        {data.unavailable && (
          <span className={styles.warningMark} role="img" aria-label="今の条件では使えません">
            ⚠
          </span>
        )}
        <span className={styles.label}>{data.label}</span>
        {!data.editorOnly && <span className={styles.nodeId}>{id}</span>}
        {data.issueCount > 0 && (
          <span
            className={data.issueSeverity === 'error' ? styles.badgeError : styles.badgeWarning}
            title={`問題が ${data.issueCount} 件あります(ログを参照)`}
          >
            {data.issueCount}
          </span>
        )}
      </div>
      {data.summary !== '' && <div className={styles.summary}>{data.summary}</div>}
      {rowCount > 0 && (
        <div className={styles.ports}>
          {Array.from({ length: rowCount }, (_, row) => {
            const input = data.inputs[row]
            const output = data.outputs[row]
            return (
              <div className={styles.portRow} key={row}>
                <div className={styles.portCell}>
                  {input !== undefined && (
                    <>
                      <Handle
                        type="target"
                        position={Position.Left}
                        id={input.name}
                        className={portClassName(input.kind, input.variadic)}
                        title={inputPortTitle(input)}
                      />
                      <span className={styles.portName}>{input.name}</span>
                    </>
                  )}
                </div>
                <div className={`${styles.portCell} ${styles.portCellOut}`}>
                  {output !== undefined && (
                    <>
                      <span className={styles.portName}>{output.name}</span>
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={output.name}
                        className={portClassName(output.kind, false)}
                        title={outputPortTitle(output)}
                      />
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const ModelNode = memo(ModelNodeComponent)
