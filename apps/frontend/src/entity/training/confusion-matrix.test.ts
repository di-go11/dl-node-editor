// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { classPixelRatios, columnRatios, confusionMatrixOf, rowRatios } from './confusion-matrix'

// 行 = 正解、列 = 予測。クラス 2 は検証データに現れず(行の合計 0)、一度も予測されない(列の合計 0)
const matrix = [
  [80, 20, 0],
  [10, 90, 0],
  [0, 0, 0],
]

describe('confusionMatrixOf', () => {
  it('正方の行列はそのまま、正方でない・0 行は null', () => {
    expect(confusionMatrixOf(matrix)).toBe(matrix)
    expect(confusionMatrixOf([[1, 2]])).toBeNull()
    expect(confusionMatrixOf([[1], [2, 3]])).toBeNull()
    expect(confusionMatrixOf([])).toBeNull()
  })
})

describe('rowRatios', () => {
  it('正解クラスごとの割合。対角は再現率。合計 0 の行は null', () => {
    expect(rowRatios(matrix)).toEqual([
      [0.8, 0.2, 0],
      [0.1, 0.9, 0],
      [null, null, null],
    ])
  })
})

describe('columnRatios', () => {
  it('予測クラスごとの割合。対角は適合率。合計 0 の列は null', () => {
    const ratios = columnRatios(matrix)
    expect(ratios[0]?.[0]).toBeCloseTo(80 / 90)
    expect(ratios[1]?.[0]).toBeCloseTo(10 / 90)
    expect(ratios[0]?.[1]).toBeCloseTo(20 / 110)
    expect(ratios.map((row) => row[2])).toEqual([null, null, null])
  })
})

describe('classPixelRatios', () => {
  it('正解がそのクラスの画素の、全体に占める割合', () => {
    expect(classPixelRatios(matrix)).toEqual([0.5, 0.5, 0])
  })

  it('画素が 1 つもなければすべて null', () => {
    expect(
      classPixelRatios([
        [0, 0],
        [0, 0],
      ]),
    ).toEqual([null, null])
  })
})
