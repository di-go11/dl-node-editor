// 学習済みモデルの一覧・学習設定を DB から読み出す処理(学習再開の画面と API 用)
use super::SqliteTrainingRepository;
use crate::model;
use entities::model::{
    EpochRecord, LastRunSummary, ModelHistory, ModelId, ModelSummary, ModelTaskType, RunRecord,
};
use entities::training::config::{
    DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, LearningRateScheduler,
    LearningRateSchedulerConfig, LearningRateUpdateInterval, Loss, Optimizer, PascalVocConfig,
    RgbColor, SegmentationSpec, TrainingConfig,
};
use entities::training::TrainingJobStatus;
use entities::training::{ClassificationMetrics, JobId, Metrics, SegmentationMetrics};
use sqlx::sqlite::SqliteRow;
use sqlx::Row;
use std::collections::HashMap;
use usecases::model::error::FetchModelError;
use usecases::model::ports::{
    ModelHistoryProvider, ModelSummaryProvider, ModelTrainingConfigProvider,
};

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
                    c.ignore_color_r, c.ignore_color_g, c.ignore_color_b, \
                    c.lr_scheduler_type, c.lr_power, c.lr_min_lr, c.lr_step_size, c.lr_gamma, \
                    c.lr_update_interval, c.lr_warmup_epochs \
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
            // 0005 より前の行は、列の既定値で none(warmup なし)として読める
            lr_scheduler: read_lr_scheduler(&row)?,
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

