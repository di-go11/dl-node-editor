import { setupWorker } from 'msw/browser'

import { createHandlers } from './handlers'

/**
 * ブラウザでモック API を動かす(開発時、VITE_USE_MOCK=true のとき)。
 *
 * main.tsx から動的 import(`await import(...)`)で読み込む。
 * VITE_USE_MOCK が false のビルドでは、この import を含む分岐ごと取り除かれ、
 * MSW が本番のバンドルに入らない。
 */
export async function startMockWorker(): Promise<void> {
  const worker = setupWorker(...createHandlers())
  await worker.start({
    // ハンドラのないリクエスト(Vite が配る JS や CSS など)は、そのまま本物に流す
    onUnhandledFrame: 'bypass',
  })
}
