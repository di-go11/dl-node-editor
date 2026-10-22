# フロントエンド実装 指示書

この文書は、ターミナルで起動した Claude Code に、深層学習モデル編集ツールのフロントエンド(React)を実装してもらうための指示書である。
作業を始める前に、この文書を最後まで読むこと。

---

## 0. 最初に読むもの

作業の前に、次のファイルを必ず読むこと。ここに書いた内容は、これらのファイルの要約である。食い違う場合は、ファイルの内容を正とする。

| ファイル | 内容 |
|---|---|
| `/workspaces/CLAUDE.md` | プロジェクト全体の方針(クリーンアーキテクチャ、各言語の役割、デプロイ形態) |
| `/workspaces/apps/backend/proto/model_graph.proto` | **モデル構造の表現(DAG)**。エディタの保存形式と API の中心になる |
| `/workspaces/apps/backend/proto/training.proto` | 学習の開始・進捗・停止。optimizer / loss / データ設定の選択肢 |
| `/workspaces/apps/backend/proto/capabilities.proto` | 使えるデバイス(CPU / CUDA)の取得 |
| `/workspaces/apps/backend/ai-engine/src/training/entities/domain-objects/ModelGraph/NodePorts.hpp` | **層ごとのポート定義の正本**(ポート名、ポートの種類、複数接続の可否) |
| `/workspaces/apps/backend/ai-engine/modelconfigs/test_segnet_dag.json` | 学習開始リクエストの実例(JSON の表記の手本) |

---

## 1. 背景と目的

### 1.1 プロジェクト

深層学習のモデル構造や、optimizer、loss、各種パラメータを、GUI(ノードエディタ)で組み立てて学習まで実行できるツールを作っている。

```
[React(ブラウザ)] --HTTP/SSE--> [Rust API] --gRPC--> [C++ / libtorch(学習エンジン)]
```

- C++ 側:gRPC サーバーと、モデルグラフの検証・学習はある程度実装済み。
- Rust 側:gRPC クライアントの一部(capabilities)のみ実装済み。**HTTP API はまだない。**
- フロントエンド:**まだ何もない。今回これを作る。**

### 1.2 今回の進め方:契約駆動(Contract-first)

Rust の HTTP API は、フロントと並行して後から実装される。そのため、次の方針で進める。

1. この文書の「6. API 契約」を、フロントと Rust の間の約束(契約)とする。
2. フロントは **MSW(Mock Service Worker)で作ったモック API** を相手に開発する。
3. Rust 側が API を実装したら、モックを外して本物につなぐ(今回の範囲外)。

契約を変えたくなった場合は、勝手に変えずにユーザーに相談すること。Rust 側の実装に影響するためである。

---

## 2. 守るべき作業ルール

ユーザーのグローバル設定(`~/.claude/CLAUDE.md`)に従う。特に次の点は必ず守ること。

1. **回答は日本語で行う。**
2. **説明は教科書的に書く。** ユーザーは情報系を独学で学ぶ学生である。「何をしたか」だけでなく、用語の定義、背景の原理、その実装が妥当な理由を説明すること。
3. **新しいファイルの作成と削除は、必ず事前に許可を取る。** 雛形の生成のようにファイルが大量にできる場合は、フェーズごとに「作成予定のファイル一覧(ディレクトリ構成)」を提示し、まとめて許可を取ってよい。既存ファイルの編集は許可不要。
4. **大きな機能は、実装の前に設計方針を提示して相談する。** 各フェーズの最初に、そのフェーズの設計(コンポーネントや型の構成、責務の分け方)を提示し、合意を取ってから実装する。
5. **クリーンアーキテクチャとデザインパターンの原則を守る。** 原則から外れる場合は、その理由を説明する。
6. git のコミットは、ユーザーに頼まれたときだけ行う。作業ブランチは `feat/frontend-<内容>` の形にする。

---

## 3. 技術スタック

ユーザーからの指定はないため、次の構成を推奨とする。変えたい場合は、フェーズ0の設計提示で理由を添えて提案すること。

