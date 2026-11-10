use entities::model::{
    LastRunSummary, ModelGraph, ModelSummary, ModelTaskType, Node, NodeInput, PortRef,
};
use serde::{Deserialize, Serialize};

use super::layer::NodeSpecDto;
use super::training_stop::TrainingJobStatusDto;

// ModelGraphのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct ModelGraphDto {
    pub nodes: Vec<NodeDto>,
    pub outputs: Vec<PortRefDto>,
}

impl From<ModelGraphDto> for ModelGraph {
    fn from(value: ModelGraphDto) -> Self {
        ModelGraph {
            nodes: value.nodes.into_iter().map(Into::into).collect(),
            outputs: value.outputs.into_iter().map(Into::into).collect(),
        }
    }
}

// NodeのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct NodeDto {
    pub id: String,
    pub spec: NodeSpecDto,
    pub inputs: Vec<NodeInputDto>,
}

impl From<NodeDto> for Node {
    fn from(value: NodeDto) -> Self {
        Node {
            id: value.id,
            spec: value.spec.into(),
            inputs: value.inputs.into_iter().map(Into::into).collect(),
        }
    }
}

// PortRefのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct PortRefDto {
    pub node_id: String,
    pub port: String,
}

impl From<PortRefDto> for PortRef {
    fn from(value: PortRefDto) -> Self {
        PortRef {
            node_id: value.node_id,
            port: value.port,
        }
    }
}

// NodeInputのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct NodeInputDto {
    pub port: String,
    pub source: Option<PortRefDto>, // Noneの場合は、グラフ入力につなぐ
}

impl From<NodeInputDto> for NodeInput {
    fn from(value: NodeInputDto) -> Self {
        NodeInput {
            port: value.port,
            source: value.source.map(Into::into),
        }
    }
}

// ===== entity -> DTO(GET /models/{model_id}/config の応答用) =====

impl From<ModelGraph> for ModelGraphDto {
    fn from(value: ModelGraph) -> Self {
        ModelGraphDto {
            nodes: value.nodes.into_iter().map(Into::into).collect(),
            outputs: value.outputs.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<Node> for NodeDto {
    fn from(value: Node) -> Self {
        NodeDto {
            id: value.id,
            spec: value.spec.into(),
            inputs: value.inputs.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<PortRef> for PortRefDto {
    fn from(value: PortRef) -> Self {
        PortRefDto {
            node_id: value.node_id,
            port: value.port,
        }
    }
}

impl From<NodeInput> for NodeInputDto {
    fn from(value: NodeInput) -> Self {
        NodeInputDto {
            port: value.port,
            source: value.source.map(Into::into),
        }
    }
}

// ModelSummaryのDTO(学習済みモデル一覧のレスポンス用)
// ModelId は値オブジェクトだが、JSON上では文字列として返す。
#[derive(Debug, Serialize)]
pub struct ModelSummaryDto {
    pub model_id: String,
    pub model_name: String,
    pub created_at: String,
    pub task_type: ModelTaskTypeDto,
    pub last_run: LastRunSummaryDto,
    pub completed_epochs: u32,
    pub resumable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelTaskTypeDto {
    Segmentation,
    Classification,
}

impl From<ModelTaskType> for ModelTaskTypeDto {
    fn from(value: ModelTaskType) -> Self {
        match value {
            ModelTaskType::Segmentation => ModelTaskTypeDto::Segmentation,
            ModelTaskType::Classification => ModelTaskTypeDto::Classification,
        }
    }
}

// 最新の run。状態は GET /trainings/{job_id}/status と同じ形({ "status": ..., "reason": ... })で並べる
#[derive(Debug, Serialize)]
pub struct LastRunSummaryDto {
    #[serde(flatten)]
    pub status: TrainingJobStatusDto,
    pub started_at: String,
    // 終了を記録できていなければ null
    pub finished_at: Option<String>,
}

impl From<&LastRunSummary> for LastRunSummaryDto {
    fn from(value: &LastRunSummary) -> Self {
        LastRunSummaryDto {
            status: value.status.clone().into(),
            started_at: value.started_at.clone(),
            finished_at: value.finished_at.clone(),
        }
    }
}

impl From<&ModelSummary> for ModelSummaryDto {
    fn from(summary: &ModelSummary) -> Self {
        ModelSummaryDto {
            model_id: summary.model_id().as_str().to_string(),
            model_name: summary.model_name().to_string(),
            created_at: summary.created_at().to_string(),
            task_type: summary.task_type().into(),
            last_run: summary.last_run().into(),
            completed_epochs: summary.completed_epochs(),
            resumable: summary.resumable(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ModelSummariesDto {
    pub models: Vec<ModelSummaryDto>,
}

impl From<&[ModelSummary]> for ModelSummariesDto {
    fn from(summaries: &[ModelSummary]) -> Self {
        Self {
            models: summaries.iter().map(ModelSummaryDto::from).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::model::ModelId;
    use entities::training::TrainingJobStatus;

    // 一覧の要素は、最新の run の状態を status / reason と日時が同じ階層に並ぶ形で返すこと
    #[test]
    fn summary_json_shape() {
        let summary = ModelSummary::new(
            ModelId::new("model-1").unwrap(),
            "segnet",
            "2026-11-01 00:00:00",
            ModelTaskType::Segmentation,
            LastRunSummary {
                status: TrainingJobStatus::Failed {
                    reason: "out of memory".to_string(),
                },
                started_at: "2026-11-02 00:00:00".to_string(),
                finished_at: None,
            },
            5,
            true,
        );

        let json = serde_json::to_value(ModelSummariesDto::from([summary].as_slice())).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "models": [{
                    "model_id": "model-1",
                    "model_name": "segnet",
                    "created_at": "2026-11-01 00:00:00",
                    "task_type": "segmentation",
                    "last_run": {
                        "status": "failed",
                        "reason": "out of memory",
                        "started_at": "2026-11-02 00:00:00",
                        "finished_at": null
                    },
                    "completed_epochs": 5,
                    "resumable": true
                }]
            })
        );
    }
}
