use entities::model::{EpochRecord, ModelHistory, RunRecord};
use serde::Serialize;

use super::training_process::MetricsDto;
use super::training_stop::TrainingJobStatusDto;

// GET /models/{model_id}/history の応答。モデルの全 run の、エポックごとの結果
#[derive(Debug, Serialize)]
pub struct ModelHistoryDto {
    pub model_id: String,
    pub model_name: String,
    // 学習を始めた順
    pub runs: Vec<RunRecordDto>,
    // run の順、run の中はエポックの順。エポック番号は再開をまたいで続く(同じ番号が 2 つの run にあることもある)
    pub epochs: Vec<EpochRecordDto>,
}

#[derive(Debug, Serialize)]
pub struct RunRecordDto {
    pub job_id: String,
    // "status": "failed", "reason": "..." のように同じ階層に並ぶ(進捗・一覧と同じ)
    #[serde(flatten)]
    pub status: TrainingJobStatusDto,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EpochRecordDto {
    pub job_id: String,
    pub epoch: u32,
    // NaN・inf・記録なしは null
    pub train_loss: Option<f64>,
    pub val_loss: Option<f64>,
    // 0005 より前に記録したエポックは null
    pub learning_rate: Option<f64>,
    pub epoch_elapsed_ms: u64,
    // 進捗(SSE)の metrics と同じ形。記録していないエポックは null
    pub metrics: Option<MetricsDto>,
}

impl From<RunRecord> for RunRecordDto {
    fn from(value: RunRecord) -> Self {
        RunRecordDto {
            job_id: value.job_id.as_str().to_string(),
            status: value.status.into(),
            started_at: value.started_at,
            finished_at: value.finished_at,
        }
    }
}

impl From<EpochRecord> for EpochRecordDto {
    fn from(value: EpochRecord) -> Self {
        EpochRecordDto {
            job_id: value.job_id.as_str().to_string(),
            epoch: value.epoch,
            train_loss: value.train_loss,
            val_loss: value.val_loss,
            learning_rate: value.learning_rate,
            epoch_elapsed_ms: value.epoch_elapsed_ms,
            metrics: value.metrics.map(Into::into),
        }
    }
}

impl From<ModelHistory> for ModelHistoryDto {
    fn from(value: ModelHistory) -> Self {
        ModelHistoryDto {
            model_id: value.model_id.as_str().to_string(),
            model_name: value.model_name,
            runs: value.runs.into_iter().map(Into::into).collect(),
            epochs: value.epochs.into_iter().map(Into::into).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::model::ModelId;
    use entities::training::{JobId, Metrics, SegmentationMetrics, TrainingJobStatus};
    use serde_json::json;

    #[test]
    fn history_json_shape() {
        let history = ModelHistory {
            model_id: ModelId::new("model-1").unwrap(),
            model_name: "seg".to_string(),
            runs: vec![RunRecord {
                job_id: JobId::new("job-1").unwrap(),
                status: TrainingJobStatus::Completed,
                started_at: "2026-11-26T00:00:00Z".to_string(),
                finished_at: Some("2026-11-26T01:00:00Z".to_string()),
            }],
            epochs: vec![EpochRecord {
                job_id: JobId::new("job-1").unwrap(),
                epoch: 1,
                train_loss: Some(0.5),
                val_loss: None,
                learning_rate: Some(0.001),
                epoch_elapsed_ms: 1200,
                metrics: Some(Metrics::Segmentation(SegmentationMetrics {
                    pixel_accuracy: 0.9,
                    miou: 0.5,
                    fw_iou: 0.75,
                    mean_class_accuracy: 0.5,
                    per_class_iou: vec![0.25],
                })),
            }],
        };

        let actual = serde_json::to_value(ModelHistoryDto::from(history)).unwrap();

        assert_eq!(
            actual,
            json!({
                "model_id": "model-1",
                "model_name": "seg",
                "runs": [{
                    "job_id": "job-1",
                    "status": "completed",
                    "started_at": "2026-11-26T00:00:00Z",
                    "finished_at": "2026-11-26T01:00:00Z"
                }],
                "epochs": [{
                    "job_id": "job-1",
                    "epoch": 1,
                    "train_loss": 0.5,
                    "val_loss": null,
                    "learning_rate": 0.001,
                    "epoch_elapsed_ms": 1200,
                    "metrics": {
                        "type": "segmentation",
                        "pixel_accuracy": 0.9,
                        "miou": 0.5,
                        "fw_iou": 0.75,
                        "mean_class_accuracy": 0.5,
                        "per_class_iou": [0.25]
                    }
                }]
            })
        );
    }
}
