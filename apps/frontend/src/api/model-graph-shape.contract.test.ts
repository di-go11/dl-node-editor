// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { NODE_KINDS } from '../entity/model-graph/node-spec'
import type { NodeKind } from '../entity/model-graph/node-spec'
import { modelGraphJsonSchema } from '../entity/model-graph/proto-json/schema'
import type {
  ModelGraphJson,
  NodeInputJson,
  NodeJson,
  PortRefJson,
} from '../entity/model-graph/proto-json/schema'

import type { components } from './schema'

/**
 * エンティティ層が手で書いた JSON 表記のスキーマと、OpenAPI から生成した型が
 * 同じ形であることを検査する。
 *
 * なぜこのテストが必要か:
 *   エンティティ層は生成型を参照しない(dependency-cruiser のルールで禁じている)。
 *   HTTP 境界の都合を内側の層に持ち込まないためである。しかしそれは同時に、
 *   両者が静かにずれる余地を作る。契約に層を 1 つ足したのにカタログと NODE_KINDS を
 *   更新し忘れれば、画面では組めるのに学習開始で失敗する。
 *
 *   そこで「参照しないが、一致は検査する」ための接ぎ目をここに置く。
 *   このファイルが src/api にあるのは、生成型を参照できるのが src/api と
 *   src/infrastructure だけであり、かつ既存の schema.contract.test.ts と同じ
 *   「生成型を現実に固定するテスト」の仲間だからである。
 */

/**
 * 2 つの型が厳密に等しいかを判定する型。
 *
 * 単純な `A extends B` では、どちらかが他方の部分型でも真になってしまう
 * (キーが足りないのを見逃す)。関数の引数位置に置いて双方向に比べることで、
 * 完全に同じ型のときだけ true になる。
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type WireModelGraph = components['schemas']['ModelGraph']
type WireNode = components['schemas']['Node']
type WireNodeInput = components['schemas']['NodeInput']
type WireNodeSpec = components['schemas']['NodeSpec']
type WirePortRef = components['schemas']['PortRef']

describe('JSON 表記のスキーマと OpenAPI 生成型の一致', () => {
  it('NODE_KINDS は、契約の NodeSpec が持つ層の種類と完全に一致する', () => {
    // 契約に層を足すとここが型エラーになる。NODE_KINDS の更新漏れを防ぐ要になる検査。
    const matches: Equal<NodeKind, keyof WireNodeSpec> = true
    expect(matches).toBe(true)
    expect(NODE_KINDS).toHaveLength(10)
  })

  it('ModelGraph のキーが一致する', () => {
    const matches: Equal<keyof ModelGraphJson, keyof WireModelGraph> = true
    expect(matches).toBe(true)
  })

  it('Node のキーが一致する', () => {
    const matches: Equal<keyof NodeJson, keyof WireNode> = true
    expect(matches).toBe(true)
  })

  it('NodeInput のキーが一致する', () => {
    const matches: Equal<keyof NodeInputJson, keyof WireNodeInput> = true
    expect(matches).toBe(true)
  })

  it('PortRef のキーが一致する', () => {
    const matches: Equal<keyof PortRefJson, keyof WirePortRef> = true
    expect(matches).toBe(true)
  })
})

describe('契約の型の値を、エンティティ層のスキーマが受け付ける', () => {
  it('生成型として組み立てた値が safeParse を通る', () => {
    // 型注釈を生成型にしてあるので、契約に合わない値はこの時点でコンパイルエラーになる。
    // そのうえで実行時にもエンティティ層のスキーマを通し、両者が実際に噛み合うことを確かめる。
    const wire: WireModelGraph = {
      nodes: [
        {
          id: 'conv1',
          spec: {
            conv2d: {
              in_channels: 3,
              out_channels: 64,
              kernel_size: 3,
              stride: 1,
              padding: 1,
              dilation: 1,
            },
          },
          inputs: [{ port: 'x', source: {} }],
        },
      ],
      outputs: [{ node_id: 'conv1', port: 'y' }],
    }

    const result = modelGraphJsonSchema.safeParse(wire)

    expect(result.error?.issues ?? []).toEqual([])
    expect(result.success).toBe(true)
  })
})
