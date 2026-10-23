import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { apiOk } from '../../application/ports/api-result'
import { emptyEditorDocument } from '../../entity/document/document'
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

const dependencies: Dependencies = {
  nodeCatalogSource: { load: () => Promise.resolve(apiOk(defaultNodeCatalog)) },
  capabilitiesApi: {
    getCapabilities: () => Promise.resolve(apiOk({ cudaAvailable: false, devices: [] })),
  },
}

function renderEditor() {
  const store = createEditorStore({
    catalog: defaultNodeCatalog,
    initialDocument: { ...emptyEditorDocument(), graph: validSegnetGraph() },
  })
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
