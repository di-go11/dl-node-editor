import { useMemo } from 'react'
import type { DragEvent } from 'react'

import { unavailableNotesOf } from '../../../entity/editor-context/editor-context'
import { placeableNodeTypesByCategory } from '../../../entity/node-catalog/catalog'
import { useEditorStore } from '../../stores/editor-store-context'
import { setDraggedNodeType } from '../canvas/node-drag'

import styles from './Sidebar.module.css'

/**
 * サイドバー - 置けるノードを、カテゴリ別の折りたたみ式ディレクトリで並べる(指示書 4.2)。
 *
 * 中身はノードカタログを「今の条件(データ形式 / 手法)」で絞り込んだ結果だけ(指示書 4.3)。
 * 絞り込みはエンティティ層の placeableNodeTypesByCategory が行い、この部品は描くだけ。
 *
 * 折りたたみには HTML の <details> / <summary> を使う。開閉の状態を自分で持たずに済み、
 * キーボード操作やスクリーンリーダーへの対応もブラウザが受け持ってくれる。
 *
 * ノードはドラッグ&ドロップで置くほか、クリック(または Enter)でも置ける。
 * マウスでドラッグできない環境でも使えるようにするためである。
 */

export type SidebarProps = {
  /** クリックで選ばれたときに呼ぶ。ノードをどこに置くかは呼び出し側が決める */
  readonly onActivate: (typeId: string) => void
}

export function Sidebar({ onActivate }: SidebarProps) {
  const catalog = useEditorStore((state) => state.catalog)
  const context = useEditorStore((state) => state.document.context)

  const groups = useMemo(() => placeableNodeTypesByCategory(catalog, context), [catalog, context])
  const notes = useMemo(() => unavailableNotesOf(context), [context])

  const onDragStart = (event: DragEvent, typeId: string): void => {
    setDraggedNodeType(event.dataTransfer, typeId)
  }

  return (
    <nav className={styles.sidebar} aria-label="ノードの一覧">
      {notes.map((note) => (
        <p key={note} className={styles.note} role="note">
          {note}
        </p>
      ))}
      {groups.map((group) => (
        <details key={group.category} className={styles.group} open>
          <summary className={styles.summary}>{group.label}</summary>
          <ul className={styles.list}>
            {group.types.map((def) => (
              <li key={def.typeId}>
                <button
                  type="button"
                  className={styles.item}
                  draggable
                  onDragStart={(event) => onDragStart(event, def.typeId)}
                  onClick={() => onActivate(def.typeId)}
                  title={def.description}
                >
                  {def.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {groups.length === 0 && notes.length === 0 && (
        <p className={styles.note}>この条件で使えるノードはありません。</p>
      )}
    </nav>
  )
}
