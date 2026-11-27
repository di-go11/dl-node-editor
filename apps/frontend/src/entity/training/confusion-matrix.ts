/**
 * 検証データの混同行列(issue「混同行列の表示」)。
 *
 * 学習エンジンは画素数のまま送る(正規化しない)。行ごとの割合・列ごとの割合・クラスの画素の割合は、
 * ここで画素数から計算する。送る側で片方に決めると、もう片方が出せなくなるためである。
 */

/** 画素数。行 = 正解のクラス、列 = 予測のクラスで、C 行 C 列。ignore_index の画素は含まない */
export type ConfusionMatrix = readonly (readonly number[])[]

/**
 * 受け取った行列を確かめる。正方でない・0 行のときは null(表を描けないので「記録なし」と同じに扱う)。
 * Rust は長さが合わない行列を null にして送るが、クラスが 0 個のときは空の行列が届きうる。
 */
export function confusionMatrixOf(rows: readonly (readonly number[])[]): ConfusionMatrix | null {
  if (rows.length === 0) return null
  return rows.every((row) => row.length === rows.length) ? rows : null
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
/** 合計が 0 のときは null(検証データに現れない・一度も予測されないクラス。0 % と区別する) */
const ratio = (value: number, total: number) => (total === 0 ? null : value / total)

/** 行ごとの割合。正解クラス c の画素のうち、各クラスと予測した割合。対角が再現率 */
export function rowRatios(matrix: ConfusionMatrix): readonly (readonly (number | null)[])[] {
  return matrix.map((row) => {
    const total = sum(row)
    return row.map((value) => ratio(value, total))
  })
}

/** 列ごとの割合。クラス c と予測した画素のうち、正解が各クラスだった割合。対角が適合率 */
export function columnRatios(matrix: ConfusionMatrix): readonly (readonly (number | null)[])[] {
  const columnTotals = matrix.map((_, column) => sum(matrix.map((row) => row[column] ?? 0)))
  return matrix.map((row) => row.map((value, column) => ratio(value, columnTotals[column] ?? 0)))
}

/** クラスごとの画素の割合(正解がそのクラスの画素 ÷ 全体)。全体が 0 ならすべて null */
export function classPixelRatios(matrix: ConfusionMatrix): readonly (number | null)[] {
  const total = sum(matrix.map(sum))
  return matrix.map((row) => ratio(sum(row), total))
}
