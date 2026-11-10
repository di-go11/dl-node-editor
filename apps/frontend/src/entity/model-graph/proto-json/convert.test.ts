// @vitest-environment node
import { describe, expect, it } from 'vitest'

// Vite の ?raw でファイルの中身を文字列として読み込む(src/api/schema.contract.test.ts と同じ手)
import exampleRaw from '../../../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'
import { nodeId } from '../node-id'
import { GRAPH_INPUT, nodeOutput } from '../port'

import { fromProtoJson, toProtoJson } from './convert'
import { modelGraphJsonSchema } from './schema'

/**
 * フェーズ1 の完了条件:
 * 「test_segnet_dag.json の model_graph を読み込んで保存し直すと、同じ内容になる」
 *
 * 往復(round-trip)テストが効く理由:
 *   JSON 表記 → エンティティ型 → JSON 表記 の変換で情報が失われないことを、
 *   1 つの等値比較で確かめられる。片方向だけのテストでは
 *   「読めたが書き戻せない」「書けたが読み直せない」を見逃す。
 */

function parseExampleModelGraph(): unknown {
  const example: unknown = JSON.parse(exampleRaw)
  if (typeof example !== 'object' || example === null || !('model_graph' in example)) {
    throw new Error('test_segnet_dag.json に model_graph がありません')
  }
  return example.model_graph
}

describe('modelGraphJsonSchema', () => {
  it('test_segnet_dag.json の model_graph を受け付ける', () => {
    const result = modelGraphJsonSchema.safeParse(parseExampleModelGraph())
    // 失敗したときに原因が読めるよう、issues を見せてから真偽を判定する
    expect(result.error?.issues ?? []).toEqual([])
    expect(result.success).toBe(true)
  })

  it('知らない層の種類は拒否する', () => {
    const result = modelGraphJsonSchema.safeParse({
      nodes: [{ id: 'x1', spec: { bogus_layer: {} }, inputs: [] }],
      outputs: [],
    })
    expect(result.success).toBe(false)
  })

  it('spec に層が 2 つ入っていたら拒否する(proto の oneof)', () => {
    const result = modelGraphJsonSchema.safeParse({
      nodes: [{ id: 'x1', spec: { conv2d: {}, linear: {} }, inputs: [] }],
      outputs: [],
    })
    expect(result.success).toBe(false)
  })

  it('使えないノード ID は拒否する', () => {
    const result = modelGraphJsonSchema.safeParse({
      nodes: [{ id: 'conv 1', spec: { conv2d: {} }, inputs: [] }],
      outputs: [],
    })
    expect(result.success).toBe(false)
  })

  it('予約 ID は拒否する', () => {
    const result = modelGraphJsonSchema.safeParse({
      nodes: [{ id: '__input__', spec: { conv2d: {} }, inputs: [] }],
      outputs: [],
    })
    expect(result.success).toBe(false)
  })

  it('編集途中のグラフ(ノード 0 個・出力なし)も受け付ける', () => {
    // 契約では nodes >= 1 / outputs == 1 だが、この形式は編集中の状態も保存できる必要がある。
    // 「送れる状態か」の判定は検証層の責務。
    expect(modelGraphJsonSchema.safeParse({ nodes: [], outputs: [] }).success).toBe(true)
  })
})

describe('往復変換', () => {
  it('test_segnet_dag.json の model_graph は往復しても同じ内容になる', () => {
    const original = modelGraphJsonSchema.parse(parseExampleModelGraph())

    const roundTripped = toProtoJson(fromProtoJson(original))

    expect(roundTripped).toEqual(original)
  })

  it('ノードの並び順が保たれる(重みの初期化と checkpoint の対応がこの順で決まる)', () => {
    const original = modelGraphJsonSchema.parse(parseExampleModelGraph())

    const roundTripped = toProtoJson(fromProtoJson(original))

    expect(roundTripped.nodes.map((node) => node.id)).toEqual([
      'conv1',
      'relu1',
      'bn1',
      'pool1',
      'unpool1',
      'out_conv',
    ])
  })

  it('inputs の並び順が保たれる(Concat はつないだ順にチャンネルが並ぶ)', () => {
    const original = modelGraphJsonSchema.parse(parseExampleModelGraph())

    const roundTripped = toProtoJson(fromProtoJson(original))

    // unpool1 は x → indices の順で 2 本つながっている
    const unpool1 = roundTripped.nodes.find((node) => node.id === 'unpool1')
    expect(unpool1?.inputs.map((input) => input.port)).toEqual(['x', 'indices'])
  })

  it('パラメータの数値がそのまま保たれる(1e-5 のような指数表記も含む)', () => {
    const original = modelGraphJsonSchema.parse(parseExampleModelGraph())

    const graph = fromProtoJson(original)

    const bn1 = graph.nodes.find((node) => node.id === 'bn1')
    expect(bn1?.spec).toEqual({
      kind: 'batch_norm',
      params: { num_features: 64, eps: 1e-5, momentum: 0.5 },
    })
  })
})

describe('グラフ入力の表現', () => {
  it('source が {} ならグラフ入力になり、書き戻すと {} に戻る', () => {
    const json = {
      nodes: [
        { id: 'conv1', spec: { conv2d: { in_channels: 3 } }, inputs: [{ port: 'x', source: {} }] },
      ],
      outputs: [{ node_id: 'conv1', port: 'y' }],
    }
    const parsed = modelGraphJsonSchema.parse(json)

    const graph = fromProtoJson(parsed)
    expect(graph.nodes[0]?.inputs[0]?.source).toEqual(GRAPH_INPUT)

    expect(toProtoJson(graph)).toEqual(parsed)
  })

  it('node_id が空文字でもグラフ入力として扱い、書き出しは {} に正規化する', () => {
    // proto では空文字と未設定が区別できないため、同じ意味の表記が複数ある。
    // エンティティ側で 1 つの値にまとめ、書き出しを 1 つの形に決めておく。
    const parsed = modelGraphJsonSchema.parse({
      nodes: [
        {
          id: 'conv1',
          spec: { conv2d: {} },
          inputs: [{ port: 'x', source: { node_id: '', port: '' } }],
        },
      ],
      outputs: [],
    })

    const graph = fromProtoJson(parsed)
    expect(graph.nodes[0]?.inputs[0]?.source).toEqual(GRAPH_INPUT)
    expect(toProtoJson(graph).nodes[0]?.inputs[0]?.source).toEqual({})
  })
})

describe('エンティティ型からの書き出し', () => {
  it('手で組んだグラフを JSON 表記にできる', () => {
    const json = toProtoJson({
      nodes: [
        {
          id: nodeId('conv1'),
          spec: { kind: 'conv2d', params: { in_channels: 3, out_channels: 64 } },
          inputs: [{ port: 'x', source: GRAPH_INPUT }],
        },
      ],
      outputs: [nodeOutput(nodeId('conv1'), 'y')],
    })

    expect(json).toEqual({
      nodes: [
        {
          id: 'conv1',
          spec: { conv2d: { in_channels: 3, out_channels: 64 } },
          inputs: [{ port: 'x', source: {} }],
        },
      ],
      outputs: [{ node_id: 'conv1', port: 'y' }],
    })
  })
})
