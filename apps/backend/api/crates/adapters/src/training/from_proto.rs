// StreamProcessResponseをTrainingProcessに変換するためのTryFrom実装
use crate::pb::training::v1 as pb;
use entities::training::{
    ClassificationMetrics, Metrics, SegmentationMetrics, TrainingJobStatus, TrainingProcess,
};
use std::time::Duration;

use super::error::TrainingConversionError;

impl From<pb::stream_progress_response::Metrics> for Metrics {
    fn from(value: pb::stream_progress_response::Metrics) -> Self {
        use pb::stream_progress_response::Metrics as pbMetrics;
        match value {
            pbMetrics::Classification(m) => Metrics::Classification(m.into()),
            pbMetrics::Segmentation(m) => Metrics::Segmentation(m.into()),
        }
    }
}

impl From<pb::SegmentationMetrics> for SegmentationMetrics {
    fn from(value: pb::SegmentationMetrics) -> Self {
        Self {
            pixel_accuracy: value.pixel_acc,
            miou: value.miou,
            fw_iou: value.fw_iou,
            mean_class_accuracy: value.mean_class_accuracy,
            per_class_accuracy: value.per_class_iou,
        }
    }
}

impl From<pb::ClassificationMetrics> for ClassificationMetrics {
    fn from(value: pb::ClassificationMetrics) -> Self {
        Self {
            accuracy: value.accuracy,
            macro_f1: value.macro_f1,
            per_class_f1: value.per_class_accuracy,
        }
    }
}

impl TryFrom<pb::StreamProgressResponse> for TrainingProcess {
    type Error = TrainingConversionError;
    fn try_from(value: pb::StreamProgressResponse) -> Result<Self, Self::Error> {
        let status = pb::TrainingStatus::try_from(value.status)
            .map_err(|_| TrainingConversionError::UnknownTrainingStatus(value.status))?;
        let status = match status {
            pb::TrainingStatus::Idle => TrainingJobStatus::Idle,
            pb::TrainingStatus::Running => TrainingJobStatus::Running,
            pb::TrainingStatus::Completed => TrainingJobStatus::Completed,
            pb::TrainingStatus::Failed => TrainingJobStatus::Failed {
                reason: value.error_message.clone(),
            },
            pb::TrainingStatus::Stopped => TrainingJobStatus::Stopped,
            pb::TrainingStatus::Unspecified => {
                return Err(TrainingConversionError::UnspecifiedJobStatusType);
            }
        };
        Ok(TrainingProcess {
            epoch: value.epoch,
            train_loss: value.train_loss,
            val_loss: value.val_loss,
            status,
            metrics: value.metrics.map(Metrics::from),
            epoch_elapsed_time: Duration::from_millis(value.epoch_elapsed_ms),
            total_elapsed_time: Duration::from_millis(value.total_elapsed_ms),
        })
    }
}

// 各テストモジュールで共通に使う、正常なレスポンス。
// テストごとに検証したいフィールドだけを構造体更新構文(..valid_response())で上書きする
#[cfg(test)]
fn valid_response() -> pb::StreamProgressResponse {
    pb::StreamProgressResponse {
        epoch: 1,
        train_loss: 0.5,
        val_loss: 0.4,
        status: pb::TrainingStatus::Running as i32,
        metrics: None,
        epoch_elapsed_ms: 1000,
        total_elapsed_ms: 2000,
        error_message: String::new(),
    }
}

#[cfg(test)]
mod status_tests {
    use super::*;

    fn test_try_from(
        status: i32,
        expected: Result<TrainingJobStatus, TrainingConversionError>,
    ) {
        let response = pb::StreamProgressResponse {
            status,
            ..valid_response()
        };
        let result = TrainingProcess::try_from(response).map(|process| process.status);
        assert_eq!(result, expected);
    }

    // 正常系
    #[test]
    fn idle_converts_to_domain_idle() {
        test_try_from(pb::TrainingStatus::Idle as i32, Ok(TrainingJobStatus::Idle));
    }

    #[test]
    fn running_converts_to_domain_running() {
        test_try_from(
            pb::TrainingStatus::Running as i32,
            Ok(TrainingJobStatus::Running),
        );
    }

    #[test]
    fn completed_converts_to_domain_completed() {
        test_try_from(
            pb::TrainingStatus::Completed as i32,
            Ok(TrainingJobStatus::Completed),
        );
    }

