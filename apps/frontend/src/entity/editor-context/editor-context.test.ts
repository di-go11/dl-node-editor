// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  ALL_EDITOR_CONTEXTS,
  DATA_DIMS,
  DATA_DIM_OPTIONS,
  DEFAULT_EDITOR_CONTEXT,
  FEATURE_METHODS,
  FEATURE_METHOD_OPTIONS,
  editorContextEquals,
  formatEditorContext,
  unavailableNotesOf,
} from './editor-context'

describe('選択肢の定義', () => {
  it('すべてのデータ形式に選択肢の定義がある', () => {
    // 列挙値を増やしたのに選択肢を書き忘れると、ヘッダに出ないまま検証だけが通る
    expect(DATA_DIM_OPTIONS.map((option) => option.value).sort()).toEqual([...DATA_DIMS].sort())
  })

  it('すべての特徴抽出手法に選択肢の定義がある', () => {
    expect(FEATURE_METHOD_OPTIONS.map((option) => option.value).sort()).toEqual(
      [...FEATURE_METHODS].sort(),
    )
  })

  it('未実装の選択肢には注意書きがある', () => {
    for (const option of [...DATA_DIM_OPTIONS, ...FEATURE_METHOD_OPTIONS]) {
      if (!option.available) expect(option.note).toBeDefined()
    }
  })

  it('既定の条件は実装済みの組み合わせである', () => {
    expect(DEFAULT_EDITOR_CONTEXT).toEqual({ dataDim: '2d', method: 'cnn' })
    expect(unavailableNotesOf(DEFAULT_EDITOR_CONTEXT)).toEqual([])
  })
})

describe('ALL_EDITOR_CONTEXTS', () => {
  it('列挙値のすべての組み合わせを持つ', () => {
    expect(ALL_EDITOR_CONTEXTS).toHaveLength(DATA_DIMS.length * FEATURE_METHODS.length)
  })

  it('重複がない', () => {
    const keys = ALL_EDITOR_CONTEXTS.map((c) => `${c.dataDim}/${c.method}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('editorContextEquals', () => {
  it('両方の項目が一致したときだけ true', () => {
    expect(
      editorContextEquals({ dataDim: '2d', method: 'cnn' }, { dataDim: '2d', method: 'cnn' }),
    ).toBe(true)
    expect(
      editorContextEquals({ dataDim: '2d', method: 'cnn' }, { dataDim: '1d', method: 'cnn' }),
    ).toBe(false)
    expect(
      editorContextEquals(
        { dataDim: '2d', method: 'cnn' },
        { dataDim: '2d', method: 'transformer' },
      ),
    ).toBe(false)
  })
})

describe('formatEditorContext', () => {
  it('表示用のラベルで組み立てる', () => {
    expect(formatEditorContext({ dataDim: '2d', method: 'cnn' })).toBe('2D / CNN')
  })
})

describe('unavailableNotesOf', () => {
  it('未実装の選択の注意書きを返す', () => {
    expect(unavailableNotesOf({ dataDim: '1d', method: 'cnn' })).toEqual([
      '1D 用のノードは近日実装予定です',
    ])
  })

  it('両方が未実装なら 2 件返す', () => {
    expect(unavailableNotesOf({ dataDim: '1d', method: 'transformer' })).toHaveLength(2)
  })
})
