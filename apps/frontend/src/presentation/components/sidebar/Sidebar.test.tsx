import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { emptyEditorDocument } from '../../../entity/document/document'
import type { EditorContext } from '../../../entity/editor-context/editor-context'
import { createNodeCatalog } from '../../../entity/node-catalog/catalog'
import type { NodeCatalog } from '../../../entity/node-catalog/catalog'
import { DEFAULT_NODE_TYPES, defaultNodeCatalog } from '../../../entity/node-catalog/entries'
import { createEditorStore } from '../../stores/editor-store'
import { EditorStoreContext } from '../../stores/editor-store-context'
import { NODE_DRAG_MIME } from '../canvas/node-drag'

import { Sidebar } from './Sidebar'

function renderSidebar(
  context?: EditorContext,
  onActivate = vi.fn(),
  catalog: NodeCatalog = defaultNodeCatalog,
) {
  const store = createEditorStore({
    catalog,
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

  it('1D のノードは、カタログに足すだけでサイドバーに出る(UI のコードは変えない)', () => {
    // 指示書 4.3「1D 用のノードは、後でカタログに足すだけで追加できるようにしておく」。
    // 本物の 1D の層はまだ proto にないので、Conv2D の contexts に 1D を足した
    // 架空のカタログで、仕組みだけを確かめる
    const catalog = createNodeCatalog(
      DEFAULT_NODE_TYPES.map((def) =>
        def.typeId === 'conv2d'
          ? { ...def, contexts: [...def.contexts, { dataDim: '1d', method: 'cnn' } as const] }
          : def,
      ),
    )
    renderSidebar({ dataDim: '1d', method: 'cnn' }, vi.fn(), catalog)
    expect(screen.getByRole('button', { name: 'Conv2D' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BatchNorm' })).toBeNull()
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
