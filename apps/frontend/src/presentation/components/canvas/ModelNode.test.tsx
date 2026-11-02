import { render, screen, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { emptyEditorDocument } from '../../../entity/document/document'
import type { EditorDocument } from '../../../entity/document/document'
import { defaultNodeCatalog } from '../../../entity/node-catalog/entries'
import { issueError } from '../../../entity/validation/issue'
import type { Issue } from '../../../entity/validation/issue'
import { buildGraph, validSegnetGraph } from '../../../entity/validation/test-fixtures'
import { nodeId } from '../../../entity/model-graph/node-id'
import { MODEL_NODE_TYPE, graphToFlow } from '../../mappers/graph-to-flow'
import { EMPTY_SELECTION } from '../../stores/editor-store'

import { ModelNode } from './ModelNode'

/**
 * カスタムノードの描画のテスト。
 *
 * ModelNode の中の Handle(ポート)は React Flow の内部の状態を使うので、
 * 単独では描けない。そこで本物の <ReactFlow> の中に、マッパーが作ったノードを渡して描く。
 * jsdom はレイアウトをしないので、位置や大きさではなく「何が書かれているか」を検査する。
 *
 * React Flow は大きさを測り終えるまでノードを visibility: hidden にしておく。jsdom では
 * 測れないのでノードは隠れたままになり、getByRole では見つからない(隠れた要素は
 * 支援技術に見えないため)。そこで test id とラベルで探している。
 */

const nodeTypes = { [MODEL_NODE_TYPE]: ModelNode }

function renderNodes(document: EditorDocument, issues: readonly Issue[] = []) {
  const { nodes } = graphToFlow({
    document,
    catalog: defaultNodeCatalog,
    selection: EMPTY_SELECTION,
    issues,
  })
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={[...nodes]} edges={[]} nodeTypes={nodeTypes} />
      </div>
    </ReactFlowProvider>,
  )
}

describe('ModelNode', () => {
  it('層の種類・ID・パラメータの要約を表示する', () => {
    renderNodes({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    const conv1 = screen.getByTestId('model-node-conv1')
    expect(conv1).toHaveTextContent('Conv2D')
    expect(conv1).toHaveTextContent('conv1')
    expect(conv1).toHaveTextContent('3→64, k3')
  })

  it('ポートをカタログの定義どおりに描き、種類の色のクラスを付ける', () => {
    renderNodes({ ...emptyEditorDocument(), graph: validSegnetGraph() })
    const unpool = screen.getByTestId('model-node-unpool1')
    const handles = unpool.querySelectorAll('.react-flow__handle')
    // Unpooling は入力 x / indices、出力 y
    expect([...handles].map((handle) => handle.getAttribute('data-handleid'))).toEqual([
      'x',
      'y',
      'indices',
    ])
    const indices = [...handles].find((h) => h.getAttribute('data-handleid') === 'indices')
    expect(indices?.className).toMatch(/port_indices/)
    expect(indices).toHaveAttribute('title', expect.stringContaining('位置(indices)'))
  })

  it('複数つなげるポート(Add の x)には、そのことが分かる印を付ける', () => {
    renderNodes({
      ...emptyEditorDocument(),
      graph: buildGraph([{ id: 'add1', kind: 'add' }]),
    })
    const handle = screen.getByTestId('model-node-add1').querySelector('.react-flow__handle')
    expect(handle?.className).toMatch(/variadic/)
    expect(handle).toHaveAttribute('title', expect.stringContaining('2 本以上'))
  })

  it('Input / Output も同じ部品で描く(ID は出さない)', () => {
    renderNodes(emptyEditorDocument())
    expect(screen.getByTestId('model-node-__input__')).toHaveTextContent('Input')
    expect(screen.getByTestId('model-node-__output__')).toHaveTextContent('Output')
    expect(screen.getByTestId('model-node-__input__')).not.toHaveTextContent('__input__')
  })

  it('問題の数をバッジで出す', () => {
    renderNodes({ ...emptyEditorDocument(), graph: validSegnetGraph() }, [
      issueError('param/invalid', 'e1', { nodeId: nodeId('bn1') }),
      issueError('param/invalid', 'e2', { nodeId: nodeId('bn1') }),
    ])
    expect(screen.getByTitle('問題が 2 件あります(ログを参照)')).toHaveTextContent('2')
  })

  it('今の条件で使えないノードは ⚠ を付けて赤く表示する(指示書 4.3)', () => {
    renderNodes({
      ...emptyEditorDocument(),
      graph: validSegnetGraph(),
      context: { dataDim: '1d', method: 'cnn' },
    })
    const conv1 = screen.getByTestId('model-node-conv1')
    expect(conv1.className).toMatch(/unavailable/)
    expect(within(conv1).getByLabelText('今の条件では使えません')).toHaveTextContent('⚠')
    // Input / Output はどの条件でも使えるので印は付かない
    expect(screen.getByTestId('model-node-__input__').className).not.toMatch(/unavailable/)
  })
})
