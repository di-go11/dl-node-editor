/**
 * ノード ID。
 *
 * proto(model_graph.proto)の制約:
 *   - 空でない
 *   - グラフの中で重複しない(重複はグラフ単位でしか判定できないので検証層で扱う)
 *   - 使える文字は英数字・'-'・'_' だけ
 *
 * ID を素の string ではなく NodeId という別の型にしている(branded type)。
 * これは「検証を通った文字列だけが NodeId になれる」という性質を型で表すためである。
 * 素の string のままだと、ポート名やラベルのような別の文字列を取り違えても
 * コンパイラは何も言わない。検証した値と検証していない値を型で区別するのが
 * "parse, don't validate" の考え方である。
 */

// unique symbol をキーに使うと、この型は構造的に同じ形を作れない(モジュール外から
// このシンボルを参照できない)。そのため string を NodeId として扱うには、
// 必ずこのモジュールの関数を通る必要がある。
declare const nodeIdBrand: unique symbol

export type NodeId = string & { readonly [nodeIdBrand]: 'NodeId' }

/** proto が許す文字の集合 */
export const NODE_ID_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * エディタ専用の予約 ID(指示書 7.4)。
 * Input / Output はエディタの中だけに存在するノードで、proto のノードにはならない。
 * ユーザーが作るノードがこの ID を取ると、保存ファイルの positions と衝突する。
 */
export const RESERVED_NODE_IDS = ['__input__', '__output__'] as const

export type ReservedNodeId = (typeof RESERVED_NODE_IDS)[number]

export function isValidNodeIdFormat(value: string): boolean {
  return NODE_ID_PATTERN.test(value)
}

export function isReservedNodeId(value: string): boolean {
  return (RESERVED_NODE_IDS as readonly string[]).includes(value)
}

/**
 * 外部から来た文字列を NodeId にする。使えない値なら null を返す。
 * ファイルの読み込みや API の応答のように、不正な値がありうる経路で使う。
 */
export function parseNodeId(value: string): NodeId | null {
  if (!isValidNodeIdFormat(value)) return null
  if (isReservedNodeId(value)) return null
  return value as NodeId
}

/**
 * コード内のリテラルやテストで使う。不正な値はプログラムの誤りなので例外にする。
 *
 * 外部入力に対してこれを使ってはならない(例外で画面が落ちる)。
 * 外部入力には parseNodeId を使い、null を Issue に変換する。
 */
export function nodeId(value: string): NodeId {
  const parsed = parseNodeId(value)
  if (parsed === null) {
    throw new Error(`使えないノード ID です: ${JSON.stringify(value)}`)
  }
  return parsed
}

/**
 * `<prefix>_1`, `<prefix>_2` ... のうち、まだ使われていない最小の番号の ID を返す。
 * 指示書 7.4 の「conv2d_1 のように自動で振る」に対応する。
 *
 * 既存 ID の集合を引数で受け取る純粋関数にしてあるので、グラフの実体を知らなくても
 * テストできる(採番の規則だけを検査できる)。
 */
export function nextNodeId(prefix: string, existing: Iterable<string>): NodeId {
  if (!isValidNodeIdFormat(prefix)) {
    throw new Error(`使えない ID の接頭辞です: ${JSON.stringify(prefix)}`)
  }
  const used = new Set(existing)
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix}_${n}`
    if (!used.has(candidate)) return nodeId(candidate)
  }
}