    #[test]
    fn stopped_converts_to_domain_stopped() {
        test_try_from(
            pb::TrainingStatus::Stopped as i32,
            Ok(TrainingJobStatus::Stopped),
        );
    }

    // Failed は status だけでなく error_message も使って組み立てるので、個別に検証する
    #[test]
    fn failed_carries_error_message_as_reason() {
        let response = pb::StreamProgressResponse {
            status: pb::TrainingStatus::Failed as i32,
            error_message: "CUDA out of memory".to_string(),
            ..valid_response()
        };
        let result = TrainingProcess::try_from(response).map(|process| process.status);
        assert_eq!(
            result,
            Ok(TrainingJobStatus::Failed {
                reason: "CUDA out of memory".to_string(),
            })
        );
    }

    // 異常系
    #[test]
    fn unspecified_is_rejected() {
        test_try_from(
            pb::TrainingStatus::Unspecified as i32,
            Err(TrainingConversionError::UnspecifiedJobStatusType),
        );
    }

    #[test]
    fn unknown_status_is_rejected() {
        test_try_from(99, Err(TrainingConversionError::UnknownTrainingStatus(99)));
    }
}

#[cfg(test)]
mod training_process_tests {
    use super::*;

    // 正常系
    #[test]
    fn valid_response_converts_to_training_process() {
        assert_eq!(
            TrainingProcess::try_from(valid_response()),
            Ok(TrainingProcess {
                epoch: 1,
                train_loss: 0.5,
                val_loss: 0.4,
                status: TrainingJobStatus::Running,
                metrics: None,
                epoch_elapsed_time: Duration::from_millis(1000),
                total_elapsed_time: Duration::from_millis(2000),
            })
        );
    }

    #[test]
    fn elapsed_ms_converts_to_duration() {
        let response = pb::StreamProgressResponse {
            epoch_elapsed_ms: 1_500,
            total_elapsed_ms: 90_000,
            ..valid_response()
        };
        let process = TrainingProcess::try_from(response).unwrap();
        assert_eq!(process.epoch_elapsed_time, Duration::from_secs_f64(1.5));
        assert_eq!(process.total_elapsed_time, Duration::from_secs(90));
    }
}

#[cfg(test)]
mod metrics_tests {
    use super::*;
    use pb::stream_progress_response::Metrics as PbMetrics;

    fn test_try_from(metrics: Option<PbMetrics>, expected: Option<Metrics>) {
        let response = pb::StreamProgressResponse {
            metrics,
            ..valid_response()
        };
        let result = TrainingProcess::try_from(response).map(|process| process.metrics);
        assert_eq!(result, Ok(expected));
    }

    // 正常系
    #[test]
    fn missing_metrics_stays_none() {
        test_try_from(None, None);
    }

    // 各フィールドに異なる値を入れて、フィールドの取り違えも検出できるようにする
    #[test]
    fn segmentation_metrics_converts_to_domain_segmentation() {
        test_try_from(
            Some(PbMetrics::Segmentation(pb::SegmentationMetrics {
                pixel_acc: 0.9,
                miou: 0.7,
                fw_iou: 0.8,
                mean_class_accuracy: 0.75,
                per_class_iou: vec![0.6, 0.8],
            })),
            Some(Metrics::Segmentation(SegmentationMetrics {
                pixel_accuracy: 0.9,
                miou: 0.7,
                fw_iou: 0.8,
                mean_class_accuracy: 0.75,
                // 現状の対応付け(proto の per_class_iou → per_class_accuracy)。指標名の不一致は要検討
                per_class_accuracy: vec![0.6, 0.8],
            })),
        );
    }

    #[test]
    fn classification_metrics_converts_to_domain_classification() {
        test_try_from(
            Some(PbMetrics::Classification(pb::ClassificationMetrics {
                accuracy: 0.95,
                macro_f1: 0.85,
                per_class_accuracy: vec![0.9, 1.0],
            })),
            Some(Metrics::Classification(ClassificationMetrics {
                accuracy: 0.95,
                macro_f1: 0.85,
                // 現状の対応付け(proto の per_class_accuracy → per_class_f1)。指標名の不一致は要検討
                per_class_f1: vec![0.9, 1.0],
            })),
        );
    }
}
