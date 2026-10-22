// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  activationType,
  concatType,
  conv2dType,
  pooling2dType,
  upsampleType,
} from '../entity/node-catalog/entries'
// 下の 5 つは typeof でキーを取り出すためだけに使う(値としては参照しない)。
// import type にしておくと、バンドルに不要な実行時 import が残らない。
import type {
  addType,
  batchNormType,
  indexedPoolingType,
  linearType,
  unpoolingType,
} from '../entity/node-catalog/entries'
import { paramsSchemaOf } from '../entity/node-catalog/param-def'

import type { components } from './schema'

/**
 * ノードカタログのパラメータ名が、契約(openapi.yaml)の各 *Spec と
 * **完全に一致している**ことをコンパイル時に検査する。
 *
 * なぜ必要か:
 *   カタログのパラメータ名は、そのまま API に送る JSON のキーになる。
 *   `kernel_size` を `kernelSize` と書き間違えても、フロントだけなら動いてしまう
 *   (プロパティパネルはカタログの定義から入力欄を作るため、画面上は正常に見える)。
 *   失敗するのは学習開始の瞬間で、原因が最も分かりにくい。
 *
 *   エンティティ層は生成型を参照しない(dependency-cruiser のルール)。
 *   そこで「参照しないが一致は検査する」接ぎ目をここに置く。
 *
 * 検査の仕組み:
 *   カタログのエントリを `satisfies NodeTypeDef` で宣言しているため、
 *   params のキーがリテラル型として残る。これを生成型のキーと双方向に比べる。
 *   名前を 1 つ間違えるか、契約にパラメータが増えると、ここが型エラーになる。
 */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type Schemas = components['schemas']

describe('カタログのパラメータ名と契約の *Spec の一致', () => {
  it('Conv2D', () => {
    const matches: Equal<keyof typeof conv2dType.params, keyof Schemas['Conv2DSpec']> = true
    expect(matches).toBe(true)
  })

  it('Pooling2D', () => {
    const matches: Equal<keyof typeof pooling2dType.params, keyof Schemas['Pooling2DSpec']> = true
    expect(matches).toBe(true)
  })

  it('BatchNorm', () => {
    const matches: Equal<keyof typeof batchNormType.params, keyof Schemas['BatchNormSpec']> = true
    expect(matches).toBe(true)
  })

  it('Linear', () => {
    const matches: Equal<keyof typeof linearType.params, keyof Schemas['LinearSpec']> = true
    expect(matches).toBe(true)
  })

  it('Activation', () => {
    const matches: Equal<keyof typeof activationType.params, keyof Schemas['ActivationSpec']> = true
    expect(matches).toBe(true)
  })

  it('IndexedPooling', () => {
    const matches: Equal<
      keyof typeof indexedPoolingType.params,
      keyof Schemas['IndexedPoolingSpec']
    > = true
    expect(matches).toBe(true)
  })

  it('Unpooling', () => {
    const matches: Equal<keyof typeof unpoolingType.params, keyof Schemas['UnpoolingSpec']> = true
    expect(matches).toBe(true)
  })

  it('Upsample', () => {
    const matches: Equal<keyof typeof upsampleType.params, keyof Schemas['UpsampleSpec']> = true
    expect(matches).toBe(true)
  })

  it('Add', () => {
    const matches: Equal<keyof typeof addType.params, keyof Schemas['AddSpec']> = true
    expect(matches).toBe(true)
  })

  it('Concat(パラメータなし)', () => {
    // 契約側は Record<string, never>(キーなしのオブジェクト)として生成されるため、
    // keyof が string になり型の等値比較ができない。
    // 代わりに「パラメータが 1 つもない」ことと「空オブジェクトが契約に適合する」ことを確かめる。
    const empty: Schemas['ConcatSpec'] = {}
    expect(Object.keys(concatType.params)).toEqual([])
    expect(paramsSchemaOf(concatType.params).safeParse(empty).success).toBe(true)
  })
})

describe('カタログの既定値が契約の型として成り立つ', () => {
  it('Conv2D の既定値を契約の型の値として組み立てられる', () => {
    // 型注釈が契約側なので、名前や型が違えばコンパイルエラーになる。
    // 上のキーの一致検査と合わせて、名前と値の型の両方を固定している。
    const spec: Schemas['Conv2DSpec'] = {
      in_channels: conv2dType.params.in_channels.default,
      out_channels: conv2dType.params.out_channels.default,
      kernel_size: conv2dType.params.kernel_size.default,
      stride: conv2dType.params.stride.default,
      padding: conv2dType.params.padding.default,
      dilation: conv2dType.params.dilation.default,
    }
    expect(spec.in_channels).toBe(3)
  })

  it('Activation の enum の既定値が契約の enum に含まれる', () => {
    const activation: Schemas['ActivationType'] = 'ACTIVATION_TYPE_RELU'
    expect(activationType.params.activation_type.default).toBe(activation)
    expect(activationType.params.activation_type.options.map((option) => option.value)).toContain(
      activation,
    )
  })

  it('Pooling2D の enum の選択肢が契約の enum の値だけからなる', () => {
    const allowed: readonly Schemas['PoolingType'][] = [
      'POOLING_TYPE_UNSPECIFIED',
      'POOLING_TYPE_MAX',
      'POOLING_TYPE_AVERAGE',
    ]
    for (const option of pooling2dType.params.pooling_type.options) {
      expect(allowed).toContain(option.value)
    }
  })

  it('Upsample の enum の選択肢が契約の enum の値だけからなる', () => {
    const allowed: readonly Schemas['UpsampleMode'][] = [
      'UPSAMPLE_MODE_UNSPECIFIED',
      'UPSAMPLE_MODE_NEAREST',
      'UPSAMPLE_MODE_BILINEAR',
    ]
    for (const option of upsampleType.params.upsample_mode.options) {
      expect(allowed).toContain(option.value)
    }
  })
})
