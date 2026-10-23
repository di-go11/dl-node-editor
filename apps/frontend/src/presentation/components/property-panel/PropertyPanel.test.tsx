import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { emptyEditorDocument } from '../../../entity/document/document'
import { GRAPH_OUTPUT_NODE } from '../../../entity/graph-editing/endpoint'
import { findNode } from '../../../entity/model-graph/model-graph'
import { nodeId } from '../../../entity/model-graph/node-id'
import { defaultNodeCatalog } from '../../../entity/node-catalog/entries'
import type { ModelGraph } from '../../../entity/model-graph/model-graph'
import { buildGraph, validSegnetGraph } from '../../../entity/validation/test-fixtures'
import { validateModelGraph } from '../../../entity/validation/validate-model-graph'
import type { EditorSelection } from '../../stores/editor-store'
import { createEditorStore } from '../../stores/editor-store'
import { EditorStoreContext } from '../../stores/editor-store-context'

import { PropertyPanel } from './PropertyPanel'
import { ResizablePanel } from './ResizablePanel'

function renderPanel(selection?: EditorSelection, graph: ModelGraph = validSegnetGraph()) {
  const store = createEditorStore({
    catalog: defaultNodeCatalog,
    initialDocument: { ...emptyEditorDocument('segnet'), graph },
  })
  if (selection !== undefined) store.getState().setSelection(selection)
  const { document, catalog } = store.getState()
  const issues = validateModelGraph({
    graph: document.graph,
    context: document.context,
    catalog,
  }).issues
  render(
    <EditorStoreContext value={store}>
      <PropertyPanel issues={issues} />
    </EditorStoreContext>,
  )
  return { store }
}

const select = (...ids: string[]): EditorSelection => ({
  nodeIds: ids.map((id) => (id === GRAPH_OUTPUT_NODE ? GRAPH_OUTPUT_NODE : nodeId(id))),
  edgeIds: [],
})

describe('PropertyPanel - 何も選んでいないとき', () => {
  it('グラフ全体の情報を出す', () => {
    renderPanel()
    const summary = screen.getByRole('region', { name: 'グラフの情報' })
    expect(summary).toHaveTextContent('segnet')
    expect(summary).toHaveTextContent('2D / CNN')
    expect(summary).toHaveTextContent('ノード数6')
    expect(summary).toHaveTextContent('out_conv.y')
  })
})

describe('PropertyPanel - ノードを 1 つ選んだとき', () => {
  it('カタログの定義から、パラメータの入力欄を自動で並べる', () => {
    renderPanel(select('conv1'))
    const details = screen.getByRole('region', { name: 'ノードの詳細' })
    expect(within(details).getByRole('heading')).toHaveTextContent('Conv2D')
    // Conv2D の 6 つのパラメータ + ID の欄
    expect(within(details).getAllByRole('textbox')).toHaveLength(7)
    expect(within(details).getByLabelText(/入力チャンネル数/)).toHaveValue('3')
  })

  it('入力した値がストアに書き込まれる', async () => {
    const { store } = renderPanel(select('conv1'))
    const input = screen.getByLabelText(/出力チャンネル数/)
    await userEvent.clear(input)
    await userEvent.type(input, '32')
    const conv1 = findNode(store.getState().document.graph, nodeId('conv1'))
    expect(conv1?.spec.params.out_channels).toBe(32)
  })

  it('ID は Enter で確定し、接続ごと付け替える', async () => {
    const { store } = renderPanel(select('conv1'))
    const idInput = screen.getByLabelText('ID')
    await userEvent.clear(idInput)
    await userEvent.type(idInput, 'enc1{Enter}')
    const { graph } = store.getState().document
    expect(findNode(graph, nodeId('enc1'))).toBeDefined()
    expect(store.getState().selection.nodeIds).toEqual(['enc1'])
  })

  it('使えない ID は理由を出し、確定しない', async () => {
    const { store } = renderPanel(select('conv1'))
    const idInput = screen.getByLabelText('ID')
    await userEvent.clear(idInput)
    await userEvent.type(idInput, 'bn1{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('別のノードが使っています')
    expect(findNode(store.getState().document.graph, nodeId('conv1'))).toBeDefined()
  })

  it('Esc で入力を取り消す', async () => {
    renderPanel(select('conv1'))
    const idInput = screen.getByLabelText('ID')
    await userEvent.clear(idInput)
    await userEvent.type(idInput, 'zzz{Escape}')
    expect(idInput).toHaveValue('conv1')
  })

  it('パラメータのない層(Concat)では、そう表示する', () => {
    renderPanel(select('concat1'), buildGraph([{ id: 'concat1', kind: 'concat' }]))
    expect(screen.getByText('この層に設定するパラメータはありません。')).toBeInTheDocument()
  })

  it('パラメータ以外の問題(未接続など)を、このノードの問題としてまとめて出す', () => {
    renderPanel(select('concat1'), buildGraph([{ id: 'concat1', kind: 'concat' }]))
    const list = screen.getByRole('list', { name: 'このノードの問題' })
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0)
  })
})

describe('PropertyPanel - Input / Output と複数選択', () => {
  it('Output を選ぶと、loss に渡す値(logits)であることと、つながっている出力を出す', () => {
    renderPanel(select(GRAPH_OUTPUT_NODE))
    const details = screen.getByRole('region', { name: 'ノードの詳細' })
    expect(details).toHaveTextContent('logits')
    expect(details).toHaveTextContent('argmax')
    expect(details).toHaveTextContent('out_conv.y')
    expect(within(details).queryByRole('textbox')).toBeNull()
  })

  it('複数選ぶと、選んでいる数だけを出す', () => {
    renderPanel(select('conv1', 'bn1'))
    expect(screen.getByText('2 個のノードを選択しています。')).toBeInTheDocument()
  })
})

describe('ResizablePanel', () => {
  function renderResizable() {
    render(
      <ResizablePanel label="パネル" defaultWidth={300} minWidth={220} maxWidth={400}>
        <p>中身</p>
      </ResizablePanel>,
    )
  }

  it('つまみを左へドラッグすると広がり、上限で止まる', () => {
    renderResizable()
    const separator = screen.getByRole('separator', { name: 'パネルの幅' })
    // jsdom は setPointerCapture を持たないので、テストの間だけ何もしない関数を置く
    separator.setPointerCapture = () => {}
    separator.releasePointerCapture = () => {}

    act(() => {
      fireEvent.pointerDown(separator, { clientX: 500, pointerId: 1 })
      fireEvent.pointerMove(separator, { clientX: 450, pointerId: 1 })
    })
    expect(separator).toHaveAttribute('aria-valuenow', '350')
    act(() => {
      fireEvent.pointerMove(separator, { clientX: 100, pointerId: 1 })
      fireEvent.pointerUp(separator, { pointerId: 1 })
    })
    expect(separator).toHaveAttribute('aria-valuenow', '400')
  })

  it('キーボードの ← → でも幅を変えられる', async () => {
    renderResizable()
    const separator = screen.getByRole('separator', { name: 'パネルの幅' })
    separator.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(separator).toHaveAttribute('aria-valuenow', '284')
  })

  it('折りたたむと中身を隠し、開き直せる', async () => {
    renderResizable()
    await userEvent.click(screen.getByRole('button', { name: 'パネルを折りたたむ' }))
    expect(screen.queryByText('中身')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'パネルを開く' }))
    expect(screen.getByText('中身')).toBeInTheDocument()
  })
})
