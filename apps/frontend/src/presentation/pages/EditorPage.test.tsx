import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import exampleRaw from '../../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'
import { apiOk } from '../../application/ports/api-result'
import type { DocumentStorage, OpenedFile } from '../../application/ports/document-storage'
import type { EditorDocument } from '../../entity/document/document'
import { emptyEditorDocument } from '../../entity/document/document'
import { GRAPH_INPUT_NODE, GRAPH_OUTPUT_NODE } from '../../entity/graph-editing/endpoint'
import { nodeId } from '../../entity/model-graph/node-id'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import type { Dependencies } from '../app/dependencies'
import { DependenciesContext } from '../app/dependencies'
import { createEditorStore } from '../stores/editor-store'
import { EditorStoreContext } from '../stores/editor-store-context'

import { EditorPage } from './EditorPage'

/**
 * フェーズ 3 の完了条件の結合テスト:
 * 「2D から 1D へ切り替えると、置いたノードが赤色になり、ログに警告が出る」
 *
 * ヘッダ・キャンバス・ログ・ストア・検証を本物のまま組み合わせて描き、
 * 利用者の操作(ヘッダのセレクトを変える)から画面の変化までを 1 本で確かめる。
 * 部品ごとのテストでは、部品どうしのつなぎ目(ストアの条件が検証に渡るか、
 * 検証の結果がキャンバスとログの両方に届くか)の誤りを見逃すためである。
 */

/**
 * 偽物の保存先。保存された内容を記録し、open では「次に選ばれるファイル」を返す。
 * ブラウザのダウンロードとファイル選択の代わりに、保存 → 読込を往復させるのに使う。
 */
function fakeStorage() {
  const saved: OpenedFile[] = []
  const toOpen: OpenedFile[] = []
  const storage: DocumentStorage = {
    save: (name, text) => {
      saved.push({ name, text })
      return Promise.resolve({ ok: true })
    },
    open: () => {
      const file = toOpen.shift()
      return Promise.resolve(file === undefined ? { kind: 'cancelled' } : { kind: 'opened', file })
    },
  }
  return { storage, saved, toOpen }
}

function renderEditor(
  initialDocument: EditorDocument = { ...emptyEditorDocument(), graph: validSegnetGraph() },
  storage: DocumentStorage = fakeStorage().storage,
) {
  const dependencies: Dependencies = {
    nodeCatalogSource: { load: () => Promise.resolve(apiOk(defaultNodeCatalog)) },
    capabilitiesApi: {
      getCapabilities: () => Promise.resolve(apiOk({ cudaAvailable: false, devices: [] })),
    },
    documentStorage: storage,
  }
  const store = createEditorStore({ catalog: defaultNodeCatalog, initialDocument })
  render(
    <DependenciesContext value={dependencies}>
      <EditorStoreContext value={store}>
        <MemoryRouter>
          <EditorPage />
        </MemoryRouter>
      </EditorStoreContext>
    </DependenciesContext>,
  )
  return { store }
}

const MODEL_NODE_IDS = ['conv1', 'relu1', 'bn1', 'pool1', 'unpool1', 'out_conv']

const unavailableLogRows = (): HTMLElement[] =>
  within(screen.getByRole('region', { name: 'ログ' }))
    .queryAllByRole('listitem')
    .filter((row) => row.textContent?.includes('現在の条件(1D / CNN)では使えません'))

describe('条件の切り替え(フェーズ 3 の完了条件)', () => {
  it('2D / CNN では、どのノードも赤くならず、条件の問題もログに出ない', () => {
    renderEditor()
    for (const id of MODEL_NODE_IDS) {
      expect(screen.getByTestId(`model-node-${id}`).className).not.toMatch(/unavailable/)
    }
    expect(unavailableLogRows()).toHaveLength(0)
  })

  it('1D に切り替えると、置いたノードが ⚠ 付きの赤色になり、ログに警告が出る', async () => {
    const { store } = renderEditor()
    await userEvent.selectOptions(screen.getByLabelText('データ形式'), '1d')

    for (const id of MODEL_NODE_IDS) {
      const node = screen.getByTestId(`model-node-${id}`)
      expect(node.className).toMatch(/unavailable/)
      expect(within(node).getByLabelText('今の条件では使えません')).toBeInTheDocument()
    }
    // Input / Output はどの条件でも使えるので赤くならない
    expect(screen.getByTestId('model-node-__input__').className).not.toMatch(/unavailable/)

    // ノード 1 つにつき 1 行。ノード ID も出るので、どれのことか分かる
    const rows = unavailableLogRows()
    expect(rows).toHaveLength(MODEL_NODE_IDS.length)
    expect(rows[0]).toHaveTextContent('conv1')

    // ノードは消さない(指示書 4.3)
    expect(store.getState().document.graph.nodes).toHaveLength(MODEL_NODE_IDS.length)
  })

  it('1D ではサイドバーに「近日実装予定」と出て、ノードは並ばない', async () => {
    renderEditor()
    await userEvent.selectOptions(screen.getByLabelText('データ形式'), '1d')
    const sidebar = screen.getByRole('navigation', { name: 'ノードの一覧' })
    expect(within(sidebar).getByRole('note')).toHaveTextContent('近日実装予定')
    expect(within(sidebar).queryByRole('button')).toBeNull()
  })

  it('2D に戻すと、赤色もログの警告も消える', async () => {
    renderEditor()
    const select = screen.getByLabelText('データ形式')
    await userEvent.selectOptions(select, '1d')
    await userEvent.selectOptions(select, '2d')

    for (const id of MODEL_NODE_IDS) {
      expect(screen.getByTestId(`model-node-${id}`).className).not.toMatch(/unavailable/)
    }
    expect(unavailableLogRows()).toHaveLength(0)
  })

  it('Transformer に切り替えても同じように扱う(手法の切り替え)', async () => {
    renderEditor()
    await userEvent.selectOptions(screen.getByLabelText('特徴抽出手法'), 'transformer')
    expect(screen.getByTestId('model-node-conv1').className).toMatch(/unavailable/)
    const log = screen.getByRole('region', { name: 'ログ' })
    expect(log).toHaveTextContent('現在の条件(2D / Transformer)では使えません')
  })
})

