// ESLint flat config(ESLint 9 以降の設定形式)。
// 設定を「配列」として組み立て、後の要素が前の要素を上書きする。従来の .eslintrc の
// extends による暗黙の継承より、どの規則がどこで有効になるかが追いやすい。
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettierConfig from 'eslint-config-prettier/flat'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  // 生成物や成果物は検査しない
  globalIgnores(['dist', 'coverage', 'src/api/schema.d.ts', 'public/mockServiceWorker.js']),

  // ---- TypeScript / React のソース ----
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      // recommendedTypeChecked: 型情報を使う規則を含む集合。
      // 構文だけでは分からない問題(Promise の放置、誤った await など)を検出できる。
      tseslint.configs.recommendedTypeChecked,
      // v7 では flat config が configs.flat 配下にある
      // (configs['recommended-latest'] は旧 .eslintrc 形式なので flat config では使えない)。
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        // projectService: tsconfig を自動で解決し、型情報付きで解析する。
        // 対象ファイルごとに正しい tsconfig(app / node)が選ばれる。
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Promise を捨てている箇所をエラーにする。API 呼び出しや SSE の購読で
      // await / catch を書き忘れると、失敗が誰にも観測されないまま進んでしまうため。
      '@typescript-eslint/no-floating-promises': 'error',
      // Promise を返す関数を、void を期待する場所(onClick など)に直接渡すのを禁じる。
      '@typescript-eslint/no-misused-promises': 'error',
      // 明示的な any を禁じる。外部入力は Zod で検証し unknown から絞り込む方針のため。
      '@typescript-eslint/no-explicit-any': 'error',
      // 未使用の変数は原則エラー。先頭に _ を付けたものだけ意図的な無視として許す。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // 型のみの import は `import type` と書かせる。実行時に残る import と区別され、
      // バンドルに不要なモジュールが含まれるのを防ぐ(tsconfig の verbatimModuleSyntax と対応)。
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // ---- 設定ファイル類(素の JS。tsconfig に含まれないため型情報を使う検査はしない) ----
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  // ---- テストファイル ----
  {
    files: ['**/*.test.{ts,tsx}', 'vitest.setup.ts'],
    rules: {
      // テストでは意図的に不正な値を渡して失敗を確かめることがあるため緩める
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  // Prettier と衝突する整形関連の規則を無効化する。
  // 必ず配列の最後に置く(後の要素が前を上書きするため)。
  // 整形は Prettier、規則違反の検出は ESLint、と責務を分けるためである。
  prettierConfig,
])
