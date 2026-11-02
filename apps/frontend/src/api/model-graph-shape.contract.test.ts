// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { NODE_KINDS } from '../entity/model-graph/node-spec'
import type { NodeKind } from '../entity/model-graph/node-spec'
import { rustModelGraphSchema } from '../infrastructure/http/rust-training-request'
import type {
  RustModelGraph,
  RustNode,
  RustNodeInput,
  RustPortRef,
} from '../infrastructure/http/rust-training-request'

import type { components } from './schema'

/**
 * HTTP 用に手で書いたスキーマ(rust-training-request.ts)と、OpenAPI から生成した型が
 * 同じ形であることを検査する。層の種類はエンティティ層の NODE_KINDS とも比べる。
 *
 * なぜこのテストが必要か:
 *   エンティティ層は生成型を参照しない(dependency-cruiser のルールで禁じている)。
 *   HTTP 境界の都合を内側の層に持ち込まないためである。しかしそれは同時に、
 *   両者が静かにずれる余地を作る。契約に層を 1 つ足したのにカタログと NODE_KINDS を
 *   更新し忘れれば、画面では組めるのに学習開始で失敗する。
 *
 *   そこで「参照しないが、一致は検査する」ための接ぎ目をここに置く。
 *   このファイルが src/api にあるのは、既存の schema.contract.test.ts と同じ
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

describe('HTTP 用のスキーマと OpenAPI 生成型の一致', () => {
  it('NODE_KINDS は、契約の NodeSpec が持つ層の種類と完全に一致する', () => {
    // 契約に層を足すとここが型エラーになる。NODE_KINDS の更新漏れを防ぐ要になる検査。
    const matches: Equal<NodeKind, WireNodeSpec['type']> = true
    expect(matches).toBe(true)
    expect(NODE_KINDS).toHaveLength(10)
  })

  it('ModelGraph のキーが一致する', () => {
    const matches: Equal<keyof RustModelGraph, keyof WireModelGraph> = true
    expect(matches).toBe(true)
  })

  it('Node のキーが一致する', () => {
    const matches: Equal<keyof RustNode, keyof WireNode> = true
    expect(matches).toBe(true)
  })

  it('NodeInput のキーが一致する', () => {
    const matches: Equal<keyof RustNodeInput, keyof WireNodeInput> = true
    expect(matches).toBe(true)
  })

  it('PortRef のキーが一致する', () => {
    const matches: Equal<keyof RustPortRef, keyof WirePortRef> = true
    expect(matches).toBe(true)
  })
})

describe('契約の型の値を、HTTP 用のスキーマが受け付ける', () => {
  it('生成型として組み立てた値が safeParse を通る', () => {
    // 型注釈を生成型にしてあるので、契約に合わない値はこの時点でコンパイルエラーになる。
    // そのうえで実行時にもスキーマを通し、両者が実際に噛み合うことを確かめる。
    const wire: WireModelGraph = {
      nodes: [
        {
          id: 'conv1',
          spec: {
            type: 'conv2d',
            in_channels: 3,
            out_channels: 64,
            kernel_size: 3,
            stride: 1,
            padding: 1,
            dilation: 1,
          },
          inputs: [{ port: 'x', source: null }],
        },
      ],
      outputs: [{ node_id: 'conv1', port: 'y' }],
    }

    const result = rustModelGraphSchema.safeParse(wire)

    expect(result.error?.issues ?? []).toEqual([])
    expect(result.success).toBe(true)
  })
})