describe('保存と読込(フェーズ 4 の完了条件)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 座標と並び順を確かめるための、すべてのノードに座標がある文書 */
  function placedDocument(): EditorDocument {
    const graph = validSegnetGraph()
    // わざとトポロジカル順ではない並びにする(並べ替えが入れば必ず崩れる)
    const nodes = [...graph.nodes].reverse()
    const ids = [GRAPH_INPUT_NODE, ...nodes.map((node) => node.id), GRAPH_OUTPUT_NODE]
    return {
      ...emptyEditorDocument('segnet'),
      graph: { ...graph, nodes },
      layout: {
        positions: new Map(ids.map((id, index) => [id, { x: index * 100, y: index * 7 }])),
        viewport: { x: 10, y: 20, zoom: 0.8 },
      },
    }
  }

  const log = () => screen.getByRole('region', { name: 'ログ' })

  it('保存して読み込み直すと、座標と並び順も含めて元に戻る', async () => {
    const files = fakeStorage()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const original = placedDocument()
    const { store } = renderEditor(original, files.storage)

    // 1. 保存する
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(files.saved.map((file) => file.name)).toEqual(['segnet.json'])
    expect(log()).toHaveTextContent('segnet.json として保存しました。')
    expect(screen.queryByText('● 未保存')).toBeNull()

    // 2. 保存したあとに編集する(ノードを動かす・足す)。未保存の印が出る
    store.getState().moveNode(nodeId('conv1'), { x: -500, y: -500 })
    store.getState().addNode('linear', { x: 0, y: 0 })
    expect(await screen.findByText('● 未保存')).toBeInTheDocument()

    // 3. 保存したファイルを読み込む。保存していない変更があるので確認が出る
    files.toOpen.push(files.saved[0] as OpenedFile)
    await userEvent.click(screen.getByRole('button', { name: '読込' }))
    expect(confirm).toHaveBeenCalledOnce()

    // 4. 保存した時点に戻る(並び順・座標・表示範囲)
    const { document } = store.getState()
    expect(document.graph.nodes.map((node) => node.id)).toEqual(
      original.graph.nodes.map((node) => node.id),
    )
    expect([...document.layout.positions]).toEqual([...original.layout.positions])
    expect(document.layout.viewport).toEqual(original.layout.viewport)
    expect(screen.queryByText('● 未保存')).toBeNull()
    expect(log()).toHaveTextContent('segnet.json を開きました。')
  })

  it('不正なファイルは、どこがおかしいかをログに出し、今の作業はそのまま残す', async () => {
    const files = fakeStorage()
    const confirm = vi.spyOn(window, 'confirm')
    const { store } = renderEditor(placedDocument(), files.storage)
    const before = store.getState().document

    files.toOpen.push({
      name: 'broken.json',
      text: JSON.stringify({
        format: 'model-editor-document',
        version: 1,
        meta: { name: 'x' },
        context: { data_dim: '3d', method: 'cnn' },
        model: { model_graph: { nodes: [], outputs: [] } },
      }),
    })
    await userEvent.click(screen.getByRole('button', { name: '読込' }))

    expect(log()).toHaveTextContent('broken.json を開けませんでした(問題 1 件)')
    expect(log()).toHaveTextContent('context.data_dim')
    expect(store.getState().document).toBe(before)
    // 不正なファイルでは今の作業を消さないので、確認も出さない
    expect(confirm).not.toHaveBeenCalled()
  })

  it('確認で「キャンセル」を選んだら、読み込まない', async () => {
    const files = fakeStorage()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { store } = renderEditor(placedDocument(), files.storage)
    store.getState().moveNode(nodeId('conv1'), { x: 1, y: 1 }) // 未保存の変更を作る
    const before = store.getState().document

    files.toOpen.push({ name: 'other.json', text: exampleRaw })
    await userEvent.click(screen.getByRole('button', { name: '読込' }))
    expect(store.getState().document).toBe(before)
  })

  it('C++ の設定ファイルを取り込み、ノードを自動で配置する', async () => {
    const files = fakeStorage()
    const { store } = renderEditor(emptyEditorDocument(), files.storage)

    files.toOpen.push({ name: 'test_segnet_dag.json', text: exampleRaw })
    await userEvent.click(screen.getByRole('button', { name: '読込' }))

    const { document } = store.getState()
    expect(document.meta.name).toBe('test_segnet')
    expect(document.graph.nodes).toHaveLength(6)
    expect(document.training?.optimizer.kind).toBe('adam')
    expect(document.layout.positions.size).toBe(8)
    expect(log()).toHaveTextContent('学習の設定ファイルとして取り込みました')
  })

  it('Ctrl+S でも保存する', async () => {
    const files = fakeStorage()
    renderEditor(placedDocument(), files.storage)
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(files.saved).toHaveLength(1)
  })
})
