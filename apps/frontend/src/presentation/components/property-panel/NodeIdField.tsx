import { useId, useState } from 'react'

import type { NodeId } from '../../../entity/model-graph/node-id'
import { useEditorStore } from '../../stores/editor-store-context'

import styles from './PropertyPanel.module.css'

/**
 * ノード ID の入力欄。
 *
 * パラメータと違い、**入力のたびには確定しない。** Enter かフォーカスを外したときに確定し、
 * Esc で元に戻す。ID は接続や座標のキーにもなっているので、「c」「co」「con」…と
 * 1 文字ごとに付け替えるのは無駄であり、途中の文字列が別のノードの ID と一致すると
 * 一時的に「重複」のエラーが出て紛らわしい。
 *
 * 使えない ID のときは、ストアが返す理由(entity/graph-editing/rename.ts)を欄の下に出し、
 * 入力した文字列は残す(直して確定し直せるように)。
 */
export function NodeIdField({ nodeId }: { readonly nodeId: NodeId }) {
  const renameNode = useEditorStore((state) => state.renameNode)
  const inputId = useId()
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const commit = (): void => {
    if (draft === null) return
    const result = renameNode(nodeId, draft)
    if (result.ok) {
      setDraft(null)
      setError(null)
    } else {
      setError(result.reason)
    }
  }

  const cancel = (): void => {
    setDraft(null)
    setError(null)
  }

  return (
    <div className={styles.idField}>
      <label htmlFor={inputId} className={styles.idLabel}>
        ID
      </label>
      <input
        id={inputId}
        className={styles.idInput}
        value={draft ?? nodeId}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') cancel()
        }}
      />
      {error !== null && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
