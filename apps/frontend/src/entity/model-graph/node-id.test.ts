// @vitest-environment node
// このテストは DOM を使わない。エンティティ層が UI から独立していることを、
// 環境指定の形でも示している(指示書 5.1「Node 上だけで単体テストできる」)。
import { describe, expect, it } from 'vitest'

import {
  RESERVED_NODE_IDS,
  isReservedNodeId,
  isValidNodeIdFormat,
  nextNodeId,
  nodeId,
  parseNodeId,
} from './node-id'

describe('isValidNodeIdFormat', () => {
  it.each(['conv1', 'conv2d_1', 'enc-2', 'A0', '__input__'])('%s は形式を満たす', (value) => {
    expect(isValidNodeIdFormat(value)).toBe(true)
  })

  it.each([
    ['', '空文字は proto が禁じている'],
    ['conv 1', '空白は使えない'],
    ['conv.1', 'ドットは使えない'],
    ['層1', '英数字以外は使えない'],
    ['conv/1', 'スラッシュは使えない'],
  ])('%s は形式を満たさない (%s)', (value) => {
    expect(isValidNodeIdFormat(value)).toBe(false)
  })
})

describe('予約 ID', () => {
  it.each(RESERVED_NODE_IDS)('%s は予約されている', (value) => {
    expect(isReservedNodeId(value)).toBe(true)
  })

  it('予約 ID は形式としては正しいが、ノード ID には使えない', () => {
    // __input__ は英数字と _ だけなので形式は満たす。
    // それでも使わせないのは、保存ファイルの positions のキーと衝突するためである。
    expect(isValidNodeIdFormat('__input__')).toBe(true)
    expect(parseNodeId('__input__')).toBeNull()
  })
})

describe('parseNodeId(外部入力用)', () => {
  it('使える値はそのまま返す', () => {
    expect(parseNodeId('conv1')).toBe('conv1')
  })

  it('使えない値は null を返し、例外を投げない', () => {
    expect(parseNodeId('conv 1')).toBeNull()
    expect(parseNodeId('')).toBeNull()
  })
})

describe('nodeId(コード内のリテラル用)', () => {
  it('使えない値は例外にする', () => {
    // 外部入力ではなくプログラムの誤りなので、黙って続けるより落とすほうがよい
    expect(() => nodeId('conv 1')).toThrow()
  })
})

describe('nextNodeId', () => {
  it('未使用の最小の番号を振る', () => {
    expect(nextNodeId('conv2d', [])).toBe('conv2d_1')
    expect(nextNodeId('conv2d', ['conv2d_1'])).toBe('conv2d_2')
  })

  it('途中が空いていればそこを埋める', () => {
    expect(nextNodeId('conv2d', ['conv2d_1', 'conv2d_3'])).toBe('conv2d_2')
  })

  it('他の接頭辞の ID は番号に影響しない', () => {
    expect(nextNodeId('conv2d', ['relu_1', 'relu_2'])).toBe('conv2d_1')
  })

  it('使えない接頭辞は例外にする', () => {
    expect(() => nextNodeId('conv 2d', [])).toThrow()
  })
})