impl ModelHistoryProvider for SqliteTrainingRepository {
    async fn fetch_history(&self, model_id: &ModelId) -> Result<ModelHistory, FetchModelError> {
        let model_name: String = sqlx::query("SELECT model_name FROM model WHERE model_id = ?")
            .bind(model_id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| FetchModelError::InvalidQuery(e.to_string()))?
            .ok_or_else(|| FetchModelError::NotFound(model_id.as_str().to_string()))
            .and_then(|row| get(&row, "model_name"))?;

        // run は学習を始めた順。started_at が同じなら insert した順(ModelTrainingConfigProvider と同じ並べ方)
        let run_rows = sqlx::query(
            "SELECT job_id, status, failure_reason, started_at, finished_at \
             FROM training_runs WHERE model_id = ? ORDER BY started_at, rowid",
        )
        .bind(model_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(|e| FetchModelError::InvalidQuery(e.to_string()))?;
        let runs = run_rows
            .iter()
            .map(|row| {
                Ok(RunRecord {
                    job_id: read_job_id(row)?,
                    status: read_status(row)?,
                    started_at: get(row, "started_at")?,
                    finished_at: get(row, "finished_at")?,
                })
            })
            .collect::<Result<Vec<_>, FetchModelError>>()?;

        // クラスごとの値(IoU / accuracy)は別のテーブルにあるので、先に (job_id, epoch) ごとに集める
        let per_class_iou = self
            .fetch_per_class(model_id, "segmentation_class_metrics", "iou")
            .await?;
        let per_class_accuracy = self
            .fetch_per_class(model_id, "classification_class_metrics", "accuracy")
            .await?;

        let epoch_rows = sqlx::query(
            "SELECT e.job_id, e.epoch, e.train_loss, e.val_loss, e.learning_rate, e.epoch_elapsed_ms, \
                    s.job_id AS seg_job_id, s.pixel_accuracy, s.miou, s.fw_iou, s.mean_class_accuracy, \
                    c.job_id AS cls_job_id, c.accuracy, c.macro_f1 \
             FROM training_epochs e \
             JOIN training_runs r ON r.job_id = e.job_id \
             LEFT JOIN segmentation_epoch_metrics s ON s.job_id = e.job_id AND s.epoch = e.epoch \
             LEFT JOIN classification_epoch_metrics c ON c.job_id = e.job_id AND c.epoch = e.epoch \
             WHERE r.model_id = ? \
             ORDER BY r.started_at, r.rowid, e.epoch",
        )
        .bind(model_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(|e| FetchModelError::InvalidQuery(e.to_string()))?;

        let epochs = epoch_rows
            .iter()
            .map(|row| {
                let job_id = read_job_id(row)?;
                let epoch: u32 = get(row, "epoch")?;
                let key = (job_id.as_str().to_string(), epoch);
                // NULL(NaN を保存した値など)は NaN にする(JSON では null になる)
                let value = |column: &str| -> Result<f64, FetchModelError> {
                    Ok(get::<Option<f64>>(row, column)?.unwrap_or(f64::NAN))
                };
                let metrics = if get::<Option<String>>(row, "seg_job_id")?.is_some() {
                    Some(Metrics::Segmentation(SegmentationMetrics {
                        pixel_accuracy: value("pixel_accuracy")?,
                        miou: value("miou")?,
                        fw_iou: value("fw_iou")?,
                        mean_class_accuracy: value("mean_class_accuracy")?,
                        per_class_iou: per_class_iou.get(&key).cloned().unwrap_or_default(),
                    }))
                } else if get::<Option<String>>(row, "cls_job_id")?.is_some() {
                    Some(Metrics::Classification(ClassificationMetrics {
                        accuracy: value("accuracy")?,
                        macro_f1: value("macro_f1")?,
                        per_class_accuracy: per_class_accuracy
                            .get(&key)
                            .cloned()
                            .unwrap_or_default(),
                    }))
                } else {
                    None
                };
                let epoch_elapsed_ms: i64 = get(row, "epoch_elapsed_ms")?;
                Ok(EpochRecord {
                    job_id,
                    epoch,
                    train_loss: get(row, "train_loss")?,
                    val_loss: get(row, "val_loss")?,
                    learning_rate: get(row, "learning_rate")?,
                    epoch_elapsed_ms: u64::try_from(epoch_elapsed_ms).map_err(invalid)?,
                    metrics,
                })
            })
            .collect::<Result<Vec<_>, FetchModelError>>()?;

        Ok(ModelHistory {
            model_id: model_id.clone(),
            model_name,
            runs,
            epochs,
        })
    }
}

impl SqliteTrainingRepository {
    // クラスごとの値を (job_id, epoch) → クラスの添字の順の値 にまとめる。
    // table / column は呼び出し側の固定の名前だけを渡す(利用者の入力は入らない)
    async fn fetch_per_class(
        &self,
        model_id: &ModelId,
        table: &str,
        column: &str,
    ) -> Result<HashMap<(String, u32), Vec<f64>>, FetchModelError> {
        let rows = sqlx::query(&format!(
            "SELECT t.job_id, t.epoch, t.class_index, t.{column} AS value \
             FROM {table} t JOIN training_runs r ON r.job_id = t.job_id \
             WHERE r.model_id = ? ORDER BY t.job_id, t.epoch, t.class_index"
        ))
        .bind(model_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(|e| FetchModelError::InvalidQuery(e.to_string()))?;

        let mut values: HashMap<(String, u32), Vec<f64>> = HashMap::new();
        for row in &rows {
            let key = (get::<String>(row, "job_id")?, get::<u32>(row, "epoch")?);
            let index = usize::try_from(get::<i64>(row, "class_index")?).map_err(invalid)?;
            let value = get::<Option<f64>>(row, "value")?.unwrap_or(f64::NAN);
            let per_class = values.entry(key).or_default();
            // 添字が飛んでいれば NaN で埋める(記録していないクラス)
            if per_class.len() <= index {
                per_class.resize(index + 1, f64::NAN);
            }
            per_class[index] = value;
        }
        Ok(values)
    }
}

fn read_job_id(row: &SqliteRow) -> Result<JobId, FetchModelError> {
    JobId::new(get::<String>(row, "job_id")?).map_err(invalid)
}

// 以下の対応表は sql_recorder.rs の insert_training_run の逆。片方を変えたらもう片方も変える。

fn read_lr_scheduler(row: &SqliteRow) -> Result<LearningRateScheduler, FetchModelError> {
    let scheduler_type: String = get(row, "lr_scheduler_type")?;
    let scheduler = match scheduler_type.as_str() {
        "none" => LearningRateSchedulerConfig::None,
        "poly" => LearningRateSchedulerConfig::Poly {
            power: required(row, "lr_power")?,
        },
        "cosine" => LearningRateSchedulerConfig::Cosine {
            min_lr: required(row, "lr_min_lr")?,
        },
        "step" => LearningRateSchedulerConfig::Step {
            step_size: required(row, "lr_step_size")?,
            gamma: required(row, "lr_gamma")?,
        },
        other => {
            return Err(FetchModelError::InvalidData(format!(
                "unknown lr_scheduler_type: {other}"
            )))
        }
    };
    let update_interval_name: String = get(row, "lr_update_interval")?;
    let update_interval = match update_interval_name.as_str() {
        "per_batch" => LearningRateUpdateInterval::PerBatch,
        "per_epoch" => LearningRateUpdateInterval::PerEpoch,
        other => {
            return Err(FetchModelError::InvalidData(format!(
                "unknown lr_update_interval: {other}"
            )))
        }
    };
    Ok(LearningRateScheduler {
        scheduler,
        update_interval,
        warmup_epochs: get(row, "lr_warmup_epochs")?,
    })
}

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
    // 学習率スケジューラは種類ごとに使う列が違う(0005)。どの種類も保存した値で読み戻せること
    #[tokio::test]
    async fn reads_back_every_lr_scheduler_type() {
        let schedulers = [
            LearningRateScheduler::none(),
            LearningRateScheduler {
                scheduler: LearningRateSchedulerConfig::Poly { power: 0.9 },
                update_interval: LearningRateUpdateInterval::PerBatch,
                warmup_epochs: 1,
            },
            LearningRateScheduler {
                scheduler: LearningRateSchedulerConfig::Cosine { min_lr: 1e-6 },
                update_interval: LearningRateUpdateInterval::PerBatch,
                warmup_epochs: 0,
            },
            LearningRateScheduler {
                scheduler: LearningRateSchedulerConfig::Step {
                    step_size: 30,
                    gamma: 0.1,
                },
                update_interval: LearningRateUpdateInterval::PerEpoch,
                warmup_epochs: 2,
            },
        ];
        for (i, lr_scheduler) in schedulers.into_iter().enumerate() {
            let repo = gen_repository().await;
            let config = TrainingConfig {
                lr_scheduler,
                ..gen_config()
            };
            repo.insert_model(&model_id(), &config.model_name, &config.model_graph)
                .await
                .unwrap();
            repo.insert_training_run(
                &JobId::new(format!("job-{i}")).unwrap(),
                &config,
                &model_id(),
            )
            .await
            .unwrap();

            let fetched = ModelTrainingConfigProvider::fetch(&repo, &model_id())
                .await
                .unwrap();

            assert_eq!(fetched, config);
        }
    }

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

    fn epoch_process(
        epoch: u32,
        learning_rate: Option<f64>,
    ) -> entities::training::TrainingProcess {
        entities::training::TrainingProcess {
            epoch,
            train_loss: 0.5,
            val_loss: 0.4,
            status: TrainingJobStatus::Running,
            metrics: Some(Metrics::Segmentation(SegmentationMetrics {
                pixel_accuracy: 0.9,
                miou: 0.5,
                fw_iou: 0.8,
                mean_class_accuracy: 0.6,
                per_class_iou: vec![0.9, 0.1],
            })),
            epoch_elapsed_time: std::time::Duration::from_millis(1200),
            total_elapsed_time: std::time::Duration::from_millis(1200 * u64::from(epoch)),
            learning_rate,
        }
    }

    // 学習の記録: 全 run のエポックを、run の順・エポックの順に、メトリクス(クラスごとの値も)と学習率つきで返す
    #[tokio::test]
    async fn history_has_epochs_of_every_run_in_order() {
        use usecases::training::TrainingProgressRecorder;

        let repo = gen_repository().await;
        let config = gen_config();
        repo.insert_model(&model_id(), &config.model_name, &config.model_graph)
            .await
            .unwrap();
        let first = JobId::new("job-1").unwrap();
        let second = JobId::new("job-2").unwrap();
        repo.insert_training_run(&first, &config, &model_id())
            .await
            .unwrap();
        repo.insert_epoch(&first, 1, &epoch_process(1, Some(1e-3)))
            .await
            .unwrap();
        repo.insert_epoch(&first, 2, &epoch_process(2, None))
            .await
            .unwrap();
        repo.insert_training_run(&second, &config, &model_id())
            .await
            .unwrap();
        repo.insert_epoch(&second, 3, &epoch_process(3, Some(5e-4)))
            .await
            .unwrap();

        let history = repo.fetch_history(&model_id()).await.unwrap();

        assert_eq!(history.model_name, "test_model");
        assert_eq!(
            history
                .runs
                .iter()
                .map(|r| r.job_id.as_str())
                .collect::<Vec<_>>(),
            vec!["job-1", "job-2"]
        );
        assert_eq!(
            history
                .epochs
                .iter()
                .map(|e| (e.job_id.as_str(), e.epoch, e.learning_rate))
                .collect::<Vec<_>>(),
            vec![
                ("job-1", 1, Some(1e-3)),
                ("job-1", 2, None),
                ("job-2", 3, Some(5e-4))
            ]
        );
        let first_epoch = &history.epochs[0];
        assert_eq!(first_epoch.train_loss, Some(0.5));
        assert_eq!(first_epoch.epoch_elapsed_ms, 1200);
        assert_eq!(
            first_epoch.metrics,
            Some(Metrics::Segmentation(SegmentationMetrics {
                pixel_accuracy: 0.9,
                miou: 0.5,
                fw_iou: 0.8,
                mean_class_accuracy: 0.6,
                per_class_iou: vec![0.9, 0.1],
            }))
        );
    }

    #[tokio::test]
    async fn history_of_unknown_model_is_not_found() {
        let repo = gen_repository().await;
        assert!(matches!(
            repo.fetch_history(&model_id()).await,
            Err(FetchModelError::NotFound(_))
        ));
    }
}
