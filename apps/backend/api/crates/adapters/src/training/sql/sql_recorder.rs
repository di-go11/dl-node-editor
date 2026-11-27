use super::SqliteTrainingRepository;
use crate::model;
use chrono::Utc;
use entities::model::ModelGraph;
use entities::model::ModelId;
use entities::training::config::{
    DataSpec, ImageAnnotationConfig, ImageTaskSpec, LearningRateSchedulerConfig,
    LearningRateUpdateInterval, Loss, Optimizer, TrainingConfig,
};
use entities::training::JobId;
use entities::training::Metrics;
use entities::training::TrainingJobStatus;
use entities::training::TrainingProcess;

use usecases::training::{
    RecordError, RepositoryError, TrainingProgressRecorder, TrainingRunRegistar,
};
// 学習実行情報をDBへ保存する処理3つ
impl TrainingRunRegistar for SqliteTrainingRepository {
    async fn insert_model(
        &self,
        model_id: &ModelId,
        model_name: &str,
        model_graph: &ModelGraph,
    ) -> Result<(), RecordError> {
        // JSON の形は model::graph_json が決める(HTTP の DTO とは独立)
        let model_graph_json =
            model::to_json(model_graph).map_err(|e| RepositoryError::InvalidData(e.to_string()))?;
        sqlx::query(
            "INSERT INTO model (model_id,model_name,model_graph,created_at)VALUES (?,?,?,?)",
        )
        .bind(model_id.as_str())
        .bind(model_name)
        .bind(model_graph_json)
        .bind(Utc::now())
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
        Ok(())
    }
    async fn insert_training_run(
        &self,
        job_id: &JobId,
        config: &TrainingConfig,
        model_id: &ModelId,
    ) -> Result<(), RecordError> {
        let mut connect = self
            .pool
            .begin()
            .await
            .map_err(|e| RepositoryError::ConnectionFailed(e.to_string()))?;
        sqlx::query(
            "INSERT INTO training_runs (job_id,model_id,status,started_at)VALUES (?,?,?,?)",
        )
        .bind(job_id.as_str())
        .bind(model_id.as_str())
        .bind("running") // 学習開始時は必ずrunningだから
        .bind(Utc::now())
        .execute(&mut *connect)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;

        let (optimizer_type, learning_rate, weight_decay, beta1, beta2, eps, momentum, nesterov) =
            match &config.optimizer {
                Optimizer::Adam {
                    learning_rate,
                    weight_decay,
                    beta1,
                    beta2,
                    eps,
                } => (
                    "adam",
                    *learning_rate,
                    *weight_decay,
                    Some(*beta1),
                    Some(*beta2),
                    Some(*eps),
                    None,
                    None,
                ),
                Optimizer::AdamW {
                    learning_rate,
                    weight_decay,
                    beta1,
                    beta2,
                } => (
                    "adam_w",
                    *learning_rate,
                    *weight_decay,
                    Some(*beta1),
                    Some(*beta2),
                    None,
                    None,
                    None,
                ),
                Optimizer::Sgd {
                    learning_rate,
                    weight_decay,
                    momentum,
                    nesterov,
                } => (
                    "sgd",
                    *learning_rate,
                    *weight_decay,
                    None,
                    None,
                    None,
                    Some(*momentum),
                    Some(*nesterov),
                ),
            };
        let (loss_type, loss_gamma, loss_alpha) = match &config.loss {
            Loss::CrossEntropy => ("cross_entropy", None, None),
            Loss::Mse => ("mse", None, None),
            Loss::Dice => ("dice", None, None),
            Loss::Focal { gamma, alpha } => ("focal", Some(*gamma), Some(*alpha)),
            Loss::Combo { alpha } => ("combo", None, Some(*alpha)),
            Loss::Boundary => ("boundary", None, None),
        };
        let DataSpec::Image(image_spec) = &config.data_spec;
        let (task_type, ignore_index, ignore_color) = match &image_spec.image_task_spec {
            ImageTaskSpec::Classification => ("classification", None, None),
            ImageTaskSpec::Segmentation(spec) => {
                ("segmentation", Some(spec.ignore_index), spec.ignore_color)
            }
        };
        let (annotation_type, include_difficult) = match &image_spec.image_annotation_config {
            ImageAnnotationConfig::PascalVoc(spec) => ("pascal_voc", Some(spec.include_difficult)),
            ImageAnnotationConfig::Original => ("original", None),
        };
        let scheduler = &config.lr_scheduler;
        let (lr_scheduler_type, lr_power, lr_min_lr, lr_step_size, lr_gamma) = match &scheduler
            .scheduler
        {
            LearningRateSchedulerConfig::None => ("none", None, None, None, None),
            LearningRateSchedulerConfig::Poly { power } => ("poly", Some(*power), None, None, None),
            LearningRateSchedulerConfig::Cosine { min_lr } => {
                ("cosine", None, Some(*min_lr), None, None)
            }
            LearningRateSchedulerConfig::Step { step_size, gamma } => {
                ("step", None, None, Some(*step_size), Some(*gamma))
            }
        };
        let lr_update_interval = match scheduler.update_interval {
            LearningRateUpdateInterval::PerBatch => "per_batch",
            LearningRateUpdateInterval::PerEpoch => "per_epoch",
        };

        // training_configはtraining_runsを外部キーで参照するため、後にinsertする
        sqlx::query(
            "INSERT INTO training_config (job_id,epochs,batch,device,dataset_path,save_last_every,resume_from,seed,optimizer_type,learning_rate,weight_decay,beta1,beta2,eps,momentum,nesterov,loss_type,loss_gamma,loss_alpha,data_type,input_width,input_height,task_type,ignore_index,annotation_type,include_difficult,ignore_color_r,ignore_color_g,ignore_color_b,lr_scheduler_type,lr_power,lr_min_lr,lr_step_size,lr_gamma,lr_update_interval,lr_warmup_epochs)VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(job_id.as_str())
        .bind(config.epoch)
        .bind(config.batch)
        .bind(&config.device)
        .bind(&config.dataset_path)
        .bind(config.save_last_every)
        // resume_from列は0001で作成済みのため残すが、再開は.ptのファイル名で決まるため常にNULL
        .bind(None::<&str>)
        .bind(config.seed.map(|seed| seed as i64)) // SQLiteのINTEGERは符号付きのためi64で保存する。読み出し時はu64に戻す
        .bind(optimizer_type)
        .bind(learning_rate)
        .bind(weight_decay)
        .bind(beta1)
        .bind(beta2)
        .bind(eps)
        .bind(momentum)
        .bind(nesterov)
        .bind(loss_type)
        .bind(loss_gamma)
        .bind(loss_alpha)
        .bind("image") // DataSpecはImageのみ
        .bind(image_spec.input_width)
        .bind(image_spec.input_height)
        .bind(task_type)
        .bind(ignore_index)
        .bind(annotation_type)
        .bind(include_difficult)
        // 無視する色の指定がなければ 3 列とも NULL
        .bind(ignore_color.map(|c| c.r))
        .bind(ignore_color.map(|c| c.g))
        .bind(ignore_color.map(|c| c.b))
        // 学習率スケジューラ(0005)。種類ごとに使わない列は NULL
        .bind(lr_scheduler_type)
        .bind(lr_power)
        .bind(lr_min_lr)
        .bind(lr_step_size)
        .bind(lr_gamma)
        .bind(lr_update_interval)
        .bind(scheduler.warmup_epochs)
        .execute(&mut *connect)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;

        connect
            .commit()
            .await
            .map_err(|e| RepositoryError::TransactionFailed(e.to_string()))?;
        Ok(())
    }
    async fn update_training_run(
        &self,
        job_id: &JobId,
        status: &TrainingJobStatus,
    ) -> Result<(), RecordError> {
        let mut connect = self
            .pool
            .begin()
            .await
            .map_err(|e| RepositoryError::ConnectionFailed(e.to_string()))?;
        let (status_string, failure_reason) = match status {
            TrainingJobStatus::Idle => ("idle", None),
            TrainingJobStatus::Running => ("running", None),
            TrainingJobStatus::Completed => ("completed", None),
            TrainingJobStatus::Failed { reason } => ("failed", Some(reason.as_str())),
            TrainingJobStatus::Stopped => ("stopped", None),
        };
        sqlx::query(
            "UPDATE training_runs SET status = ?, failure_reason = ?, finished_at = ? WHERE job_id = ?",
        )
        .bind(status_string)
        .bind(failure_reason)
        .bind(Utc::now())
        .bind(job_id.as_str())
        .execute(&mut *connect)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
        connect
            .commit()
            .await
            .map_err(|e| RepositoryError::TransactionFailed(e.to_string()))?;
        Ok(())
    }
}

// エポックごとの学習結果をDBへ保存する処理
impl TrainingProgressRecorder for SqliteTrainingRepository {
    async fn insert_epoch(
        &self,
        job_id: &JobId,
        epoch: u32,
        process: &TrainingProcess,
    ) -> Result<(), RecordError> {
        let epoch_elapsed_ms = i64::try_from(process.epoch_elapsed_time.as_millis())
            .map_err(|e| RepositoryError::InvalidData(e.to_string()))?;
        let mut connect = self
            .pool
            .begin()
            .await
            .map_err(|e| RepositoryError::ConnectionFailed(e.to_string()))?;

        // メトリクスのテーブルが外部キーで参照するため、training_epochsを先にinsertする
        sqlx::query(
            "INSERT INTO training_epochs (job_id,epoch,train_loss,val_loss,epoch_elapsed_ms,learning_rate)VALUES (?,?,?,?,?,?)",
        )
        .bind(job_id.as_str())
        .bind(epoch)
        .bind(process.train_loss)
        .bind(process.val_loss)
        .bind(epoch_elapsed_ms)
        // 学習率を送らない古い学習エンジンのときは NULL(0005)
        .bind(process.learning_rate)
        .execute(&mut *connect)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;

        match &process.metrics {
            Some(Metrics::Segmentation(metrics)) => {
                let confusion_matrix_json: Option<String> = metrics
                    .confusion_matrix
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()
                    .map_err(|e| RepositoryError::InvalidData(e.to_string()))?;

                sqlx::query(
                    "INSERT INTO segmentation_epoch_metrics (job_id,epoch,pixel_accuracy,miou,fw_iou,mean_class_accuracy, confusion_matrix)VALUES (?,?,?,?,?,?,?)",
                )
                .bind(job_id.as_str())
                .bind(epoch)
                .bind(metrics.pixel_accuracy)
                .bind(metrics.miou)
                .bind(metrics.fw_iou)
                .bind(metrics.mean_class_accuracy)
                .bind(confusion_matrix_json)
                .execute(&mut *connect)
                .await
                .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;

                for (class_index, iou) in metrics.per_class_iou.iter().enumerate() {
                    sqlx::query(
                        "INSERT INTO segmentation_class_metrics (job_id,epoch,class_index,iou)VALUES (?,?,?,?)",
                    )
                    .bind(job_id.as_str())
                    .bind(epoch)
                    .bind(class_index as i64)
                    .bind(*iou)
                    .execute(&mut *connect)
                    .await
                    .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
                }
            }
            Some(Metrics::Classification(metrics)) => {
                sqlx::query(
                    "INSERT INTO classification_epoch_metrics (job_id,epoch,accuracy,macro_f1)VALUES (?,?,?,?)",
                )
                .bind(job_id.as_str())
                .bind(epoch)
                .bind(metrics.accuracy)
                .bind(metrics.macro_f1)
                .execute(&mut *connect)
                .await
                .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;

                for (class_index, accuracy) in metrics.per_class_accuracy.iter().enumerate() {
                    sqlx::query(
                        "INSERT INTO classification_class_metrics (job_id,epoch,class_index,accuracy)VALUES (?,?,?,?)",
                    )
                    .bind(job_id.as_str())
                    .bind(epoch)
                    .bind(class_index as i64)
                    .bind(*accuracy)
                    .execute(&mut *connect)
                    .await
                    .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
                }
            }
            None => {}
        }

        connect
            .commit()
            .await
            .map_err(|e| RepositoryError::TransactionFailed(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::model::layer::{ConcatSpec, Conv2DSpec, NodeSpec};
    use entities::model::{Node, NodeInput, PortRef};
    use sqlx::sqlite::SqlitePoolOptions;

    // インメモリDBは接続ごとに別のDBになるため、接続数を1に絞る
    async fn migrated_repository() -> SqliteTrainingRepository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./src/migrations").run(&pool).await.unwrap();
        SqliteTrainingRepository::new(pool)
    }

    fn sample_graph() -> ModelGraph {
        ModelGraph {
            nodes: vec![
                Node {
                    id: "conv".to_string(),
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
                    id: "cat".to_string(),
                    spec: NodeSpec::Concat(ConcatSpec),
                    inputs: vec![NodeInput {
                        port: "x0".to_string(),
                        source: Some(PortRef {
                            node_id: "conv".to_string(),
                            port: "y".to_string(),
                        }),
                    }],
                },
            ],
            outputs: vec![PortRef {
                node_id: "cat".to_string(),
                port: "y".to_string(),
            }],
        }
    }

    // 0001 → 0002 の順にマイグレーションが通り、insert_model で model_graph が保存されること
    #[tokio::test]
    async fn insert_model_stores_model_graph_json() {
        let repo = migrated_repository().await;
        let model_id = ModelId::new("model-1".to_string()).unwrap();
        let graph = sample_graph();

        repo.insert_model(&model_id, "unet", &graph).await.unwrap();

        let stored: Option<String> =
            sqlx::query_scalar("SELECT model_graph FROM model WHERE model_id = ?")
                .bind(model_id.as_str())
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        let restored = model::from_json(&stored.expect("model_graph should not be NULL")).unwrap();
        assert_eq!(restored, graph);
    }

    // 0002 適用前からある行(model_graph なし)は NULL のまま読めること
    #[tokio::test]
    async fn model_graph_is_nullable_for_existing_rows() {
        let repo = migrated_repository().await;
        sqlx::query("INSERT INTO model (model_id,model_name,created_at)VALUES (?,?,?)")
            .bind("old-model")
            .bind("old")
            .bind(Utc::now())
            .execute(&repo.pool)
            .await
            .unwrap();

        let stored: Option<String> =
            sqlx::query_scalar("SELECT model_graph FROM model WHERE model_id = 'old-model'")
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert!(stored.is_none());
    }
}
