import type { EditorConnection } from '../../entity/graph-editing/endpoint'

/**
 * React Flow の Edge に付ける ID。
 *
 * ## 求められる性質
 *
 * 1. **一意であること。** Add に同じ出力を 2 本つなぐ(x + x)と、2 本は端点がまったく同じになる。
 *    そこで「同じ端点の組の何本目か」(occurrence)を付けて区別する。
 * 2. **関係のない編集で変わらないこと。** ModelGraph の中の位置(ConnectionRef の index)を
 *    ID にすると、別の線を消しただけで後ろの線の ID がずれ、選択状態が別の線に移ってしまう。
 *    端点の組を使えば、その線自身が変わらない限り ID は変わらない。
 *
 * ID を分解して接続を取り出すことはしない(Edge の data に ConnectionRef を持たせる)。
 * 文字列の書式に依存するコードを増やさないためである。
 */
export function edgeIdOf(connection: EditorConnection, occurrence: number): string {
  const { source, target } = connection
  // ノード ID とポート名は英数字と - _ だけなので、. -> # は区切りとして衝突しない
  return `${source.node}.${source.port}->${target.node}.${target.port}#${occurrence}`
}

/** 接続の並びに、同じ端点の組の何本目かを数えて ID を振る */
export function edgeIdsOf(connections: readonly EditorConnection[]): readonly string[] {
  const seen = new Map<string, number>()
  return connections.map((connection) => {
    const key = edgeIdOf(connection, 0)
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    return edgeIdOf(connection, occurrence)
  })
}
