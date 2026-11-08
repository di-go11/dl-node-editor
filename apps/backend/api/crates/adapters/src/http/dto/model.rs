use entities::model::{ModelGraph, ModelSummary, Node, NodeInput, PortRef};
use serde::{Deserialize, Serialize};

use super::layer::NodeSpecDto;

// ModelGraphのDTO
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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

// ModelSummaryのDTO(学習済みモデル一覧のレスポンス用)
// ModelId は値オブジェクトだが、JSON上では文字列として返す。
#[derive(Debug, Serialize)]
pub struct ModelSummaryDto {
    pub model_id: String,
    pub model_name: String,
    pub created_at: String,
}

impl From<&ModelSummary> for ModelSummaryDto {
    fn from(summary: &ModelSummary) -> Self {
        ModelSummaryDto {
            model_id: summary.model_id().as_str().to_string(),
            model_name: summary.model_name().to_string(),
            created_at: summary.created_at().to_string(),
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
