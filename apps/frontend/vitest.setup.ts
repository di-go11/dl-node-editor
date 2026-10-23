// Vitest の実行前に 1 度だけ読み込まれる初期化ファイル(vite.config.ts の test.setupFiles で指定)。
// @testing-library/jest-dom は toBeInTheDocument などの DOM 向け matcher を expect に登録する。
// テストごとに import する必要がないよう、ここでまとめて有効にしている。
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 各テストのあとに、描画したコンポーネントを外す。
// React Testing Library は afterEach がグローバルにあるときだけ自動で片付ける。
// このプロジェクトは globals: false(vite.config.ts)なので、自分で登録しないと
// 前のテストの描画が document に残り、「同じ要素が複数ある」などの誤った失敗になる。
afterEach(() => {
  cleanup()
})

/*
 * React Flow が使うブラウザの API のうち、jsdom にないものの代用品。
 *
 * jsdom はレイアウト(大きさの計算)を行わない DOM の実装なので、ResizeObserver や
 * DOMMatrixReadOnly を持たない。React Flow はノードの大きさを測るためにこれらを使うので、
 * ないと描画の途中で例外になる。React Flow の公式のテストの手引きにならい、
 * 「何もしない」最小限の代用品を置く(実際の大きさや位置は検査しない前提)。
 *
 * このファイルは `@vitest-environment node` のテストでも読まれるので、
 * window があるとき(jsdom のとき)だけ設定する。
 */
if (typeof window !== 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub

  class DOMMatrixReadOnlyStub {
    m22: number
    constructor(transform?: string) {
      // React Flow は transform の scale(ズーム率)だけを読む
      const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')?.[1]
      this.m22 = scale === undefined ? 1 : Number(scale)
    }
  }
  // @ts-expect-error 必要な部分だけを持つ代用品なので、型は完全には一致しない
  globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub
}
