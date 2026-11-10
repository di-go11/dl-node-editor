import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import './presentation/styles/theme.css'

import { createStaticNodeCatalogSource } from './infrastructure/catalog/static-node-catalog-source'
import { createBrowserDocumentStorage } from './infrastructure/file/browser-document-storage'
import { createApiClient } from './infrastructure/http/api-client'
import { createHttpCapabilitiesApi } from './infrastructure/http/http-capabilities-api'
import { createHttpTrainedModelApi } from './infrastructure/http/http-trained-model-api'
import { createHttpTrainingApi } from './infrastructure/http/http-training-api'
import { AppRoutes } from './presentation/app/AppRoutes'
import type { Dependencies } from './presentation/app/dependencies'
import { DependenciesContext } from './presentation/app/dependencies'

/**
 * コンポジションルート - アプリ全体の「組み立て」を行う唯一の場所(指示書 5.1)。
 *
 * どのポートにどの実装を使うかは、ここだけが知っている。画面のコードは
 * ポート(インターフェース)にだけ依存し、Context から実装を受け取る。
 * 実装を差し替えたいとき(カタログを API から取る、など)は、ここを 1 行変えればよい。
 *
 * モックと本物の切り替え(指示書 6.3):
 *   VITE_USE_MOCK=true なら、描画の前に MSW の Service Worker を起動する。
 *   アプリのコードは同じ HTTP 実装のままで、通信の手前で MSW が応答を差し込む。
 *   本物の API につなぐときは .env の VITE_USE_MOCK を false にするだけでよい。
 */
async function bootstrap(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    // 動的 import にしているので、VITE_USE_MOCK=false のビルドには MSW が含まれない
    const { startMockWorker } = await import('./infrastructure/mock/browser')
    await startMockWorker()
  }

  const apiClient = createApiClient()
  const dependencies: Dependencies = {
    nodeCatalogSource: createStaticNodeCatalogSource(),
    capabilitiesApi: createHttpCapabilitiesApi(apiClient),
    documentStorage: createBrowserDocumentStorage(),
    trainingApi: createHttpTrainingApi(apiClient),
    trainedModelApi: createHttpTrainedModelApi(apiClient),
  }

  const root = document.getElementById('root')
  if (root === null) throw new Error('index.html に #root がありません')

  createRoot(root).render(
    <StrictMode>
      <DependenciesContext value={dependencies}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </DependenciesContext>
    </StrictMode>,
  )
}

// 起動そのものの失敗(MSW の Service Worker を登録できない など)は React の外で起きるので、
// 画面に直接書き出す。握りつぶすと、真っ白な画面だけが残って原因が分からない
bootstrap().catch((error: unknown) => {
  console.error(error)
  const message = error instanceof Error ? error.message : String(error)
  document.body.textContent = `アプリを起動できませんでした: ${message}`
})
