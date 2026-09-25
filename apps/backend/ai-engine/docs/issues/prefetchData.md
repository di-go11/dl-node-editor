# prefetchDataのissue

## 構成図

```mermaid
TorchModelTrainer ──▶ IDatasetRepository        ← 変更なし(Trainerはここまでしか知らない)
                            ▲
                 TorchDataLoaderAdapter          ← 新規。IDatasetRepositoryを実装
                            │ 内部で使う
                 TorchSampleDataset              ← 新規。libtorchのDatasetを継承
                            │ 呼ぶ
                      ISampleSource              ← 新規ポート: index → 1サンプル
                            ▲
                     VocSampleSource             ← 新規。VOC読み込みの実体
```