| 用途 | 採用するもの | 理由 |
|---|---|---|
| 実行環境 | Node.js 24(LTS) | 開発サーバーとビルドの実行に使う。長期サポート版を選ぶ |
| パッケージ管理 | npm | Node.js に同梱されていて、追加の導入が要らない |
| 言語 | TypeScript(`strict: true`) | proto 由来の型を正確に表し、契約違反をコンパイル時に検出するため |
| ビルド | Vite | React の標準的な開発環境で、起動と更新が速い |
| API 契約 | OpenAPI 3.1(`openapi.yaml`) | フロントと Rust の間の契約を、機械が読める1つのファイルにするため(6章を参照) |
| 型生成 | openapi-typescript | `openapi.yaml` から TypeScript の型を生成する。契約と実装の型がずれないようにするため |
| HTTP クライアント | openapi-fetch | 生成した型を使い、パスとリクエスト / レスポンスの型を検査できる軽量な fetch ラッパー |
| 層の依存チェック | dependency-cruiser | 5章の依存の方向(domain が React を import しない、など)を、ルールとして自動で検査するため |
| Lint / 整形 | ESLint(flat config)+ Prettier | コードの書き方をそろえるため |
| UI | React | プロジェクトの決定事項 |
| ノードエディタ | React Flow(`@xyflow/react`) | ノード、ポート(Handle)、接続、ズームやパンを標準で持つ。`isValidConnection` でポートの種類による接続判定が書ける |
| 状態管理 | Zustand | 画面をまたいでエディタの状態を保つため。React Flow 自体も内部で使っている |
| 画面遷移 | React Router | エディタ → 学習設定 → 進捗の3画面の遷移と、ブラウザの「戻る」に対応するため |
| 実行時検証 | Zod | 読み込んだ JSON ファイルや API レスポンスは外部入力なので、実行時に型を検証するため |
| モック API | MSW | ブラウザとテストの両方で、同じ定義のモックを使えるため |
| グラフ描画 | Recharts | 進捗画面の loss 曲線を描くため |
| テスト | Vitest + React Testing Library | Vite と設定を共有できるため |
| スタイル | CSS Modules | 追加の依存を増やさず、コンポーネント単位でスタイルを閉じられるため |

---

## 4. 画面仕様

### 4.1 画面遷移

```
[ノードエディタ画面]
   │ [学習開始]
   ▼
[学習設定画面] ── optimizer / loss / 学習率 などを選択・編集する
   │ [整合性チェック] ── NG → ログに問題を表示する。修正は各画面に戻って行う
   │                  └ OK → [学習実行] が押せるようになる
   │ [学習実行]
   ▼
[進捗画面] ── epoch、loss 曲線、メトリクス、経過時間、状態を表示する。[停止] ボタンを置く
```

