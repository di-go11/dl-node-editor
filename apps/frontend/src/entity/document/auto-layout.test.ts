// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { GRAPH_INPUT_NODE, GRAPH_OUTPUT_NODE } from '../graph-editing/endpoint'
import type { ModelGraph } from '../model-graph/model-graph'
import { buildGraph, validSegnetGraph } from '../validation/test-fixtures'

import { LAYOUT_COLUMN_GAP, LAYOUT_ROW_GAP, fillMissingPositions } from './auto-layout'
import type { EditorDocument } from './document'
import { emptyEditorDocument } from './document'

const documentOf = (graph: ModelGraph, positions = new Map()): EditorDocument => ({
  ...emptyEditorDocument(),
  graph,
  layout: { positions, viewport: null },
})

const columnOf = (document: EditorDocument, id: string): number | undefined => {
  const x = document.layout.positions.get(id)?.x
  return x === undefined ? undefined : x / LAYOUT_COLUMN_GAP
}

describe('fillMissingPositions', () => {
  it('Input を段 0、各ノードを最長経路の深さの段、Output を最後の段に置く', () => {
    const filled = fillMissingPositions(documentOf(validSegnetGraph()))
    const columns = [GRAPH_INPUT_NODE, 'conv1', 'relu1', 'bn1', 'pool1', 'unpool1', 'out_conv'].map(
      (id) => columnOf(filled, id),
    )
    expect(columns).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(columnOf(filled, GRAPH_OUTPUT_NODE)).toBe(7)
  })

  it('合流するノードは、長いほうの経路で段が決まる(線が逆向きに走らない)', () => {
    // conv1 → relu1 → add1 と、conv1 → add1 の 2 経路。add1 は段 3(短いほうなら段 2)
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'relu1', kind: 'activation', inputs: { x: ['conv1', 'y'] } },
      {
        id: 'add1',
        kind: 'add',
        inputs: {
          x: [
            ['conv1', 'y'],
            ['relu1', 'y'],
          ],
        },
      },
    ])
    const filled = fillMissingPositions(documentOf(graph))
    expect(columnOf(filled, 'add1')).toBe(3)
  })

  it('同じ段のノードは、並び順に上から積む', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'b', kind: 'conv2d', inputs: { x: 'graph-input' } },
    ])
    const filled = fillMissingPositions(documentOf(graph))
    expect(filled.layout.positions.get('a')).toEqual({ x: LAYOUT_COLUMN_GAP, y: 0 })
    expect(filled.layout.positions.get('b')).toEqual({ x: LAYOUT_COLUMN_GAP, y: LAYOUT_ROW_GAP })
  })

  it('すでに座標のあるノードは動かさない', () => {
    const positions = new Map([['relu1', { x: 999, y: 888 }]])
    const filled = fillMissingPositions(documentOf(validSegnetGraph(), positions))
    expect(filled.layout.positions.get('relu1')).toEqual({ x: 999, y: 888 })
    expect(filled.layout.positions.has('conv1')).toBe(true)
  })

  it('全部に座標があれば、同じ文書をそのまま返す(未保存の判定を乱さない)', () => {
    const once = fillMissingPositions(documentOf(validSegnetGraph()))
    expect(fillMissingPositions(once)).toBe(once)
  })

  it('閉路があっても例外にせず、並び順で右へずらして置く', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: ['b', 'y'] } },
      { id: 'b', kind: 'conv2d', inputs: { x: ['a', 'y'] } },
    ])
    const filled = fillMissingPositions(documentOf(graph))
    expect(columnOf(filled, 'a')).toBe(1)
    expect(columnOf(filled, 'b')).toBe(2)
  })
})
