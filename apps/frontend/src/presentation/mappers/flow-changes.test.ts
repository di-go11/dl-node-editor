// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { GRAPH_INPUT_NODE, GRAPH_OUTPUT_NODE } from '../../entity/graph-editing/endpoint'
import { nodeId } from '../../entity/model-graph/node-id'
import { EMPTY_SELECTION } from '../stores/editor-store'

import {
  endpointsOfConnection,
  interpretEdgeChanges,
  interpretNodeChanges,
  toEditorNodeId,
  withMeasurements,
} from './flow-changes'
import type { ModelFlowNode } from './graph-to-flow'

describe('toEditorNodeId', () => {
  it('Input / Output の予約 ID と、モデルのノード ID を読める', () => {
    expect(toEditorNodeId(GRAPH_INPUT_NODE)).toBe(GRAPH_INPUT_NODE)
    expect(toEditorNodeId(GRAPH_OUTPUT_NODE)).toBe(GRAPH_OUTPUT_NODE)
    expect(toEditorNodeId('conv1')).toBe('conv1')
  })

  it('ノード ID として使えない文字列は null', () => {
    expect(toEditorNodeId('conv 1')).toBeNull()
  })
})

describe('interpretNodeChanges', () => {
  it('ドラッグ中の座標を、ストアに書く移動にする', () => {
    const effects = interpretNodeChanges(
      [{ id: 'conv1', type: 'position', position: { x: 1, y: 2 }, dragging: true }],
      EMPTY_SELECTION,
    )
    expect(effects.moves).toEqual([{ id: 'conv1', position: { x: 1, y: 2 } }])
  })

  it('ドラッグの終わり(position のない変更)は何も書かない', () => {
    const effects = interpretNodeChanges(
      [{ id: 'conv1', type: 'position', dragging: false }],
      EMPTY_SELECTION,
    )
    expect(effects.moves).toEqual([])
  })

  it('選択の変更を、今の選択に重ねる', () => {
    const selection = { nodeIds: [nodeId('conv1'), nodeId('bn1')], edgeIds: ['e1'] }
    const effects = interpretNodeChanges(
      [
        { id: 'bn1', type: 'select', selected: false },
        { id: 'relu1', type: 'select', selected: true },
      ],
      selection,
    )
    // 線の選択はそのまま残す
    expect(effects.selection).toEqual({ nodeIds: ['conv1', 'relu1'], edgeIds: ['e1'] })
  })

  it('選択の変更がなければ selection は null(ストアを無駄に更新しない)', () => {
    expect(interpretNodeChanges([], EMPTY_SELECTION).selection).toBeNull()
  })

  it('測った大きさは、ストアではなく表示用に返す', () => {
    const effects = interpretNodeChanges(
      [{ id: 'conv1', type: 'dimensions', dimensions: { width: 150, height: 80 } }],
      EMPTY_SELECTION,
    )
    expect(effects.measurements).toEqual([{ id: 'conv1', dimensions: { width: 150, height: 80 } }])
    expect(effects.moves).toEqual([])
  })

  it('削除の変更は扱わない(onDelete でノードと線をまとめて処理する)', () => {
    const effects = interpretNodeChanges([{ id: 'conv1', type: 'remove' }], EMPTY_SELECTION)
    expect(effects).toEqual({ moves: [], selection: null, measurements: [] })
  })
})

describe('interpretEdgeChanges', () => {
  it('線の選択を、今の選択に重ねる(ノードの選択は残す)', () => {
    const selection = { nodeIds: [nodeId('conv1')], edgeIds: ['a'] }
    expect(
      interpretEdgeChanges(
        [
          { id: 'a', type: 'select', selected: false },
          { id: 'b', type: 'select', selected: true },
        ],
        selection,
      ),
    ).toEqual({ nodeIds: ['conv1'], edgeIds: ['b'] })
  })

  it('選択の変更がなければ null', () => {
    expect(interpretEdgeChanges([{ id: 'a', type: 'remove' }], EMPTY_SELECTION)).toBeNull()
  })
})

describe('endpointsOfConnection', () => {
  it('React Flow の Connection を端点の組にする', () => {
    expect(
      endpointsOfConnection({
        source: GRAPH_INPUT_NODE,
        sourceHandle: 'y',
        target: 'conv1',
        targetHandle: 'x',
      }),
    ).toEqual({
      source: { node: GRAPH_INPUT_NODE, port: 'y' },
      target: { node: 'conv1', port: 'x' },
    })
  })

  it('ハンドルが分からない接続は null', () => {
    expect(
      endpointsOfConnection({
        source: 'conv1',
        sourceHandle: null,
        target: 'bn1',
        targetHandle: 'x',
      }),
    ).toBeNull()
  })

  it('Output を出力側に、Input を入力側にした接続は null', () => {
    expect(
      endpointsOfConnection({
        source: GRAPH_OUTPUT_NODE,
        sourceHandle: 'x',
        target: 'conv1',
        targetHandle: 'x',
      }),
    ).toBeNull()
    expect(
      endpointsOfConnection({
        source: 'conv1',
        sourceHandle: 'y',
        target: GRAPH_INPUT_NODE,
        targetHandle: 'y',
      }),
    ).toBeNull()
  })
})

describe('withMeasurements', () => {
  const node = (id: string): ModelFlowNode => ({
    id,
    type: 'model',
    position: { x: 0, y: 0 },
    data: {
      typeId: 'conv2d',
      label: 'Conv2D',
      summary: '',
      inputs: [],
      outputs: [],
      editorOnly: false,
      unknownType: false,
      unavailable: false,
      issueSeverity: null,
      issueCount: 0,
    },
  })

  it('測った大きさを書き戻し、測っていないノードはそのまま返す', () => {
    const a = node('a')
    const b = node('b')
    const result = withMeasurements([a, b], new Map([['a', { width: 10, height: 20 }]]))
    expect(result[0]?.measured).toEqual({ width: 10, height: 20 })
    expect(result[1]).toBe(b)
  })
})
