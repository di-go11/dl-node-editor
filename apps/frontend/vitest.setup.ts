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
