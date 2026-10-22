// Vitest の実行前に 1 度だけ読み込まれる初期化ファイル(vite.config.ts の test.setupFiles で指定)。
// @testing-library/jest-dom は toBeInTheDocument などの DOM 向け matcher を expect に登録する。
// テストごとに import する必要がないよう、ここでまとめて有効にしている。
import '@testing-library/jest-dom/vitest'
