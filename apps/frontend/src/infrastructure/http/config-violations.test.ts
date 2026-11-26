import { describe, expect, it } from 'vitest'

import { toStartTrainingRequestJson } from '../../entity/training/proto-json/convert'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'

import { configViolationIssues } from './config-violations'
import type { RustStartTrainingRequest } from './rust-training-request'
import { toRustStartTrainingRequest } from './rust-training-request'

/**
 * 学習設定の誤りの 422 の本文(InvalidConfig)を、画面の Issue に直す変換のテスト。
 * サーバーの位置(Rust の JSON の書き方。ノードは添字)を、ノード ID・ポート・パラメータ名、
 * proto-json の項目名に直せるかを確かめる。
 */

function request(): RustStartTrainingRequest {
  const settings = { ...defaultTrainingSettings(), datasetId: 'dataset-1', device: 'cpu' }
  const converted = toRustStartTrainingRequest(toStartTrainingRequestJson(validSegnetGraph(), settings))
  if (!converted.ok) throw new Error(converted.message)
  return converted.value
}

function body(...violations: readonly { field: string; message: string }[]) {
  return { error: 'invalid_config', violations }
}

describe('configViolationIssues', () => {
  it('本文が InvalidConfig でなければ undefined(データセットがない 422 など、本文がない場合)', () => {
    expect(configViolationIssues(null, request())).toBeUndefined()
    expect(configViolationIssues('', request())).toBeUndefined()
    expect(configViolationIssues({ error: 'other' }, request())).toBeUndefined()
    expect(configViolationIssues(body(), request())).toBeUndefined() // 違反が 0 件は契約にない
  })

  it('違反はすべて training/server-rejected の error にする', () => {
    const issues = configViolationIssues(
      body(
        { field: 'epoch', message: '1 以上にしてください(0)' },
        { field: 'batch', message: '1 以上にしてください(0)' },
      ),
      request(),
    )
    expect(issues).toHaveLength(2)
    expect(issues?.every((i) => i.severity === 'error' && i.code === 'training/server-rejected')).toBe(
      true,
    )
  })

  it('ノードの添字をノード ID に直す', () => {
    const req = request()
    const node = req.model_graph.nodes[1]
    const [issue] =
      configViolationIssues(body({ field: 'model_graph.nodes[1]', message: '形が合いません' }), req) ?? []
    expect(issue).toMatchObject({ nodeId: node?.id, message: '形が合いません' })
    expect(issue?.port).toBeUndefined()
  })

  it('ポート単位の問題は、メッセージの先頭のポート名を port にする', () => {
    const req = request()
    const [issue] =
      configViolationIssues(
        body({
          field: 'model_graph.nodes[2]',
          message: "ポート 'y': モデルの出力のチャンネル数(3)が、クラス数(21)と一致しません",
        }),
        req,
      ) ?? []
    expect(issue).toMatchObject({ nodeId: req.model_graph.nodes[2]?.id, port: 'y' })
  })

  it('入力の接続の問題は、そのノードの入力のポート名を port にする', () => {
    const req = request()
    const node = req.model_graph.nodes[1]
    const [issue] =
      configViolationIssues(
        body({ field: 'model_graph.nodes[1].inputs[0]', message: '参照先のノードが存在しません' }),
        req,
      ) ?? []
    expect(issue).toMatchObject({ nodeId: node?.id, port: node?.inputs[0]?.port })
  })

  it('層のパラメータの問題は、paramName にする', () => {
    const req = request()
    const [issue] =
      configViolationIssues(
        body({ field: 'model_graph.nodes[0].spec.stride', message: '1 以上にしてください(0)' }),
        req,
      ) ?? []
    expect(issue).toMatchObject({ nodeId: req.model_graph.nodes[0]?.id, paramName: 'stride' })
  })

  it('outputs とグラフ全体の問題は、特定のノードではなく model_graph にする', () => {
    const issues =
      configViolationIssues(
        body(
          { field: 'model_graph.outputs[0]', message: 'a' },
          { field: 'model_graph', message: 'b' },
        ),
        request(),
      ) ?? []
    expect(issues.map((i) => [i.field, i.nodeId])).toEqual([
      ['model_graph', undefined],
      ['model_graph', undefined],
    ])
  })

  it('範囲外の添字(リクエストにないノード)は model_graph にする', () => {
    const [issue] =
      configViolationIssues(body({ field: 'model_graph.nodes[999]', message: 'x' }), request()) ?? []
    expect(issue).toMatchObject({ field: 'model_graph' })
    expect(issue?.nodeId).toBeUndefined()
  })

  it('学習設定の位置を proto-json の項目名にする(種類の名前を間に入れる)', () => {
    const req = request()
    const fields =
      configViolationIssues(
        body(
          { field: 'model_name', message: 'a' },
          { field: 'optimizer.learning_rate', message: 'b' },
          { field: 'loss.alpha', message: 'c' },
          { field: 'data_spec.input_width', message: 'd' },
          { field: 'data_spec.image_task_spec.ignore_index', message: 'e' },
          { field: 'lr_scheduler.warmup_epochs', message: 'f' },
        ),
        req,
      )?.map((i) => i.field) ?? []
    expect(fields).toEqual([
      'model_name',
      `optimizer.${req.optimizer.type}.learning_rate`,
      `loss.${req.loss.type}.alpha`,
      'data_spec.image.input_width',
      `data_spec.image.task_specs.${req.data_spec.image_task_spec.type}.ignore_index`,
      'lr_scheduler.warmup_epochs',
    ])
  })
})
