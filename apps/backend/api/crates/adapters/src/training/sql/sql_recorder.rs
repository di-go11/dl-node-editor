use super::SqliteTrainingRepository;
use chrono::Utc;
use entities::training::config::{
    DataSpec, ImageAnnotationConfig, ImageTaskSpec, Loss, Optimizer, TrainingConfig,
};
use entities::training::JobId;
use entities::training::Metrics;
use entities::training::ModelId;
use entities::training::TrainingJobStatus;
use entities::training::TrainingProcess;
use sqlx::SqlitePool;
use usecases::training::{
    RepositoryError, TrainingProgressRecorder, TrainingResultRegister, TrainingRunRegistar,
};
// 学習実行情報をDBへ保存する処理3つ
impl TrainingRunRegistar for SqliteTrainingRepository {
    async fn insert_model(
        &self,
        model_id: &ModelId,
        model_name: &str,
    ) -> Result<(), RepositoryError> {
        // TODO: ModelGraphのJSON化を実装したらmodel_graphもinsertする
        sqlx::query("INSERT INTO model (model_id,model_name,created_at)VALUES (?,?,?)")
            .bind(model_id.as_str())
            .bind(model_name)
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
    ) -> Result<(), RepositoryError> {
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
        let (task_type, ignore_index) = match &image_spec.image_task_spec {
            ImageTaskSpec::Classification => ("classification", None),
            ImageTaskSpec::Segmentation(spec) => ("segmentation", Some(spec.ignore_index)),
        };
        let (annotation_type, include_difficult) = match &image_spec.image_annotation_config {
            ImageAnnotationConfig::PascalVoc(spec) => ("pascal_voc", Some(spec.include_difficult)),
        };

        // training_configはtraining_runsを外部キーで参照するため、後にinsertする
        sqlx::query(
            "INSERT INTO training_config (job_id,epochs,batch,device,dataset_path,save_last_every,resume_from,seed,optimizer_type,learning_rate,weight_decay,beta1,beta2,eps,momentum,nesterov,loss_type,loss_gamma,loss_alpha,data_type,input_width,input_height,task_type,ignore_index,annotation_type,include_difficult)VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
    ) -> Result<(), RepositoryError> {
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
    ) -> Result<(), RepositoryError> {
        let epoch_elapsed_ms = i64::try_from(process.epoch_elapsed_time.as_millis())
            .map_err(|e| RepositoryError::InvalidData(e.to_string()))?;
        let mut connect = self
            .pool
            .begin()
            .await
            .map_err(|e| RepositoryError::ConnectionFailed(e.to_string()))?;

        // メトリクスのテーブルが外部キーで参照するため、training_epochsを先にinsertする
        sqlx::query(
            "INSERT INTO training_epochs (job_id,epoch,train_loss,val_loss,epoch_elapsed_ms)VALUES (?,?,?,?,?)",
        )
        .bind(job_id.as_str())
        .bind(epoch)
        .bind(process.train_loss)
        .bind(process.val_loss)
        .bind(epoch_elapsed_ms)
        .execute(&mut *connect)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;

        match &process.metrics {
            Some(Metrics::Segmentation(metrics)) => {
                sqlx::query(
                    "INSERT INTO segmentation_epoch_metrics (job_id,epoch,pixel_accuracy,miou,fw_iou,mean_class_accuracy)VALUES (?,?,?,?,?,?)",
                )
                .bind(job_id.as_str())
                .bind(epoch)
                .bind(metrics.pixel_accuracy)
                .bind(metrics.miou)
                .bind(metrics.fw_iou)
                .bind(metrics.mean_class_accuracy)
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
