// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { ModelGraph } from '../../model-graph/model-graph'
import { nodeId } from '../../model-graph/node-id'
import type { NodeKind } from '../../model-graph/node-spec'
import { GRAPH_INPUT } from '../../model-graph/port'
import { validSegnetGraph, validationInput } from '../test-fixtures'

import { validateContextCompat, validateNodeTypes } from './node-types'

const codesOf = (issues: readonly { code: string }[]): readonly string[] =>
  issues.map((issue) => issue.code)

describe('validateNodeTypes', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(validateNodeTypes(validationInput(validSegnetGraph()))).toEqual([])
  })

  it('カタログに定義のない層の種類を報告する', () => {
    // 新しい層が追加された版で保存したファイルを、古いカタログで読んだ状況を再現する。
    // 通常の経路では作れない値なのでキャストしている
    const graph: ModelGraph = {
      nodes: [
        {
          id: nodeId('x1'),
          spec: { kind: 'conv_transpose2d' as NodeKind, params: {} },
          inputs: [{ port: 'x', source: GRAPH_INPUT }],
        },
      ],
      outputs: [],
    }
    const issues = validateNodeTypes(validationInput(graph))
    expect(codesOf(issues)).toEqual(['node/unknown-type'])
    expect(issues[0]?.message).toContain('conv_transpose2d')
  })
})

describe('validateContextCompat', () => {
  it('2D / CNN では何も報告しない', () => {
    expect(
      validateContextCompat(validationInput(validSegnetGraph(), { dataDim: '2d', method: 'cnn' })),
    ).toEqual([])
  })

  it('1D に切り替えると、置いたノードすべてを報告する', () => {
    // 指示書 4.3「条件を切り替えたとき、キャンバスに置いたノードは消さない」
    // 切り替えを試すだけで作業が消えるのを防ぐため、消さずに知らせる
    const issues = validateContextCompat(
      validationInput(validSegnetGraph(), { dataDim: '1d', method: 'cnn' }),
    )
    expect(issues).toHaveLength(6)
    expect(new Set(codesOf(issues))).toEqual(new Set(['node/unavailable-in-context']))
  })

  it('実行を止めるので severity は error である', () => {
    // 指示書は「警告を出す」と書いているが、同時に「このノードが残っている間は
    // 整合性チェックを通さない」としている。実行を止める以上 error が正しい
    const issues = validateContextCompat(
      validationInput(validSegnetGraph(), { dataDim: '1d', method: 'cnn' }),
    )
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true)
  })

  it('どの条件なら使えるかをメッセージに出す', () => {
    const issues = validateContextCompat(
      validationInput(validSegnetGraph(), { dataDim: '1d', method: 'cnn' }),
    )
    expect(issues[0]?.message).toContain('2D / cnn')
  })

  it('該当するノードを指し示す(ログのクリックでフォーカスするため)', () => {
    const issues = validateContextCompat(
      validationInput(validSegnetGraph(), { dataDim: '2d', method: 'transformer' }),
    )
    expect(issues.map((issue) => issue.nodeId)).toEqual([
      'conv1',
      'relu1',
      'bn1',
      'pool1',
      'unpool1',
      'out_conv',
    ])
  })
})
