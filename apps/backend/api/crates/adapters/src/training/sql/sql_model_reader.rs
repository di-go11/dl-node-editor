// 学習済みモデルの一覧・学習設定を DB から読み出す処理(学習再開の画面と API 用)
use super::SqliteTrainingRepository;
use crate::model;
use entities::model::{LastRunSummary, ModelId, ModelSummary, ModelTaskType};
use entities::training::config::{
    DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, Loss, Optimizer, PascalVocConfig,
    RgbColor, SegmentationSpec, TrainingConfig,
};
use entities::training::TrainingJobStatus;
use sqlx::sqlite::SqliteRow;
use sqlx::Row;
use usecases::model::error::FetchModelError;
use usecases::model::ports::{ModelSummaryProvider, ModelTrainingConfigProvider};

impl ModelSummaryProvider for SqliteTrainingRepository {
    async fn fetch(&self) -> Result<Vec<ModelSummary>, FetchModelError> {
        // 各モデルの最新の run(ModelTrainingConfigProvider と同じ順で選ぶ)と、その設定のタスクを結合する。
        // run が 1 件もないモデルは JOIN で落ちる
        // (insert_model の後に C++ の学習開始が失敗した場合などにできる。issue doc 作業8)。
        // 完了エポック数は、そのモデルの全 run の training_epochs.epoch の最大値(0 始まり)から求める。
        // 最近学習したモデルほど上に出す。
        let rows = sqlx::query(
            "SELECT m.model_id, m.model_name, m.created_at, \
                    m.model_graph IS NOT NULL AS has_graph, \
                    r.status, r.failure_reason, r.started_at, r.finished_at, \
                    c.task_type, \
                    (SELECT MAX(e.epoch) FROM training_epochs e \
                       JOIN training_runs er ON er.job_id = e.job_id \
                      WHERE er.model_id = m.model_id) AS last_epoch \
             FROM model m \
             JOIN training_runs r ON r.job_id = ( \
                 SELECT lr.job_id FROM training_runs lr WHERE lr.model_id = m.model_id \
                 ORDER BY lr.started_at DESC, lr.rowid DESC LIMIT 1) \
             JOIN training_config c ON c.job_id = r.job_id \
             ORDER BY r.started_at DESC, r.rowid DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| FetchModelError::InvalidQuery(e.to_string()))?;

        rows.iter().map(read_summary).collect()
    }
}

fn read_summary(row: &SqliteRow) -> Result<ModelSummary, FetchModelError> {
    let model_id = ModelId::new(get::<String>(row, "model_id")?).map_err(invalid)?;
    let task_type = match get::<String>(row, "task_type")?.as_str() {
        "segmentation" => ModelTaskType::Segmentation,
        "classification" => ModelTaskType::Classification,
        other => {
            return Err(FetchModelError::InvalidData(format!(
                "unknown task_type: {other}"
            )))
        }
    };
    let last_run = LastRunSummary {
        status: read_status(row)?,
        started_at: get(row, "started_at")?,
        finished_at: get(row, "finished_at")?,
    };
    // epoch は 0 始まりなので、記録があれば最大値 + 1 が完了したエポック数
    let completed_epochs = match get::<Option<u32>>(row, "last_epoch")? {
        Some(last_epoch) => last_epoch + 1,
        None => 0,
    };
    Ok(ModelSummary::new(
        model_id,
        get::<String>(row, "model_name")?,
        get::<String>(row, "created_at")?,
        task_type,
        last_run,
        completed_epochs,
        get(row, "has_graph")?,
    ))
}

// training_runs.status の文字列(sql_recorder.rs の update_training_run で書く値)を読む
fn read_status(row: &SqliteRow) -> Result<TrainingJobStatus, FetchModelError> {
    let status: String = get(row, "status")?;
    Ok(match status.as_str() {
        "idle" => TrainingJobStatus::Idle,
        "running" => TrainingJobStatus::Running,
        "completed" => TrainingJobStatus::Completed,
        "failed" => TrainingJobStatus::Failed {
            reason: get::<Option<String>>(row, "failure_reason")?.unwrap_or_default(),
        },
        "stopped" => TrainingJobStatus::Stopped,
        other => {
            return Err(FetchModelError::InvalidData(format!(
                "unknown status: {other}"
            )))
        }
    })
}

impl ModelTrainingConfigProvider for SqliteTrainingRepository {
    async fn fetch(&self, model_id: &ModelId) -> Result<TrainingConfig, FetchModelError> {
        // 最新の run の設定を 1 行取る。started_at が同じなら後から insert した行を優先する
        let row = sqlx::query(
            "SELECT m.model_name, m.model_graph, \
                    c.epochs, c.batch, c.device, c.dataset_path, c.save_last_every, c.seed, \
                    c.optimizer_type, c.learning_rate, c.weight_decay, c.beta1, c.beta2, c.eps, \
                    c.momentum, c.nesterov, c.loss_type, c.loss_gamma, c.loss_alpha, \
                    c.data_type, c.input_width, c.input_height, c.task_type, c.ignore_index, \
                    c.annotation_type, c.include_difficult, \
                    c.ignore_color_r, c.ignore_color_g, c.ignore_color_b \
             FROM model m \
             JOIN training_runs r ON r.model_id = m.model_id \
             JOIN training_config c ON c.job_id = r.job_id \
             WHERE m.model_id = ? \
             ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1",
        )
        .bind(model_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| FetchModelError::InvalidQuery(e.to_string()))?
        .ok_or_else(|| FetchModelError::NotFound(model_id.as_str().to_string()))?;

        // 0002 より前に作ったモデルは構造が保存されていないので再開できない
        let graph_json: Option<String> = get(&row, "model_graph")?;
        let graph_json = graph_json
            .ok_or_else(|| FetchModelError::GraphNotSaved(model_id.as_str().to_string()))?;
        let model_graph = model::from_json(&graph_json).map_err(invalid)?;

        Ok(TrainingConfig {
            // 学習率スケジューラの列は migration を作るまでないので none(issue 段階 3b)
            lr_scheduler: entities::training::config::LearningRateScheduler::none(),
            model_name: get(&row, "model_name")?,
            model_graph,
            epoch: get(&row, "epochs")?,
            batch: get(&row, "batch")?,
            device: get(&row, "device")?,
            dataset_path: get(&row, "dataset_path")?,
            optimizer: read_optimizer(&row)?,
            loss: read_loss(&row)?,
            // SQLite の INTEGER は符号付きなので i64 で保存している(sql_recorder.rs)
            seed: get::<Option<i64>>(&row, "seed")?.map(|seed| seed as u64),
            data_spec: read_data_spec(&row)?,
            save_last_every: get(&row, "save_last_every")?,
        })
    }
}

// 以下の対応表は sql_recorder.rs の insert_training_run の逆。片方を変えたらもう片方も変える。

fn read_optimizer(row: &SqliteRow) -> Result<Optimizer, FetchModelError> {
    let learning_rate = get(row, "learning_rate")?;
    let weight_decay = get(row, "weight_decay")?;
    let optimizer_type: String = get(row, "optimizer_type")?;
    match optimizer_type.as_str() {
        "adam" => Ok(Optimizer::Adam {
            learning_rate,
            weight_decay,
            beta1: required(row, "beta1")?,
            beta2: required(row, "beta2")?,
            eps: required(row, "eps")?,
        }),
        "adam_w" => Ok(Optimizer::AdamW {
            learning_rate,
            weight_decay,
            beta1: required(row, "beta1")?,
            beta2: required(row, "beta2")?,
        }),
        "sgd" => Ok(Optimizer::Sgd {
            learning_rate,
            weight_decay,
            momentum: required(row, "momentum")?,
            nesterov: required(row, "nesterov")?,
        }),
        other => Err(FetchModelError::InvalidData(format!(
            "unknown optimizer_type: {other}"
        ))),
    }
}

fn read_loss(row: &SqliteRow) -> Result<Loss, FetchModelError> {
    let loss_type: String = get(row, "loss_type")?;
    match loss_type.as_str() {
        "cross_entropy" => Ok(Loss::CrossEntropy),
        "mse" => Ok(Loss::Mse),
        "dice" => Ok(Loss::Dice),
        "focal" => Ok(Loss::Focal {
            gamma: required(row, "loss_gamma")?,
            alpha: required(row, "loss_alpha")?,
        }),
        "combo" => Ok(Loss::Combo {
            alpha: required(row, "loss_alpha")?,
        }),
        "boundary" => Ok(Loss::Boundary),
        other => Err(FetchModelError::InvalidData(format!(
            "unknown loss_type: {other}"
        ))),
    }
}

fn read_data_spec(row: &SqliteRow) -> Result<DataSpec, FetchModelError> {
    let data_type: String = get(row, "data_type")?;
    if data_type != "image" {
        return Err(FetchModelError::InvalidData(format!(
            "unknown data_type: {data_type}"
        )));
    }

    let task_type: String = get(row, "task_type")?;
    let image_task_spec = match task_type.as_str() {
        "classification" => ImageTaskSpec::Classification,
        "segmentation" => ImageTaskSpec::Segmentation(SegmentationSpec {
            ignore_index: required(row, "ignore_index")?,
            ignore_color: read_ignore_color(row)?,
        }),
        other => {
            return Err(FetchModelError::InvalidData(format!(
                "unknown task_type: {other}"
            )))
        }
    };

    let annotation_type: String = get(row, "annotation_type")?;
    let image_annotation_config = match annotation_type.as_str() {
        "pascal_voc" => ImageAnnotationConfig::PascalVoc(PascalVocConfig {
            include_difficult: required(row, "include_difficult")?,
        }),
        "original" => ImageAnnotationConfig::Original,
        other => {
            return Err(FetchModelError::InvalidData(format!(
                "unknown annotation_type: {other}"
            )))
        }
    };

    Ok(DataSpec::Image(ImageSpec {
        input_width: get(row, "input_width")?,
        input_height: get(row, "input_height")?,
        image_task_spec,
        image_annotation_config,
    }))
}

// 無視する色の 3 列を読む。3 列とも NULL なら指定なし、一部だけ NULL なら壊れたデータ
fn read_ignore_color(row: &SqliteRow) -> Result<Option<RgbColor>, FetchModelError> {
    let r: Option<u32> = get(row, "ignore_color_r")?;
    let g: Option<u32> = get(row, "ignore_color_g")?;
    let b: Option<u32> = get(row, "ignore_color_b")?;
    match (r, g, b) {
        (Some(r), Some(g), Some(b)) => Ok(Some(RgbColor { r, g, b })),
        (None, None, None) => Ok(None),
        _ => Err(FetchModelError::InvalidData(
            "ignore_color_r/g/b must be all NULL or all set".to_string(),
        )),
    }
}

// 列を読む。型が合わない・列がない場合は InvalidData
fn get<'r, T>(row: &'r SqliteRow, column: &str) -> Result<T, FetchModelError>
where
    T: sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    row.try_get(column).map_err(invalid)
}

