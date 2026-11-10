// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { findNode } from '../model-graph/model-graph'
import { nodeId } from '../model-graph/node-id'
import { nodeOutput } from '../model-graph/port'
import { validSegnetGraph } from '../validation/test-fixtures'

import { checkNodeIdInput } from './rename'

describe('checkNodeIdInput', () => {
  it('ID を付け替え、そのノードを指していた接続と出力も書き換える', () => {
    const result = checkNodeIdInput(validSegnetGraph(), nodeId('out_conv'), 'classifier')
    if (!result.ok) throw new Error(result.reason)
    expect(result.id).toBe('classifier')
    expect(result.graph.outputs).toEqual([nodeOutput(nodeId('classifier'), 'y')])
    expect(findNode(result.graph, nodeId('out_conv'))).toBeUndefined()
  })

  it('前後の空白は取り除く', () => {
    const result = checkNodeIdInput(validSegnetGraph(), nodeId('conv1'), '  enc1  ')
    expect(result.ok && result.id).toBe('enc1')
  })

  it('同じ ID のまま確定するのは、何もしない操作', () => {
    const graph = validSegnetGraph()
    const result = checkNodeIdInput(graph, nodeId('conv1'), 'conv1')
    expect(result).toEqual({ ok: true, graph, id: 'conv1' })
  })

  it.each([
    ['', '入力してください'],
    ['conv 1', '英数字と - _ だけ'],
    ['__input__', '予約されています'],
    ['bn1', '別のノードが使っています'],
  ])('%j は理由付きで拒否する', (input, reason) => {
    const result = checkNodeIdInput(validSegnetGraph(), nodeId('conv1'), input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(reason)
  })
})
