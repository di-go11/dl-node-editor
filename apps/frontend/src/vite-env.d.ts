/// <reference types="vite/client" />

/**
 * Vite が公開する環境変数の型。
 *
 * vite/client が用意する既定の ImportMetaEnv は任意のキーを any として許すため、
 * 綴りを間違えても型エラーにならず、値も any になってしまう(ESLint の
 * no-unsafe-member-access に触れる)。そこで使う変数をここで宣言し、
 * 「どの環境変数が存在するか」をコード上の契約にする。
 *
 * TypeScript の interface は同名で宣言すると統合される(declaration merging)。
 * この性質を使って、ライブラリ側の型に自分の定義を足している。
 */
interface ImportMetaEnv {
  /**
   * 'true' のとき、API を MSW のモックに差し替える(.env.development)。
   * 環境変数は常に文字列で渡るため boolean ではなく string として受け取り、
   * 比較はコンポジションルートで 1 か所だけ行う。
   */
  readonly VITE_USE_MOCK: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