// NULL を許す列のうち、その種類では必須の列を読む(例: adam の beta1)
fn required<'r, T>(row: &'r SqliteRow, column: &str) -> Result<T, FetchModelError>
where
    T: sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    get::<Option<T>>(row, column)?
        .ok_or_else(|| FetchModelError::InvalidData(format!("{column} is NULL")))
}

fn invalid(e: impl std::fmt::Display) -> FetchModelError {
    FetchModelError::InvalidData(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::model::layer::{ConcatSpec, Conv2DSpec, NodeSpec};
    use entities::model::{ModelGraph, Node, NodeInput, PortRef};
    use entities::training::JobId;
    use sqlx::sqlite::SqlitePoolOptions;
    use usecases::training::TrainingRunRegistar;

    // テストごとに新しいインメモリ DB を作る。
    // インメモリ DB は接続ごとに別物になるため、接続を 1 本に絞る
    async fn gen_repository() -> SqliteTrainingRepository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./src/migrations").run(&pool).await.unwrap();
        SqliteTrainingRepository::new(pool)
    }

    fn gen_graph() -> ModelGraph {
        ModelGraph {
            nodes: vec![
                Node {
                    id: "conv1".to_string(),
                    spec: NodeSpec::Conv2D(Conv2DSpec {
                        in_channels: 3,
                        out_channels: 8,
                        kernel_size: 3,
                        stride: 1,
                        padding: 1,
                        dilation: 1,
                    }),
                    inputs: vec![NodeInput {
                        port: "x".to_string(),
                        source: None,
                    }],
                },
                Node {
                    id: "concat1".to_string(),
                    spec: NodeSpec::Concat(ConcatSpec),
                    inputs: vec![
                        NodeInput {
                            port: "x0".to_string(),
                            source: Some(PortRef {
                                node_id: "conv1".to_string(),
                                port: "y".to_string(),
                            }),
                        },
                        NodeInput {
                            port: "x1".to_string(),
                            source: None,
                        },
                    ],
                },
            ],
            outputs: vec![PortRef {
                node_id: "concat1".to_string(),
                port: "y".to_string(),
            }],
        }
    }

    fn gen_config() -> TrainingConfig {
        TrainingConfig {
            lr_scheduler: entities::training::config::LearningRateScheduler::none(),
            model_name: "test_model".to_string(),
            model_graph: gen_graph(),
            epoch: 5,
            batch: 4,
            device: "cuda:0".to_string(),
            dataset_path: "/data/VOCdevkit/VOC2012".to_string(),
            optimizer: Optimizer::Sgd {
                learning_rate: 0.01,
                weight_decay: 1e-4,
                momentum: 0.9,
                nesterov: true,
            },
            loss: Loss::Focal {
                gamma: 2.0,
                alpha: 0.25,
            },
            seed: Some(42),
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 320,
                input_height: 240,
                image_task_spec: ImageTaskSpec::Segmentation(SegmentationSpec {
                    ignore_index: 255,
                    ignore_color: Some(RgbColor {
                        r: 224,
                        g: 224,
                        b: 192,
                    }),
                }),
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: true,
                }),
            }),
            save_last_every: 2,
        }
    }

    fn model_id() -> ModelId {
        ModelId::new("model-1").unwrap()
    }

    #[tokio::test]
    async fn reads_back_saved_config() {
        let repo = gen_repository().await;
        let config = gen_config();
        repo.insert_model(&model_id(), &config.model_name, &config.model_graph)
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-1").unwrap(), &config, &model_id())
            .await
            .unwrap();

        let fetched = ModelTrainingConfigProvider::fetch(&repo, &model_id())
            .await
            .unwrap();

        assert_eq!(fetched, config);
    }

    // 無視する色の指定なし(3 列とも NULL)も、そのまま読み戻せること
    #[tokio::test]
    async fn reads_back_config_without_ignore_color() {
        let repo = gen_repository().await;
        let config = TrainingConfig {
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 320,
                input_height: 240,
                image_task_spec: ImageTaskSpec::Segmentation(SegmentationSpec {
                    ignore_index: 255,
                    ignore_color: None,
                }),
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: false,
                }),
            }),
            ..gen_config()
        };
        repo.insert_model(&model_id(), &config.model_name, &config.model_graph)
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-1").unwrap(), &config, &model_id())
            .await
            .unwrap();

        let fetched = ModelTrainingConfigProvider::fetch(&repo, &model_id())
            .await
            .unwrap();

        assert_eq!(fetched, config);
    }

    #[tokio::test]
    async fn reads_back_original_annotation_config() {
        // 独自形式は include_difficult を持たない(NULL で保存し、読み戻しても Original のまま)
        let repo = gen_repository().await;
        let config = TrainingConfig {
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 320,
                input_height: 240,
                image_task_spec: ImageTaskSpec::Segmentation(SegmentationSpec {
                    ignore_index: 255,
                    ignore_color: None,
                }),
                image_annotation_config: ImageAnnotationConfig::Original,
            }),
            ..gen_config()
        };
        repo.insert_model(&model_id(), &config.model_name, &config.model_graph)
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-1").unwrap(), &config, &model_id())
            .await
            .unwrap();

        let fetched = ModelTrainingConfigProvider::fetch(&repo, &model_id())
            .await
            .unwrap();

        assert_eq!(fetched, config);
    }

    #[tokio::test]
    async fn returns_latest_run_config() {
        let repo = gen_repository().await;
        let first = gen_config();
        let second = TrainingConfig {
            epoch: 10,
            loss: Loss::CrossEntropy,
            seed: None,
            ..gen_config()
        };
        repo.insert_model(&model_id(), &first.model_name, &first.model_graph)
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-1").unwrap(), &first, &model_id())
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-2").unwrap(), &second, &model_id())
            .await
            .unwrap();

        let fetched = ModelTrainingConfigProvider::fetch(&repo, &model_id())
            .await
            .unwrap();

        assert_eq!(fetched, second);
    }

    #[tokio::test]
    async fn returns_not_found_for_unknown_model() {
        let repo = gen_repository().await;

        let result = ModelTrainingConfigProvider::fetch(&repo, &model_id()).await;

        assert!(matches!(result, Err(FetchModelError::NotFound(_))));
    }

    #[tokio::test]
    async fn returns_graph_not_saved_when_graph_is_null() {
        let repo = gen_repository().await;
        let config = gen_config();
        repo.insert_model(&model_id(), &config.model_name, &config.model_graph)
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-1").unwrap(), &config, &model_id())
            .await
            .unwrap();
        // 0002 より前に作られたモデルを再現する
        sqlx::query("UPDATE model SET model_graph = NULL")
            .execute(&repo.pool)
            .await
            .unwrap();

        let result = ModelTrainingConfigProvider::fetch(&repo, &model_id()).await;

        assert!(matches!(result, Err(FetchModelError::GraphNotSaved(_))));
    }

    #[tokio::test]
    async fn lists_only_models_with_runs() {
        let repo = gen_repository().await;
        let config = gen_config();
        repo.insert_model(&model_id(), "trained", &config.model_graph)
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-1").unwrap(), &config, &model_id())
            .await
            .unwrap();
        // C++ の学習開始に失敗して run がないモデル
        repo.insert_model(
            &ModelId::new("model-2").unwrap(),
            "orphan",
            &config.model_graph,
        )
        .await
        .unwrap();

        let summaries = ModelSummaryProvider::fetch(&repo).await.unwrap();

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].model_id(), &model_id());
        assert_eq!(summaries[0].model_name(), "trained");
    }

    // training_epochs に 1 行足す(メトリクスは一覧に使わないので入れない)
    async fn insert_epoch_row(repo: &SqliteTrainingRepository, job_id: &str, epoch: u32) {
        sqlx::query(
            "INSERT INTO training_epochs (job_id, epoch, epoch_elapsed_ms) VALUES (?, ?, 0)",
        )
        .bind(job_id)
        .bind(epoch)
        .execute(&repo.pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn summary_has_latest_run_task_and_completed_epochs_over_all_runs() {
        let repo = gen_repository().await;
        let config = gen_config();
        repo.insert_model(&model_id(), "trained", &config.model_graph)
            .await
            .unwrap();
        let first = JobId::new("job-1").unwrap();
        let second = JobId::new("job-2").unwrap();
        repo.insert_training_run(&first, &config, &model_id())
            .await
            .unwrap();
        for epoch in 0..3 {
            insert_epoch_row(&repo, "job-1", epoch).await;
        }
        repo.update_training_run(&first, &TrainingJobStatus::Stopped)
            .await
            .unwrap();
        // 再開した run(epoch 3, 4 を記録して失敗)
        repo.insert_training_run(&second, &config, &model_id())
            .await
            .unwrap();
        insert_epoch_row(&repo, "job-2", 3).await;
        insert_epoch_row(&repo, "job-2", 4).await;
        repo.update_training_run(
            &second,
            &TrainingJobStatus::Failed {
                reason: "out of memory".to_string(),
            },
        )
        .await
        .unwrap();

        let summaries = ModelSummaryProvider::fetch(&repo).await.unwrap();

        assert_eq!(summaries.len(), 1);
        let summary = &summaries[0];
        assert_eq!(summary.task_type(), ModelTaskType::Segmentation);
        // 状態は最新の run(job-2)のもの
        assert_eq!(
            summary.last_run().status,
            TrainingJobStatus::Failed {
                reason: "out of memory".to_string()
            }
        );
        assert!(summary.last_run().finished_at.is_some());
        // epoch 0〜4 を記録したので 5 エポック完了
        assert_eq!(summary.completed_epochs(), 5);
        assert!(summary.resumable());
    }

    #[tokio::test]
    async fn summary_of_running_model_without_epochs() {
        let repo = gen_repository().await;
        let config = TrainingConfig {
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 32,
                input_height: 32,
                image_task_spec: ImageTaskSpec::Classification,
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: false,
                }),
            }),
            ..gen_config()
        };
        repo.insert_model(&model_id(), "trained", &config.model_graph)
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-1").unwrap(), &config, &model_id())
            .await
            .unwrap();
        // 0002 より前に作られたモデル(構造がない)
        sqlx::query("UPDATE model SET model_graph = NULL")
            .execute(&repo.pool)
            .await
            .unwrap();

        let summaries = ModelSummaryProvider::fetch(&repo).await.unwrap();

        let summary = &summaries[0];
        assert_eq!(summary.task_type(), ModelTaskType::Classification);
        assert_eq!(summary.last_run().status, TrainingJobStatus::Running);
        assert_eq!(summary.last_run().finished_at, None);
        assert_eq!(summary.completed_epochs(), 0);
        assert!(!summary.resumable());
    }

    #[tokio::test]
    async fn lists_recently_trained_models_first() {
        let repo = gen_repository().await;
        let config = gen_config();
        let older = ModelId::new("model-old").unwrap();
        let newer = ModelId::new("model-new").unwrap();
        repo.insert_model(&older, "old", &config.model_graph)
            .await
            .unwrap();
        repo.insert_model(&newer, "new", &config.model_graph)
            .await
            .unwrap();
        repo.insert_training_run(&JobId::new("job-1").unwrap(), &config, &newer)
            .await
            .unwrap();
        // 先に作ったモデルを後から再開した
        repo.insert_training_run(&JobId::new("job-2").unwrap(), &config, &older)
            .await
            .unwrap();

        let summaries = ModelSummaryProvider::fetch(&repo).await.unwrap();

        let names: Vec<&str> = summaries.iter().map(|s| s.model_name()).collect();
        assert_eq!(names, vec!["old", "new"]);
    }
}