### 4.2 ノードエディタ画面(起動時に表示する画面)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ヘッダ: [データ形式 1D/2D ▼][特徴抽出手法 CNN ▼]                          │
│         [保存][読込]   デバイス: CUDA ✓ (cuda:0)   [学習開始]             │
├────────────┬───────────────────────────────────────┬─────────────────┤
│ サイドバー   │                                       │ プロパティパネル   │
│ ▼ 畳み込み   │       ノードエディタ(キャンバス)          │ conv2 (Conv2D)   │
│   Conv2D    │ [Input]──▶[Conv2D]──▶[ReLU]──▶[Output] │ in_channels  [64]│
│ ▼ 活性化     │                                       │ out_channels[128]│
│   ...       │                                       │ kernel_size  [3] │
├────────────┴───────────────────────────────────────┴─────────────────┤
│ ログ: ⚠ conv2: 入力ポート x が未接続です                                    │
└──────────────────────────────────────────────────────────────────────┘
```

- **中央**:ノードエディタ。見た目と操作感は、UE のマテリアルエディタや Unity の Shader Graph を手本にする。
  - ノードはタイトル(層の種類)、主要パラメータの要約表示(例:`64→128, k3`)、左側の入力ポート、右側の出力ポートからなる。
  - パラメータの編集は右側のプロパティパネルで行う(下記)。ノード上は表示だけにする。
  - **ポートは種類ごとに色を分ける**(例:Feature は青、Tokens は紫、Indices は橙、Any は灰)。違う種類のポート同士はつなげない。
  - サイドバーからドラッグ&ドロップでノードを置く。
- **左**:サイドバー。ノードをカテゴリ別のディレクトリ(折りたたみ式)で表示する。ヘッダの選択条件で中身が変わる(4.3 参照)。
- **右**:プロパティパネル(インスペクタ)。選択中のノードの ID とパラメータを編集する。UE の Details パネルや Unity の Inspector に相当する。
  - 入力欄は、ノードカタログのパラメータ定義(型、既定値、制約、列挙の選択肢)から自動で組み立てる。ノードごとにフォームを手書きしない。
  - 制約違反(例:kernel_size に 0)は、入力欄の横にすぐ表示する。
  - 何も選択していないときは、グラフ全体の情報(ノード数、現在の条件など)を表示する。
  - パネルの幅は変えられるようにし、折りたためるようにする。
- **下**:ログ。整合性チェックの結果や警告をテキストで表示する。ログの行をクリックすると、該当するノードを選択して画面の中央に表示する。
- **上**:ヘッダ。データ形式と特徴抽出手法の選択、保存と読込、デバイス表示(capabilities API の結果)、学習開始ボタンを置く。

### 4.3 データ形式と特徴抽出手法によるノードの切り替え

- 選択肢
  - データ形式:`1D` / `2D`(**2D がメイン**)。**1D は「近日実装予定」とする。** ヘッダでは選べるようにするが、サイドバーには「1D 用のノードは近日実装予定です」と表示し、ノードは出さない。1D 用のノードは、後でカタログに足すだけで追加できるようにしておく。
  - 特徴抽出手法:`CNN` のみ。**後で `Transformer` を追加する**ので、列挙値として拡張できる形にしておくこと。
- サイドバーには、ノードカタログ(全ノードの定義)を、選択中の条件で絞り込んだ結果だけを表示する。
- **条件を切り替えたとき、キャンバスに置いたノードは消さない。** 新しい条件に合わないノードは次のように扱う。
  - ノードを**赤色で表示し、⚠ マーク**を付ける。
  - ログに「このノードは現在の条件(例:1D / CNN)では使えません」と警告を出す。
  - このノードが残っている間は、整合性チェックを通さない。

### 4.4 学習設定画面

`training.proto` の `StartTrainingRequest` の項目を編集する。選択肢は proto の定義を正とする。

| 項目 | 内容 |
|---|---|
| model_name | モデル名 |
| optimizer | Adam / AdamW / SGD。選んだ種類に応じて、パラメータ欄(learning_rate、weight_decay、beta1、beta2、eps、momentum、nesterov)を切り替える |
| loss | CrossEntropy / MSE / Dice / Focal(gamma、alpha)/ Combo(alpha)/ Boundary |
| epoch, batch | 1 以上の整数 |
| dataset_path | データセットのパス(サーバー上のパスを文字列で入力する) |
| device | capabilities API の結果から選ぶ(`cpu`、`cuda:0` など) |
| data_spec | 画像:annotation(Pascal VOC、include_difficult)、input_width / input_height(既定値 256)、タスク(Segmentation(ignore_index、既定値 255)/ Classification / ObjectDetection) |
| save_last_every | 0 なら毎エポック保存 |
| resume_from | 空なら再開しない |
| seed | 未指定も選べるようにする(proto で `Seed` メッセージに包まれている理由を参照) |

### 4.5 整合性チェックと実行ボタンの状態

画面の状態を次の**状態機械**として実装すること。

```
editing ──[整合性チェック]──▶ checking ──OK──▶ checked ──[学習実行]──▶ running
   ▲                            │NG                │
   └────────────────────────────┴──── グラフか設定を1つでも変更したら editing に戻る
```

- `checked` のときだけ [学習実行] を押せる。
- チェックの後にグラフや設定を変更したら、必ず `editing` に戻し、再チェックを求める。検証していない内容が実行されるのを防ぐためである。
- チェックの内容は「8. 整合性チェックのルール」を参照すること。

### 4.6 進捗画面

- SSE(6.2 参照)で進捗を受け取り、次の項目を表示する。
  - 現在の epoch
  - train_loss / val_loss の折れ線グラフ
  - メトリクス(Segmentation:pixel_acc、mIoU、fw_IoU、mean_class_accuracy、クラスごとの IoU / Classification:accuracy、macro_f1、クラスごとの値)
  - epoch の所要時間、累計時間
  - 状態
- [停止] ボタンで停止 API を呼ぶ。
- 状態が FAILED になったら `error_message` を目立つ形で表示する。
- 学習が終わったら(COMPLETED / FAILED / STOPPED)ストリームを閉じ、エディタに戻るボタンを出す。

---

## 5. アーキテクチャ

### 5.1 層構成と依存の方向

フロントエンドにもクリーンアーキテクチャを適用する。**依存は外側から内側への一方向だけ**とする。

```
presentation(React コンポーネント、React Flow、Zustand ストア)
     │ 依存
     ▼
