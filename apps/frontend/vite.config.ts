import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
// Vitest の設定を書くため、'vite' ではなく 'vitest/config' の defineConfig を使う
// (test プロパティの型が付く)。
import { defineConfig } from 'vitest/config'

const projectRoot = import.meta.dirname

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // コンテナ内の開発サーバーを、ホストのブラウザから開くため。
    // 既定の localhost 束縛だと、コンテナ外からは到達できない。
    host: '0.0.0.0',
    port: 5173,
    // ポートが使用中なら黙って別ポートに移らず失敗させる。
    // compose の 5173:5173 の対応が崩れて「開けない」原因になるのを防ぐ。
    strictPort: true,
    // ファイルの変更をポーリング(定期的に確かめる方式)で検知する。
    // Windows のフォルダを Docker のコンテナにマウントすると、Windows 側での変更の通知
    // (Linux の inotify)がコンテナの中に届かない。既定の通知方式のままだと、Vite が
    // 変更に気づかず、起動した時点の古いモジュールを配信し続ける(実際に起きた)。
    watch: {
      usePolling: true,
      interval: 300,
    },
    fs: {
      // Vite は既定で、プロジェクトルートの外にあるファイルの読み込みを拒否する
      // (ソース公開の事故を防ぐための安全機構。違反すると "Denied ID" になる)。
      // 契約の正本とその実例はバックエンド側にあるため、その 2 か所だけを許可する。
      // ルート全体(..)を開けないのは、許可範囲を必要最小限に保つためである。
      allow: [
        projectRoot,
        resolve(projectRoot, '../backend/openapi'),
        resolve(projectRoot, '../backend/ai-engine/modelconfigs'),
      ],
    },
    // Rust の HTTP API ができたら有効にする(指示書 9 章の注記)。
    // ブラウザから見て同一オリジンになるため CORS の設定が不要になり、
    // 転送先は compose のサービス名で名前解決できる。
    // proxy: {
    //   '/api': {
    //     target: 'http://api-dev:8080',
    //     changeOrigin: true,
    //   },
    // },
  },
  test: {
    // DOM を使うテスト(React Testing Library)のため、既定の環境を jsdom にする。
    // entity / application の純粋な単体テストは DOM を使わないので、
    // ファイル先頭に `// @vitest-environment node` と書けば node 環境で走らせられる。
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // describe / it / expect を自動でグローバルにはしない。
    // 各テストで明示的に import させ、どこから来た関数かをコード上で分かるようにする。
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
