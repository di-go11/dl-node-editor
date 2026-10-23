import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { emptyEditorDocument } from '../../../entity/document/document'
import type { EditorContext } from '../../../entity/editor-context/editor-context'
import { defaultNodeCatalog } from '../../../entity/node-catalog/entries'
import { createEditorStore } from '../../stores/editor-store'
import { EditorStoreContext } from '../../stores/editor-store-context'
import { NODE_DRAG_MIME } from '../canvas/node-drag'

import { Sidebar } from './Sidebar'

function renderSidebar(context?: EditorContext, onActivate = vi.fn()) {
  const store = createEditorStore({
    catalog: defaultNodeCatalog,
    initialDocument: { ...emptyEditorDocument(), ...(context === undefined ? {} : { context }) },
  })
  render(
    <EditorStoreContext value={store}>
      <Sidebar onActivate={onActivate} />
    </EditorStoreContext>,
  )
  return { store, onActivate }
}

describe('Sidebar', () => {
  it('2D / CNN では、カテゴリ別に MVP のノードを並べる', () => {
    renderSidebar()
    const nav = screen.getByRole('navigation', { name: 'ノードの一覧' })
    const categories = within(nav)
      .getAllByRole('group')
      .map((group) => group.querySelector('summary')?.textContent)
    expect(categories).toEqual([
      '畳み込み',
      'プーリング',
      '正規化',
      '活性化',
      '全結合',
      '拡大',
      '結合',
    ])
    expect(within(nav).getByRole('button', { name: 'Conv2D' })).toBeInTheDocument()
  })

  it('Input / Output は並べない(グラフに 1 つずつで、増やせない)', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: 'Input' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Output' })).toBeNull()
  })

  it('1D を選ぶと、ノードを出さず「近日実装予定」と表示する(指示書 4.3)', () => {
    renderSidebar({ dataDim: '1d', method: 'cnn' })
    expect(screen.getByRole('note')).toHaveTextContent('1D 用のノードは近日実装予定です')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('クリックでノードを選ぶ(マウスでドラッグできない環境のため)', async () => {
    const { onActivate } = renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'BatchNorm' }))
    expect(onActivate).toHaveBeenCalledWith('batch_norm')
  })

  it('ドラッグを始めると、層の種類を独自の MIME タイプで渡す', () => {
    renderSidebar()
    const setData = vi.fn()
    fireEvent.dragStart(screen.getByRole('button', { name: 'Conv2D' }), {
      dataTransfer: { setData, effectAllowed: 'none' },
    })
    expect(setData).toHaveBeenCalledWith(NODE_DRAG_MIME, 'conv2d')
  })
})
