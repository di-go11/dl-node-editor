import { setupServer } from 'msw/node'

import type { MockOptions } from './handlers'
import { createHandlers } from './handlers'

/**
 * テスト(Node)でモック API を動かす。
 *
 * Node には「今のページ」がなく相対 URL を解決できないので、テストでは
 * TEST_BASE_URL を API クライアントとハンドラの両方に渡す。
 */
export const TEST_BASE_URL = 'http://localhost/api/v1'

export function createMockServer(options: Omit<MockOptions, 'baseUrl'> = {}) {
  return setupServer(...createHandlers({ ...options, baseUrl: TEST_BASE_URL }))
}
