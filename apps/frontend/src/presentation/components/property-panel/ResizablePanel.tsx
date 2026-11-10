import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'

import styles from './PropertyPanel.module.css'

/**
 * 幅を変えられ、折りたためる右側のパネル(指示書 4.2「パネルの幅は変えられるようにし、
 * 折りたためるようにする」)。中身を知らない汎用の入れ物である。
 *
 * ## 幅の変更
 *
 * 左端のつまみ(区切り線)をドラッグする。Pointer Events の setPointerCapture を使うと、
 * ドラッグ中にポインタがつまみの外へ出ても、移動のイベントを受け取り続けられる。
 * (これがないと、速く動かしたときにつまみから外れてドラッグが途切れる)
 *
 * つまみは role="separator" とし、キーボードの ← → でも幅を変えられるようにしている。
 * WAI-ARIA で「大きさを変えられる区切り線」を表す決まった書き方である。
 *
 * 幅と折りたたみの状態は、この部品の中だけに持つ(保存しない表示の好み)。
 */

export type ResizablePanelProps = {
  readonly label: string
  readonly children: ReactNode
  readonly defaultWidth?: number
  readonly minWidth?: number
  readonly maxWidth?: number
}

const KEYBOARD_STEP = 16

export function ResizablePanel({
  label,
  children,
  defaultWidth = 300,
  minWidth = 220,
  maxWidth = 600,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [collapsed, setCollapsed] = useState(false)
  const dragStart = useRef<{ readonly x: number; readonly width: number } | null>(null)

  const clamp = (value: number): number => Math.min(maxWidth, Math.max(minWidth, value))

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = { x: event.clientX, width }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = dragStart.current
    if (start === null) return
    // パネルは右側にあるので、つまみを左へ動かす(clientX が減る)と幅が広がる
    setWidth(clamp(start.width + (start.x - event.clientX)))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragStart.current = null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') setWidth((current) => clamp(current + KEYBOARD_STEP))
    if (event.key === 'ArrowRight') setWidth((current) => clamp(current - KEYBOARD_STEP))
  }

  if (collapsed) {
    return (
      <aside className={styles.collapsed} aria-label={label}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={false}
          aria-label={`${label}を開く`}
          onClick={() => setCollapsed(false)}
        >
          ◂
        </button>
      </aside>
    )
  }

  return (
    <aside className={styles.panel} style={{ width }} aria-label={label}>
      <div
        className={styles.resizer}
        role="separator"
        aria-orientation="vertical"
        aria-label={`${label}の幅`}
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      />
      <div className={styles.panelHeader}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={true}
          aria-label={`${label}を折りたたむ`}
          onClick={() => setCollapsed(true)}
        >
          ▸
        </button>
      </div>
      <div className={styles.panelBody}>{children}</div>
    </aside>
  )
}
