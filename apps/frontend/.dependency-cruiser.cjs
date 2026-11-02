/**
 * dependency-cruiser の設定。
 *
 * 目的: 指示書 5.1 の「依存は外側から内側への一方向だけ」という原則を、
 * 人間の注意力ではなく機械に守らせる。クリーンアーキテクチャの層構造は
 * ディレクトリを分けるだけでは強制されないため、ここでルール化する。
 *
 *   presentation  → application → entity
 *   infrastructure → application(ポートを実装する。依存性の逆転)
 *
 * CommonJS (.cjs) なのは、package.json が "type": "module" のため。
 * dependency-cruiser の設定は require で読まれるので、拡張子で明示する必要がある。
 */
module.exports = {
  forbidden: [
    {
      name: 'entity-is-innermost',
      severity: 'error',
      comment:
        'entity は最も内側の層。他のどの層にも依存してはならない(依存の向きは常に entity へ向かう)。',
      from: { path: '^src/entity' },
      to: { path: '^src/(application|infrastructure|presentation)' },
    },
    {
      name: 'application-not-to-outer',
      severity: 'error',
      comment:
        'application はポート(インターフェース)を定義する側。実装である infrastructure や、' +
        'UI である presentation に依存してはならない。',
      from: { path: '^src/application' },
      to: { path: '^src/(infrastructure|presentation)' },
    },
    {
      name: 'infrastructure-not-to-presentation',
      severity: 'error',
      comment: 'infrastructure は UI を知らない。presentation に依存してはならない。',
      from: { path: '^src/infrastructure' },
      to: { path: '^src/presentation' },
    },
    {
      name: 'presentation-not-to-infrastructure',
      severity: 'error',
      comment:
        'presentation は application のポートにだけ依存する。具体実装の差し替えは ' +
        'コンポジションルート(main.tsx)だけが知っていればよい(依存性注入)。',
      from: { path: '^src/presentation', pathNot: '^src/main\\.tsx$' },
      to: { path: '^src/infrastructure' },
    },
    {
      name: 'inner-layers-are-framework-free',
      severity: 'error',
      comment:
        'entity と application は React / React Flow / Zustand / 通信ライブラリに依存してはならない。' +
        'Node 上だけで単体テストでき、UI ライブラリを差し替えても影響を受けないようにするため。',
      from: { path: '^src/(entity|application)' },
      to: {
        dependencyTypes: ['npm', 'npm-dev'],
        path: 'node_modules/(react|react-dom|@xyflow/react|zustand|react-router|recharts|openapi-fetch|msw)(/|$)',
      },
    },
    {
      name: 'generated-api-types-only-in-infrastructure',
      severity: 'error',
      comment:
        '生成された API 型(src/api/schema.d.ts)は、HTTP 境界の都合そのもの。' +
        'infrastructure だけが参照し、内側の層にはエンティティの型へ変換してから渡す。',
      from: { pathNot: '^src/(infrastructure|api)' },
      to: { path: '^src/api/schema' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        '循環依存を禁じる。循環があると、どちらが先に初期化されるかが不定になり、' +
        'モジュール単位での理解とテストができなくなる。',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        '製品コードが devDependencies を import するのを禁じる。' +
        '本番ビルドに含まれないはずの依存が混ざるのを防ぐため。' +
        '除外するもの: テストコード、MSW のモック(開発専用)、' +
        '型宣言ファイル(.d.ts は型だけでビルド成果物に残らず、vite/client のような' +
        'ビルドツールのアンビエント型を参照するのが正しい使い方である)。',
      from: {
        path: '^src',
        pathNot: '\\.test\\.(ts|tsx)$|\\.d\\.ts$|^src/infrastructure/mock',
      },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment: '解決できない import を禁じる(綴り間違いや、消したファイルへの参照を検出する)。',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // 型だけの import(import type)も依存として数える。これがないと
    // entity が React の型を参照していても検出できない。
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
  },
}
