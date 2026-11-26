use entities::{
    model::{ModelGraph, ModelId},
    training::{
        config::{DataSpec, TrainingConfig},
        JobId,
    },
    validation::ConfigViolation,
};
use tonic::{transport::Channel, Code, Status};
use usecases::training::{ModelGraphValidator, ModelGraphValidatorError, StartTrainingError};
use usecases::training::{TrainingResumer, TrainingStarter};

use crate::pb::training::v1::StartTrainingRequest as StartTrainingRequestPb;
use crate::pb::training::v1::{self as training_pb};
use training_pb::training_service_client::TrainingServiceClient;

pub struct GrpcTrainingStarter {
    client: TrainingServiceClient<Channel>, // gRPC通信をするためのフィールド. Channel型を指定することで、
}

impl GrpcTrainingStarter {
    pub fn new(channel: Channel) -> Self {
        Self {
            client: TrainingServiceClient::new(channel),
        }
    }
    async fn send(
        &self,
        config: &TrainingConfig,
        model_id: &ModelId,
        resume: bool,
    ) -> Result<JobId, StartTrainingError> {
        let mut request = StartTrainingRequestPb::from(config);
        request.model_id = model_id.as_str().to_string();
        request.resume = resume;
        let response = self
            .client
            .clone()
            .start_training(request)
            .await
            .map_err(start_error_from_status)?
            .into_inner(); // StartTrainingResponse

        JobId::new(response.job_id).map_err(|e| StartTrainingError::StartOrderFailed(e.to_string()))
    }
}

impl TrainingResumer for GrpcTrainingStarter {
    async fn resume_training(
        &self,
        config: &TrainingConfig,
        model_id: &ModelId,
    ) -> Result<JobId, StartTrainingError> {
        let resume: bool = true;
        self.send(config, model_id, resume).await
    }
}

impl TrainingStarter for GrpcTrainingStarter {
    async fn start_training(
        &self,
        config: &TrainingConfig,
        model_id: &ModelId,
    ) -> Result<JobId, StartTrainingError> {
        let resume: bool = false;
        self.send(config, model_id, resume).await
    }
}

// 学習開始前のグラフの検証。学習の開始と同じ学習エンジン(C++)への依頼なので、同じアダプターに持たせる
impl ModelGraphValidator for GrpcTrainingStarter {
    async fn validate_model_graph(
        &self,
        model_graph: &ModelGraph,
        data_spec: &DataSpec,
        dataset_path: &str,
    ) -> Result<Vec<ConfigViolation>, ModelGraphValidatorError> {
        let request = training_pb::ValidateModelGraphRequest {
            model_graph: Some(model_graph.into()),
            data_spec: Some(data_spec.into()),
            dataset_path: dataset_path.to_string(),
        };
        let response = self
            .client
            .clone()
            .validate_model_graph(request)
            .await
            .map_err(graph_check_error_from_status)?
            .into_inner();
        Ok(response
            .violations
            .iter()
            .map(config_violation_from_pb)
            .collect())
    }
}

// C++ が返す添字から、リクエストの JSON の位置(フロントが欄・ブロックを特定するのに使う)を組み立てる
fn config_violation_from_pb(violation: &training_pb::GraphViolation) -> ConfigViolation {
    let index = |i: &Option<training_pb::Index>| i.as_ref().map(|i| i.value);
    let field = match (
        index(&violation.node_index),
        index(&violation.input_index),
        index(&violation.output_index),
    ) {
        (Some(node), Some(input), _) => format!("model_graph.nodes[{node}].inputs[{input}]"),
        (Some(node), None, _) => format!("model_graph.nodes[{node}]"),
        (None, _, Some(output)) => format!("model_graph.outputs[{output}]"),
        // ノードが 1 つもない、閉路がある、など、グラフ全体の問題
        (None, _, None) => "model_graph".to_string(),
    };
    ConfigViolation {
        field,
        message: violation.message.clone(),
    }
}

fn graph_check_error_from_status(status: Status) -> ModelGraphValidatorError {
    match status.code() {
        // データセットの色表(labelmap.txt)が読めない
        Code::FailedPrecondition => ModelGraphValidatorError::DatasetUnreadable(status.to_string()),
        // 層のパラメータなどの Rust の検証漏れ、または C++ の内部の失敗
        Code::InvalidArgument | Code::Internal => {
            ModelGraphValidatorError::Rejected(status.to_string())
        }
        _ => ModelGraphValidatorError::CallFailed(status.to_string()),
    }
}

// FAILED_PRECONDITION の理由(C++ がトレーラーの error-reason に入れる。training.proto の TrainingService の説明)
const ERROR_REASON_KEY: &str = "error-reason";

fn error_reason(status: &Status) -> Option<&str> {
    status
        .metadata()
        .get(ERROR_REASON_KEY)
        .and_then(|value| value.to_str().ok())
}

