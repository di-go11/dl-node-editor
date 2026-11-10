use entities::training::{ClassificationMetrics, Metrics, SegmentationMetrics, TrainingProcess};
use serde::Serialize;

use super::training_stop::TrainingJobStatusDto;

// TrainingProcess
#[derive(Debug, Serialize)]
pub struct TrainingProcessDto {
    pub epoch: u32,
    pub train_loss: f64,
    pub val_loss: f64,
    #[serde(flatten)]
    pub status: TrainingJobStatusDto,
    pub metrics: Option<MetricsDto>,
    pub epoch_elapsed_ms: u64,
    pub total_elapsed_ms: u64,
}

impl From<TrainingProcess> for TrainingProcessDto {
    fn from(value: TrainingProcess) -> Self {
        TrainingProcessDto {
            epoch: value.epoch,
            train_loss: value.train_loss,
            val_loss: value.val_loss,
            status: value.status.into(),
            metrics: value.metrics.map(Into::into),
            epoch_elapsed_ms: value.epoch_elapsed_time.as_millis() as u64,
            total_elapsed_ms: value.total_elapsed_time.as_millis() as u64,
        }
    }
}

// Metrics
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MetricsDto {
    Segmentation(SegmentationMetricsDto),
    Classification(ClassificationMetricsDto),
}

impl From<Metrics> for MetricsDto {
    fn from(value: Metrics) -> Self {
        match value {
            Metrics::Segmentation(metrics) => MetricsDto::Segmentation(metrics.into()),
            Metrics::Classification(metrics) => MetricsDto::Classification(metrics.into()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SegmentationMetricsDto {
    pub pixel_accuracy: f64,
    pub miou: f64,
    pub fw_iou: f64,
    pub mean_class_accuracy: f64,
    pub per_class_iou: Vec<f64>,
}

impl From<SegmentationMetrics> for SegmentationMetricsDto {
    fn from(value: SegmentationMetrics) -> Self {
        SegmentationMetricsDto {
            pixel_accuracy: value.pixel_accuracy,
            miou: value.miou,
            fw_iou: value.fw_iou,
            mean_class_accuracy: value.mean_class_accuracy,
            per_class_iou: value.per_class_iou,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ClassificationMetricsDto {
    pub accuracy: f64,
    pub macro_f1: f64,
    pub per_class_accuracy: Vec<f64>,
}

impl From<ClassificationMetrics> for ClassificationMetricsDto {
    fn from(value: ClassificationMetrics) -> Self {
        ClassificationMetricsDto {
            accuracy: value.accuracy,
            macro_f1: value.macro_f1,
            per_class_accuracy: value.per_class_accuracy,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::training::TrainingJobStatus;
    use serde_json::json;
    use std::time::Duration;

    // TrainingProcess が GUI に返す想定の JSON まで変換できること
    #[test]
    fn training_process_converts_to_json() {
        let process = TrainingProcess {
            epoch: 3,
            train_loss: 0.5,
            val_loss: 0.25,
            status: TrainingJobStatus::Running,
            metrics: Some(Metrics::Classification(ClassificationMetrics {
                accuracy: 0.75,
                macro_f1: 0.5,
                per_class_accuracy: vec![0.5, 1.0],
            })),
            epoch_elapsed_time: Duration::from_millis(1500),
            total_elapsed_time: Duration::from_secs(10),
        };

        let actual = serde_json::to_value(TrainingProcessDto::from(process)).unwrap();

        assert_eq!(
            actual,
            json!({
                "epoch": 3,
                "train_loss": 0.5,
                "val_loss": 0.25,
                "status": "running",
                "metrics": {
                    "type": "classification",
                    "accuracy": 0.75,
                    "macro_f1": 0.5,
                    "per_class_accuracy": [0.5, 1.0]
                },
                "epoch_elapsed_ms": 1500,
                "total_elapsed_ms": 10000
            })
        );
    }

    // 失敗理由と metrics なしの状態も JSON に反映されること
    #[test]
    fn failed_process_without_metrics_converts_to_json() {
        let process = TrainingProcess {
            epoch: 1,
            train_loss: 1.0,
            val_loss: 2.0,
            status: TrainingJobStatus::Failed {
                reason: "out of memory".to_string(),
            },
            metrics: None,
            epoch_elapsed_time: Duration::ZERO,
            total_elapsed_time: Duration::ZERO,
        };

        let actual = serde_json::to_value(TrainingProcessDto::from(process)).unwrap();

        assert_eq!(actual["status"], "failed");
        assert_eq!(actual["reason"], "out of memory");
        assert!(actual["metrics"].is_null());
    }

    #[test]
    fn segmentation_metrics_are_tagged_with_type() {
        let metrics = Metrics::Segmentation(SegmentationMetrics {
            pixel_accuracy: 0.5,
            miou: 0.25,
            fw_iou: 0.75,
            mean_class_accuracy: 0.5,
            per_class_iou: vec![0.25],
        });

        let actual = serde_json::to_value(MetricsDto::from(metrics)).unwrap();

        assert_eq!(
            actual,
            json!({
                "type": "segmentation",
                "pixel_accuracy": 0.5,
                "miou": 0.25,
                "fw_iou": 0.75,
                "mean_class_accuracy": 0.5,
                "per_class_iou": [0.25]
            })
        );
    }
}
