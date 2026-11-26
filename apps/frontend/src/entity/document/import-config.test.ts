// @vitest-environment node
import { describe, expect, it } from 'vitest'

import exampleRaw from '../../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'
import { toStartTrainingRequestJson } from '../training/proto-json/convert'

import { serializeDocument } from './build'
import { emptyEditorDocument } from './document'
import { parseEditorFileText } from './import-config'

const codesOf = (result: ReturnType<typeof parseEditorFileText>): readonly string[] =>
  result.ok ? [] : result.issues.map((issue) => issue.code)

describe('parseEditorFileText', () => {
  it('保存ファイルを読む', () => {
    const text = serializeDocument(emptyEditorDocument('saved'), new Date(0))
    const result = parseEditorFileText(text)
    expect(result.ok && result.kind).toBe('document')
    expect(result.ok && result.document.meta.name).toBe('saved')
  })

  it('C++ の設定ファイル(test_segnet_dag.json)を、モデル構造と学習設定の入った文書として読む', () => {
    const result = parseEditorFileText(exampleRaw)
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result.kind).toBe('training-config')
    const { document } = result
    expect(document.meta).toEqual({ name: 'test_segnet', savedAt: null })
    expect(document.context).toEqual({ dataDim: '2d', method: 'cnn' })
    expect(document.graph.nodes.map((node) => node.id)).toEqual([
      'conv1',
      'relu1',
      'bn1',
      'pool1',
      'unpool1',
      'out_conv',
    ])
    expect(document.training?.optimizer.kind).toBe('adam')
    // 座標は持たない(読み込んだあとに自動配置する)
    expect(document.layout.positions.size).toBe(0)
  })

  it('取り込んだ設定から学習開始の JSON を作り直すと、データセット以外は元のファイルと同じになる', () => {
    const result = parseEditorFileText(exampleRaw)
    if (!result.ok || result.document.training === null) throw new Error('読めませんでした')
    // データセットはパス(dataset_path)ではなく ID で持つ。パスは読み捨て、未選択(空の dataset_id)になる
    const { dataset_path: _datasetPath, ...example } = JSON.parse(exampleRaw) as Record<
      string,
      unknown
    >
    // 学習率スケジューラはファイルにないので、既定値(なし)が入る
    expect(toStartTrainingRequestJson(result.document.graph, result.document.training)).toEqual({
      ...example,
      dataset_id: '',
      lr_scheduler: {
        scheduler: { none: {} },
        update_interval: 'LEARNING_RATE_UPDATE_INTERVAL_PER_BATCH',
        warmup_epochs: 0,
      },
    })
  })

  it('format があれば、壊れていても保存ファイルとして報告する(原因を取り違えない)', () => {
    const result = parseEditorFileText(
      JSON.stringify({ format: 'model-editor-document', version: 1, model_graph: {} }),
    )
    expect(codesOf(result)[0]).toBe('document/invalid-structure')
    if (!result.ok) expect(result.issues.map((issue) => issue.field)).toContain('meta')
  })

  it('設定ファイルの構造の誤りは、場所をパスで示す', () => {
    const broken = { ...(JSON.parse(exampleRaw) as Record<string, unknown>), epoch: 'ten' }
    const result = parseEditorFileText(JSON.stringify(broken))
    expect(codesOf(result)).toEqual(['document/invalid-structure'])
    if (!result.ok) expect(result.issues[0]?.field).toBe('epoch')
  })

  it('どちらの形式でもなければ、開ける形式を案内する', () => {
    const result = parseEditorFileText(JSON.stringify({ hello: 'world' }))
    expect(codesOf(result)).toEqual(['document/not-a-document'])
    if (!result.ok) expect(result.issues[0]?.message).toContain('model_graph')
  })

  it('JSON として読めなければ invalid-json', () => {
    expect(codesOf(parseEditorFileText('{'))).toEqual(['document/invalid-json'])
  })
})