fn start_error_from_status(status: Status) -> StartTrainingError {
    match status.code() {
        Code::FailedPrecondition => match error_reason(&status) {
            // モデルのグラフがこのデータセットでは学習できない。C++ のメッセージ(ノードと内容)を利用者に見せる
            Some("model_graph_mismatch") => {
                StartTrainingError::ModelGraphMismatch(status.message().to_string())
            }
            Some("dataset_unreadable") => StartTrainingError::DatasetUnreadable(status.to_string()),
            // resume_precondition(checkpointなし・エポック数が達している)。理由がない古い ai-engine も同じ扱い
            _ => StartTrainingError::ResumePreconditionFailed(status.to_string()),
        },
        Code::Aborted => StartTrainingError::AlreadyRunning(status.to_string()), // 別のjobがすでに動いている
        Code::InvalidArgument => StartTrainingError::EngineRejectedConfig(status.to_string()),
        _ => StartTrainingError::StartOrderFailed(status.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aborted_status_converts_to_already_running_error() {
        let error = start_error_from_status(Status::aborted("job is running"));
        assert!(matches!(error, StartTrainingError::AlreadyRunning(_)));
    }

    #[test]
    fn failed_precondition_status_converts_to_resume_precondition_failed_error() {
        let error = start_error_from_status(Status::failed_precondition("checkpoint not found"));
        assert!(matches!(
            error,
            StartTrainingError::ResumePreconditionFailed(_)
        ));
    }

    fn failed_precondition_with_reason(reason: &str, message: &str) -> Status {
        let mut metadata = tonic::metadata::MetadataMap::new();
        metadata.insert(ERROR_REASON_KEY, reason.parse().unwrap());
        Status::with_metadata(Code::FailedPrecondition, message, metadata)
    }

    #[test]
    fn failed_precondition_is_split_by_error_reason() {
        assert!(matches!(
            start_error_from_status(failed_precondition_with_reason(
                "resume_precondition",
                "checkpoint not found"
            )),
            StartTrainingError::ResumePreconditionFailed(_)
        ));
        // グラフの問題は、C++ のメッセージだけを持つ(status の表記を付けない。利用者に見せるため)
        assert_eq!(
            start_error_from_status(failed_precondition_with_reason(
                "model_graph_mismatch",
                "ノード 'head' のポート 'y': クラス数と一致しません"
            )),
            StartTrainingError::ModelGraphMismatch(
                "ノード 'head' のポート 'y': クラス数と一致しません".to_string()
            )
        );
        assert!(matches!(
            start_error_from_status(failed_precondition_with_reason(
                "dataset_unreadable",
                "labelmap.txt"
            )),
            StartTrainingError::DatasetUnreadable(_)
        ));
        // 知らない理由は、これまでどおり再開の条件として扱う
        assert!(matches!(
            start_error_from_status(failed_precondition_with_reason("unknown", "x")),
            StartTrainingError::ResumePreconditionFailed(_)
        ));
    }

    #[test]
    fn invalid_argument_status_converts_to_invalid_config_error() {
        let error = start_error_from_status(Status::invalid_argument("bad graph"));
        assert!(matches!(error, StartTrainingError::EngineRejectedConfig(_)));
    }

    #[test]
    fn other_status_converts_to_start_order_failed_error() {
        let error = start_error_from_status(Status::unavailable("server down"));
        assert!(matches!(error, StartTrainingError::StartOrderFailed(_)));
    }

    fn pb_violation(
        node: Option<u32>,
        input: Option<u32>,
        output: Option<u32>,
    ) -> training_pb::GraphViolation {
        let index = |v: Option<u32>| v.map(|value| training_pb::Index { value });
        training_pb::GraphViolation {
            node_index: index(node),
            input_index: index(input),
            output_index: index(output),
            message: "msg".to_string(),
        }
    }

    #[test]
    fn graph_violation_converts_indices_to_request_field() {
        let cases = [
            (pb_violation(Some(3), Some(1), None), "model_graph.nodes[3].inputs[1]"),
            (pb_violation(Some(3), None, None), "model_graph.nodes[3]"),
            (pb_violation(None, None, Some(0)), "model_graph.outputs[0]"),
            (pb_violation(None, None, None), "model_graph"),
            // 添字 0 も「該当なし」と区別する(Index で包んでいるため)
            (pb_violation(Some(0), Some(0), None), "model_graph.nodes[0].inputs[0]"),
        ];
        for (violation, expected) in cases {
            let converted = config_violation_from_pb(&violation);
            assert_eq!(converted.field, expected);
            assert_eq!(converted.message, "msg");
        }
    }

    #[test]
    fn graph_check_status_converts_to_validator_error() {
        assert!(matches!(
            graph_check_error_from_status(Status::failed_precondition("labelmap.txt")),
            ModelGraphValidatorError::DatasetUnreadable(_)
        ));
        assert!(matches!(
            graph_check_error_from_status(Status::invalid_argument("stride")),
            ModelGraphValidatorError::Rejected(_)
        ));
        assert!(matches!(
            graph_check_error_from_status(Status::internal("unexpected")),
            ModelGraphValidatorError::Rejected(_)
        ));
        assert!(matches!(
            graph_check_error_from_status(Status::unavailable("server down")),
            ModelGraphValidatorError::CallFailed(_)
        ));
    }
}