application(ユースケース、ポート = インターフェース)
     │ 依存
     ▼
domain(型、ノードカタログの定義、検証ルール。React に依存しない純粋な TypeScript)

infrastructure(HTTP クライアント、MSW モック、ファイル入出力)
     └─ application のポート(インターフェース)を実装する(依存性の逆転)
```

- `domain` と `application` は React、React Flow、fetch を import してはならない。これらは単体テストを Node 上だけで実行できるようにしておく。
- React Flow の型(`Node`、`Edge`)と、ドメインのモデルグラフの型は分ける。2つの変換は presentation 層のマッパーで行う。React Flow を別のライブラリに替えても、ドメインに影響しないようにするためである。
- 依存の組み立て(どのポート実装を使うか)は、エントリポイント(`main.tsx`)の1か所(コンポジションルート)で行い、React Context で配る。モックと本物の切り替えもここで行う。

### 5.2 ディレクトリ構成(案)

```
apps/frontend/
├── src/
│   ├── domain/
│   │   ├── model-graph/      # ModelGraph, Node, NodeSpec, PortRef(proto と対応する型)
│   │   ├── node-catalog/     # ノード定義(ポート、パラメータ、カテゴリ、対応条件)
│   │   ├── validation/       # 整合性チェックのルール(純粋関数)
│   │   ├── training/         # 学習設定、進捗の型
│   │   └── document/         # 保存ファイルの型とバージョン移行
│   ├── application/
│   │   ├── ports/            # TrainingApi, CapabilitiesApi, DocumentStorage などのインターフェース
│   │   └── usecases/         # validateAll, saveDocument, loadDocument, startTraining ...
│   ├── infrastructure/
│   │   ├── http/             # 「6. API 契約」に従う fetch / EventSource の実装
│   │   ├── mock/             # MSW のハンドラ
│   │   └── file/             # JSON のダウンロード / アップロード
│   ├── presentation/
│   │   ├── pages/            # EditorPage, TrainingSettingsPage, ProgressPage
│   │   ├── components/       # Header, Sidebar, LogPanel, nodes/ ...
│   │   ├── stores/           # Zustand ストア
│   │   └── mappers/          # ドメイン ⇔ React Flow の変換
│   └── main.tsx              # コンポジションルート
└── ...
```

最終的な構成は、フェーズ0の設計提示でユーザーと合意すること。

### 5.3 ノードカタログ

ノードの定義はデータ(カタログ)として持ち、UI のコードに直接書かない。**ノードを追加するときは、カタログに1件足すだけで済むようにする**(開放閉鎖原則)。

カタログの各項目には、少なくとも次の情報を持たせる。

- 種類(`NodeSpec` の oneof 名と同じ文字列。例:`conv2d`)
- 表示名とカテゴリ(サイドバーのディレクトリ)
- 入力ポート / 出力ポート:名前、種類(`Feature` / `Tokens` / `Indices` / `Any`)、複数接続の可否、最低接続数
  - **`NodePorts.hpp` と完全に一致させること**(例:Add と Concat の入力 `x` は複数接続可、最低2本)
- パラメータ:名前、型、既定値、制約(最小値や列挙の選択肢)
- 対応する条件:データ形式と特徴抽出手法の組み合わせ

カタログの出どころは、最初はフロントの固定データとする。ただし `NodeCatalogSource` のようなポートを通して取得し、将来 API から取得する実装に差し替えられるようにすること。どの演算を使えるかを本当に知っているのは C++ 側だからである。

**MVP に入れるノード**(proto の `NodeSpec` に今ある10種類。すべて 2D / CNN 用):

| カテゴリ | ノード |
|---|---|
| 畳み込み | Conv2D |
| プーリング | Pooling2D(Max / Average)、IndexedPooling、Unpooling |
| 正規化 | BatchNorm |
| 活性化 | Activation(ReLU / Sigmoid / Softmax / Tanh) |
| 全結合 | Linear |
| 拡大 | Upsample(Nearest / Bilinear) |
| 結合 | Add、Concat |
| (エディタ専用) | Input、Output |

- **Input / Output はエディタの中だけにあるノード**であり、proto のノードには含めない。変換時に、Input からの接続は `source` が空の `PortRef`(グラフ入力)に、Output への接続は `ModelGraph.outputs` に対応させる。Output は当面1つだけとする。
- `NodePorts.hpp` で「これから追加する層」となっているもの(ConvTranspose2D、Flatten、Transformer 系など)は、MVP では入れない。ただし、カタログに1件足すだけで追加できる設計になっているかを、設計提示の段階で確認すること。

---

## 6. API 契約

### 6.0 契約の正本:OpenAPI

- この章の内容を、OpenAPI 3.1 の `openapi.yaml` として書き起こし、**それを契約の正本とする。** 置き場所は `/workspaces/apps/backend/openapi/openapi.yaml` を提案する。gRPC の契約(`apps/backend/proto/`)と並べ、バックエンドが公開するインターフェース定義を1か所にまとめるためである。最終的な場所は、フェーズ0でユーザーと決める。
- フロントの API の型は、`openapi-typescript` で `openapi.yaml` から生成する。生成した型を手で編集してはならない。
- Rust 側も、後で同じ `openapi.yaml` に従って実装する。
- **SSE(進捗)の注意**:`openapi-fetch` は SSE を扱えない。進捗だけは `EventSource` で受け取り、各イベントの `data` を、生成した型(`StreamProgressResponse` 相当)で解釈する。OpenAPI 上は、`text/event-stream` のレスポンスと、イベントのスキーマを記述しておく。

### 6.1 共通事項

- ベースパス:`/api/v1`
- JSON のフィールド名と enum の表記は、**`test_segnet_dag.json` と同じ形**にそろえる。
  - フィールド名は proto の名前のまま(snake_case)。
  - enum は proto の名前の文字列(例:`"ACTIVATION_TYPE_RELU"`)。
  - oneof は、選んだフィールド名をキーにしたオブジェクト(例:`"optimizer": { "adam": { ... } }`)。
- エラーのレスポンス:`{ "error": { "code": string, "message": string, "issues"?: Issue[] } }`

### 6.2 エンドポイント

| メソッド | パス | 内容 | リクエスト / レスポンス |
|---|---|---|---|
| GET | `/capabilities` | デバイス一覧 | → `{ cuda_available: bool, devices: [{ device_name, device_index, device_type: "DEVICE_TYPE_CPU" \| "DEVICE_TYPE_CUDA" }] }` |
| POST | `/model-graphs/validate` | サーバー側の整合性チェック | `{ model_graph }` → `{ ok: bool, issues: Issue[] }` |
| POST | `/trainings` | 学習開始 | `StartTrainingRequest` の JSON(`test_segnet_dag.json` と同じ形)→ `{ job_id, status }` |
| GET | `/trainings/{job_id}/progress` | 進捗(**SSE**) | 各イベントの `data` が `StreamProgressResponse` の JSON |
| POST | `/trainings/{job_id}/stop` | 学習停止 | → `{ status }` |

```ts
type Issue = {
  severity: "error" | "warning";
  node_id?: string;   // 該当ノード(ログのクリックでフォーカスするために使う)
  port?: string;
  message: string;
};
```

- 進捗を SSE(Server-Sent Events)にする理由:進捗はサーバーからクライアントへの一方向の連続した通知であり、gRPC のサーバーストリーミング(`StreamProgress`)をそのまま HTTP に写せるからである。双方向の通信は要らないので、WebSocket は使わない。
- C++ の検証は、問題をすべて位置付きで返す(`model_graph.proto` の冒頭のコメントを参照)。`/model-graphs/validate` は Rust 側で未実装だが、MVP ではモックとして契約に含める。

### 6.3 モック

- MSW のハンドラで、上の全エンドポイントを再現すること。
- 進捗のモックは、一定の間隔で epoch を進め、loss が少しずつ下がるデータを流し、最後に COMPLETED を送る。FAILED になる場合のモックも用意する。
- 開発時はモックを使い、環境変数(例:`VITE_USE_MOCK=true`)で本物の API と切り替えられるようにする。

---

## 7. 保存ファイル(エディタの状態の JSON)

### 7.1 方針

エディタの状態は JSON ファイルとして保存し、読み込めるようにする。保存先は、MVP ではブラウザのダウンロードとアップロード(File API)とする。

保存ファイルの中では、**モデルの意味(model_graph)と、エディタの見た目(ノードの座標など)を分ける**こと。こうすると、`model` の部分をそのまま API に送れる。また、見た目の変更がモデルの意味を変えることもない。

### 7.2 形式(案)

```jsonc
{
  "format": "model-editor-document",
  "version": 1,                      // 形式のバージョン。読み込み時に古い版を新しい版へ変換するために使う
  "meta": { "name": "segnet", "saved_at": "2026-10-22T10:00:00Z" },
  "context": { "data_dim": "2d", "method": "cnn" },   // ヘッダの選択状態
  "model": {
    "model_graph": { "nodes": [ /* model_graph.proto の Node と同じ形 */ ], "outputs": [ /* ... */ ] }
  },
  "editor": {
    "positions": { "conv1": { "x": 120, "y": 80 }, "__input__": { "x": 0, "y": 80 }, "__output__": { "x": 600, "y": 80 } },
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  },
  "training": { /* 学習設定。model_graph 以外の StartTrainingRequest の項目。未設定なら省略 */ }
}
```

- 読み込み時は、Zod で形式を検証すること。外部から来たファイルは信用できない入力として扱う。不正な場合は、どこがおかしいかをログに出す。
- 現在の条件で使えないノードが含まれていても、読み込みは成功させる(4.3 の赤色表示になる)。
- 整合性チェックの結果や選択状態など、**後から計算できるデータは保存しない。**

### 7.3 ノードの並び順を保つこと(重要)

`model_graph.proto` には、**`nodes` の並び順が重みの初期化と checkpoint の対応を決める**と書かれている。このため、次の点を守ること。

- ノードは作成した順に並べて保持する。
- キャンバス上で移動したり、選択したり、再描画したりしても、順番を変えない。
- 保存と読み込みで順番が変わらないことを、テストで保証する。

### 7.4 ノード ID

- proto の制約(空でない、重複しない、英数字・`-`・`_` のみ)を満たす ID を自動で振る(例:`conv2d_1`)。
- `__input__` / `__output__` はエディタ専用の予約 ID とし、ユーザーが作るノードには使わない。

---

## 8. 整合性チェックのルール

チェックは2段階で行う。結果はすべて `Issue` としてログに出す。

**(1) フロント側のチェック(domain 層の純粋関数として実装する。単体テスト必須)**

`model_graph.proto` の冒頭にある「送る側が守ること」をすべて満たしているかを確認する。

- ノードが1つ以上ある。Input と Output がある。
- ID の制約を満たしている。
- グラフに閉路がない(DAG である)。
- すべての入力ポートに必要な本数の接続がある(通常は1本。Add / Concat の `x` は2本以上)。
- 接続したポートの種類が合っている(`Indices` は `Indices` 同士だけ。`Any` は入力の種類に合わせる)。
- 現在の条件で使えないノード(赤色表示のノード)がない。
- パラメータが制約を満たしている(例:kernel_size ≥ 1)。
- **チャンネル数の整合**(警告):C++ は形状を確認せず、合わないと学習開始時に失敗する。そこで、確実に分かる範囲で確認する。例:Conv2D の `in_channels` が、上流の Conv2D の `out_channels` と一致しているか。追跡できない経路はチェックしない。

**(2) 学習設定のチェック**

- 必須項目が入力されている。数値が範囲内にある。

**(3) サーバー側のチェック**

- `/model-graphs/validate` を呼ぶ(MVP ではモック)。

---

## 9. 作業フェーズ

各フェーズでは、次の順で進めること。

1. 設計を提示する(作るもの、ファイル一覧、責務の分け方)。
2. 合意と、ファイル作成の許可を取る。
3. 実装する。
4. テストを書いて通す。
5. 完了を報告する(学習につながる解説を付ける)。

**1つのフェーズの完了報告をしてから、次のフェーズへ進むこと。**

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| 0. 環境構築 | Node.js の開発用コンテナを追加する(下の注記を参照)。`apps/frontend/` に Vite + React + TS を用意し、ESLint、Prettier、Vitest、MSW、dependency-cruiser を設定する。6章の内容を `openapi.yaml` に書き起こし、型生成を npm スクリプトにする | コンテナ内で `npm run dev` の画面がホストのブラウザで開き、`npm test`、`npm run lint`、`npm run gen:api`(型生成)が通る |
| 1. ドメイン層 | モデルグラフの型、ノードカタログ(MVP の10種類 + Input / Output)、整合性チェック(フロント側)、保存ファイルの型と変換を作る | 単体テストが通る。`test_segnet_dag.json` の `model_graph` を読み込んで保存し直すと、同じ内容になる(往復テスト) |
| 2. エディタ画面の骨格 | ヘッダ、サイドバー、キャンバス、ログの配置。ドラッグ&ドロップでノードを置く。ポートの色分けと接続判定。右側のプロパティパネルでのパラメータ編集(カタログの定義からフォームを自動で組み立てる) | 手で SegNet と同等のグラフを組み立てられる |
| 3. 条件の切り替え | データ形式と手法によるサイドバーの絞り込み。合わないノードの赤色表示、⚠ マーク、ログへの警告 | 2D から 1D へ切り替えると、置いたノードが赤色になり、ログに警告が出る |
| 4. 保存 / 読込 | 7章の JSON の保存と読込。不正なファイルの検出 | 保存して読み込み直すと、座標と並び順も含めて元に戻る |
| 5. 学習設定と整合性チェック | 学習設定画面。整合性チェック(8章)。状態機械(4.5)。ログのクリックでノードにフォーカスする | チェックで NG なら実行できず、OK なら実行できる。チェックの後に何か変更すると、再チェックが必要になる |
| 6. 進捗画面 | SSE のモックで進捗を表示する。停止ボタン。FAILED の表示 | モックで学習の開始から完了までと、失敗の場合を確認できる |

**フェーズ0の注記:フロント用コンテナ**

今の開発コンテナ(`.devcontainer/docker-compose.yml`)には Node.js がない。そこで、既存の `ai-engine-dev` / `api-dev` と同じ形でフロント用のサービスを追加する。これは既存の構成ファイルの変更と、新しいファイルの作成を伴う。**設計提示の段階で、必ずユーザーの承認を得ること。**

| 項目 | 内容 | 理由 |
|---|---|---|
| サービス名 | `web-dev` | 既存の `*-dev` という命名に合わせる |
| Dockerfile | `.devcontainer/Dockerfile.web`(ベースは `node:24-bookworm-slim`。`git` と `ca-certificates` を追加する) | `Dockerfile.rust` と同じく、slim 版に最小限のツールを足す方針に合わせる |
| ボリューム | リポジトリルートを `/workspaces` にマウントする。`~/.claude` を共有する。`node_modules` は名前付きボリュームにする | 既存サービスと同じマウント構成にする。`node_modules` をホストと共有すると、WSL2 ではファイル I/O が遅く、OS ごとのネイティブバイナリも混ざるため、コンテナ内に閉じる |
| ポート | `5173:5173` を公開する。Vite は `--host 0.0.0.0` で起動する | コンテナ内の開発サーバーを、ホストのブラウザから開くため |
| 作業ディレクトリ | `/workspaces/apps/frontend` | 既存サービスと同じく、担当ディレクトリを既定にする |
| 起動コマンド | 既存と同じ `while sleep 1000; do :; done` | DevContainer として VS Code から接続し続けるため。開発サーバーは手動で起動する |
| API への接続 | Vite の `server.proxy` で `/api` を `http://api-dev:<port>` に転送する(Rust の HTTP サーバーができてから有効にする) | ブラウザから見て同一オリジンになり、CORS の設定が不要になる。compose のサービス名で名前解決できる |

E2E テスト(Playwright など)は、ブラウザのダウンロードでイメージが大きくなるため、MVP では入れない。必要になった時点で相談すること。

---

## 10. 未決事項(作業中にユーザーに確認すること)

次の点はまだ決まっていない。該当するフェーズに入る前に、ユーザーに確認すること。勝手に決めてはならない。

1. **loss とタスクの組み合わせ**:Dice / Boundary はセグメンテーション専用にするなど、組み合わせの制限を整合性チェックに入れるか(フェーズ5の前に確認する)。
2. **`openapi.yaml` の置き場所**:6.0 の提案でよいか(フェーズ0の設計提示で確認する)。
3. **API 契約の変更**:6章の契約を変えたくなった場合は、実装を進めずにユーザーに相談する。その時点で一緒に検討する。

決定済み(参考):1D は「近日実装予定」の表示にする(4.3)。パラメータは右側のプロパティパネルで編集する(4.2)。フロント用コンテナは9章の注記の構成で提案する。
