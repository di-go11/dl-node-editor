use entities::model::{ModelGraph, Node, NodeInput, PortRef};
use serde::Deserialize;

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
