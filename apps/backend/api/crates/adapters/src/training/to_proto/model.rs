// ModelGraph関連のドメインをprotoに変換するためのトレイト実装
use crate::pb::model::v1 as model_pb;

use entities::model::layer::NodeSpec;
use entities::model::{ModelGraph, Node, NodeInput, PortRef};

impl From<&ModelGraph> for model_pb::ModelGraph {
    fn from(value: &ModelGraph) -> Self {
        model_pb::ModelGraph {
            // Vec の要素を1つずつ From で変換して、Vec に集め直す
            nodes: value.nodes.iter().map(model_pb::Node::from).collect(),
            outputs: value.outputs.iter().map(model_pb::PortRef::from).collect(),
        }
    }
}

impl From<&Node> for model_pb::Node {
    fn from(value: &Node) -> Self {
        model_pb::Node {
            id: value.id.clone(),
            spec: Some((&value.spec).into()),
            inputs: value.inputs.iter().map(model_pb::NodeInput::from).collect(),
        }
    }
}

impl From<&PortRef> for model_pb::PortRef {
    fn from(value: &PortRef) -> Self {
        model_pb::PortRef {
            node_id: value.node_id.clone(),
            port: value.port.clone(),
        }
    }
}

impl From<&NodeInput> for model_pb::NodeInput {
    fn from(value: &NodeInput) -> Self {
        model_pb::NodeInput {
            port: value.port.clone(),
            source: match &value.source {
                Some(port_ref) => Some((port_ref).into()),
                None => None,
            },
        }
    }
}

// Nodeにlayerの機能を持たせるためのトレイト実装
// 各層の Spec の変換は layer.rs にある
impl From<&NodeSpec> for model_pb::NodeSpec {
    fn from(value: &NodeSpec) -> Self {
        use model_pb::node_spec::Params;
        let params = match value {
            NodeSpec::Conv2D(spec) => Params::Conv2d(spec.into()),
            NodeSpec::Pooling2D(spec) => Params::Pooling2d(spec.into()),
            NodeSpec::BatchNorm(spec) => Params::BatchNorm(spec.into()),
            NodeSpec::Linear(spec) => Params::Linear(spec.into()),
            NodeSpec::Activation(spec) => Params::Activation(spec.into()),
            NodeSpec::IndexedPooling(spec) => Params::IndexedPooling(spec.into()),
            NodeSpec::Unpooling(spec) => Params::Unpooling(spec.into()),
            NodeSpec::Upsample(spec) => Params::Upsample(spec.into()),
            NodeSpec::Add(spec) => Params::Add(spec.into()),
            NodeSpec::Concat(spec) => Params::Concat(spec.into()),
        };
        model_pb::NodeSpec {
            params: Some(params),
        }
    }
}
