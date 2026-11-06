// ModelGraph を DB(model.model_graph 列)に保存するための JSON 変換。
// HTTP の DTO(http/dto/model.rs, layer.rs)とは意図的に分けている。
// API の形を変えても、保存済みの JSON は昔の形のまま読めるようにするため。
// そのため、このファイルの Stored* のフィールド名・タグ名を変えるときは、保存済みデータの移行が必要になる。
use entities::model::layer::{
    ActivationSpec, ActivationType, AddSpec, BatchNormalizerSpec, ConcatSpec, Conv2DSpec,
    IndexedPoolingSpec, LinearSpec, NodeSpec, Pooling2DSpec, PoolingType, UnpoolingSpec,
    UpsampleMode, UpsampleSpec,
};
use entities::model::{ModelGraph, Node, NodeInput, PortRef};
use serde::{Deserialize, Serialize};

// 外に出すのはこの2つだけ。Stored* の構造体は sql 側から見えないようにする。
pub fn to_json(graph: &ModelGraph) -> Result<String, serde_json::Error> {
    serde_json::to_string(&StoredModelGraph::from(graph))
}

#[allow(dead_code)] // 作業 5(学習再開)で model_graph を読み出すときに使う
pub fn from_json(json: &str) -> Result<ModelGraph, serde_json::Error> {
    serde_json::from_str::<StoredModelGraph>(json).map(ModelGraph::from)
}

// ===== グラフ =====

#[derive(Debug, Serialize, Deserialize)]
struct StoredModelGraph {
    nodes: Vec<StoredNode>,
    outputs: Vec<StoredPortRef>,
}

impl From<&ModelGraph> for StoredModelGraph {
    fn from(value: &ModelGraph) -> Self {
        Self {
            nodes: value.nodes.iter().map(StoredNode::from).collect(),
            outputs: value.outputs.iter().map(StoredPortRef::from).collect(),
        }
    }
}

impl From<StoredModelGraph> for ModelGraph {
    fn from(value: StoredModelGraph) -> Self {
        Self {
            nodes: value.nodes.into_iter().map(Into::into).collect(),
            outputs: value.outputs.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredNode {
    id: String,
    spec: StoredNodeSpec,
    inputs: Vec<StoredNodeInput>,
}

impl From<&Node> for StoredNode {
    fn from(value: &Node) -> Self {
        Self {
            id: value.id.clone(),
            spec: (&value.spec).into(),
            inputs: value.inputs.iter().map(StoredNodeInput::from).collect(),
        }
    }
}

impl From<StoredNode> for Node {
    fn from(value: StoredNode) -> Self {
        Self {
            id: value.id,
            spec: value.spec.into(),
            inputs: value.inputs.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredPortRef {
    node_id: String,
    port: String,
}

impl From<&PortRef> for StoredPortRef {
    fn from(value: &PortRef) -> Self {
        Self {
            node_id: value.node_id.clone(),
            port: value.port.clone(),
        }
    }
}

impl From<StoredPortRef> for PortRef {
    fn from(value: StoredPortRef) -> Self {
        Self {
            node_id: value.node_id,
            port: value.port,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredNodeInput {
    port: String,
    source: Option<StoredPortRef>, // None はグラフ入力につなぐ
}

impl From<&NodeInput> for StoredNodeInput {
    fn from(value: &NodeInput) -> Self {
        Self {
            port: value.port.clone(),
            source: value.source.as_ref().map(StoredPortRef::from),
        }
    }
}

impl From<StoredNodeInput> for NodeInput {
    fn from(value: StoredNodeInput) -> Self {
        Self {
            port: value.port,
            source: value.source.map(Into::into),
        }
    }
}

// ===== レイヤー =====

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StoredNodeSpec {
    // snake_case のままだと "conv2_d" になるので個別に指定する
    #[serde(rename = "conv2d")]
    Conv2D(StoredConv2DSpec),
    #[serde(rename = "pooling2d")]
    Pooling2D(StoredPooling2DSpec),
    BatchNorm(StoredBatchNormalizerSpec),
    Linear(StoredLinearSpec),
    Activation(StoredActivationSpec),
    IndexedPooling(StoredIndexedPoolingSpec),
    Unpooling(StoredUnpoolingSpec),
    Upsample(StoredUpsampleSpec),
    Add(StoredAddSpec),
    Concat, // パラメータはない
}

impl From<&NodeSpec> for StoredNodeSpec {
    fn from(value: &NodeSpec) -> Self {
        match value {
            NodeSpec::Conv2D(spec) => Self::Conv2D(spec.into()),
            NodeSpec::Pooling2D(spec) => Self::Pooling2D(spec.into()),
            NodeSpec::BatchNorm(spec) => Self::BatchNorm(spec.into()),
            NodeSpec::Linear(spec) => Self::Linear(spec.into()),
            NodeSpec::Activation(spec) => Self::Activation(spec.into()),
            NodeSpec::IndexedPooling(spec) => Self::IndexedPooling(spec.into()),
            NodeSpec::Unpooling(spec) => Self::Unpooling(spec.into()),
            NodeSpec::Upsample(spec) => Self::Upsample(spec.into()),
            NodeSpec::Add(spec) => Self::Add(spec.into()),
            NodeSpec::Concat(ConcatSpec) => Self::Concat,
        }
    }
}

impl From<StoredNodeSpec> for NodeSpec {
    fn from(value: StoredNodeSpec) -> Self {
        match value {
            StoredNodeSpec::Conv2D(spec) => Self::Conv2D(spec.into()),
            StoredNodeSpec::Pooling2D(spec) => Self::Pooling2D(spec.into()),
            StoredNodeSpec::BatchNorm(spec) => Self::BatchNorm(spec.into()),
            StoredNodeSpec::Linear(spec) => Self::Linear(spec.into()),
            StoredNodeSpec::Activation(spec) => Self::Activation(spec.into()),
            StoredNodeSpec::IndexedPooling(spec) => Self::IndexedPooling(spec.into()),
            StoredNodeSpec::Unpooling(spec) => Self::Unpooling(spec.into()),
            StoredNodeSpec::Upsample(spec) => Self::Upsample(spec.into()),
            StoredNodeSpec::Add(spec) => Self::Add(spec.into()),
            StoredNodeSpec::Concat => Self::Concat(ConcatSpec),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredConv2DSpec {
    in_channels: i64,
    out_channels: i64,
    kernel_size: i64,
    stride: i64,
    padding: i64,
    dilation: i64,
}

impl From<&Conv2DSpec> for StoredConv2DSpec {
    fn from(value: &Conv2DSpec) -> Self {
        Self {
            in_channels: value.in_channels,
            out_channels: value.out_channels,
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
            dilation: value.dilation,
        }
    }
}

impl From<StoredConv2DSpec> for Conv2DSpec {
    fn from(value: StoredConv2DSpec) -> Self {
        Self {
            in_channels: value.in_channels,
            out_channels: value.out_channels,
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
            dilation: value.dilation,
        }
    }
}

// HTTP の DTO と違い unspecified も持つ。
// エンティティが持ちうる値はすべて保存できるようにし、変換を失敗させないため。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StoredPoolingType {
    Unspecified,
    Max,
    Average,
}

impl From<&PoolingType> for StoredPoolingType {
    fn from(value: &PoolingType) -> Self {
        match value {
            PoolingType::Unspecified => Self::Unspecified,
            PoolingType::Max => Self::Max,
            PoolingType::Average => Self::Average,
        }
    }
}

impl From<StoredPoolingType> for PoolingType {
    fn from(value: StoredPoolingType) -> Self {
        match value {
            StoredPoolingType::Unspecified => Self::Unspecified,
            StoredPoolingType::Max => Self::Max,
            StoredPoolingType::Average => Self::Average,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredPooling2DSpec {
    pooling_type: StoredPoolingType,
    kernel_size: i64,
    stride: i64,
    padding: i64,
}

impl From<&Pooling2DSpec> for StoredPooling2DSpec {
    fn from(value: &Pooling2DSpec) -> Self {
        Self {
            pooling_type: (&value.pooling_type).into(),
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<StoredPooling2DSpec> for Pooling2DSpec {
    fn from(value: StoredPooling2DSpec) -> Self {
        Self {
            pooling_type: value.pooling_type.into(),
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredBatchNormalizerSpec {
    num_features: i64,
    eps: f64,
    momentum: f64,
}

impl From<&BatchNormalizerSpec> for StoredBatchNormalizerSpec {
    fn from(value: &BatchNormalizerSpec) -> Self {
        Self {
            num_features: value.num_features,
            eps: value.eps,
            momentum: value.momentum,
        }
    }
}

impl From<StoredBatchNormalizerSpec> for BatchNormalizerSpec {
    fn from(value: StoredBatchNormalizerSpec) -> Self {
        Self {
            num_features: value.num_features,
            eps: value.eps,
            momentum: value.momentum,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredLinearSpec {
    in_features: i64,
    out_features: i64,
    bias: bool,
}

impl From<&LinearSpec> for StoredLinearSpec {
    fn from(value: &LinearSpec) -> Self {
        Self {
            in_features: value.in_features,
            out_features: value.out_features,
            bias: value.bias,
        }
    }
}

impl From<StoredLinearSpec> for LinearSpec {
    fn from(value: StoredLinearSpec) -> Self {
        Self {
            in_features: value.in_features,
            out_features: value.out_features,
            bias: value.bias,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StoredActivationType {
    Unspecified,
    Relu,
    Sigmoid,
    Softmax,
    Tanh,
}

impl From<&ActivationType> for StoredActivationType {
    fn from(value: &ActivationType) -> Self {
        match value {
            ActivationType::Unspecified => Self::Unspecified,
            ActivationType::Relu => Self::Relu,
            ActivationType::Sigmoid => Self::Sigmoid,
            ActivationType::Softmax => Self::Softmax,
            ActivationType::Tanh => Self::Tanh,
        }
    }
}

impl From<StoredActivationType> for ActivationType {
    fn from(value: StoredActivationType) -> Self {
        match value {
            StoredActivationType::Unspecified => Self::Unspecified,
            StoredActivationType::Relu => Self::Relu,
            StoredActivationType::Sigmoid => Self::Sigmoid,
            StoredActivationType::Softmax => Self::Softmax,
            StoredActivationType::Tanh => Self::Tanh,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredActivationSpec {
    activation_type: StoredActivationType,
    dim: i32,
}

impl From<&ActivationSpec> for StoredActivationSpec {
    fn from(value: &ActivationSpec) -> Self {
        Self {
            activation_type: (&value.activation_type).into(),
            dim: value.dim,
        }
    }
}

impl From<StoredActivationSpec> for ActivationSpec {
    fn from(value: StoredActivationSpec) -> Self {
        Self {
            activation_type: value.activation_type.into(),
            dim: value.dim,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredIndexedPoolingSpec {
    kernel_size: i64,
    stride: i64,
    padding: i64,
}

impl From<&IndexedPoolingSpec> for StoredIndexedPoolingSpec {
    fn from(value: &IndexedPoolingSpec) -> Self {
        Self {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<StoredIndexedPoolingSpec> for IndexedPoolingSpec {
    fn from(value: StoredIndexedPoolingSpec) -> Self {
        Self {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredUnpoolingSpec {
    kernel_size: i64,
    stride: i64,
    padding: i64,
}

impl From<&UnpoolingSpec> for StoredUnpoolingSpec {
    fn from(value: &UnpoolingSpec) -> Self {
        Self {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<StoredUnpoolingSpec> for UnpoolingSpec {
    fn from(value: StoredUnpoolingSpec) -> Self {
        Self {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StoredUpsampleMode {
    Unspecified,
    Nearest,
    Bilinear,
}

impl From<&UpsampleMode> for StoredUpsampleMode {
    fn from(value: &UpsampleMode) -> Self {
        match value {
            UpsampleMode::Unspecified => Self::Unspecified,
            UpsampleMode::Nearest => Self::Nearest,
            UpsampleMode::Bilinear => Self::Bilinear,
        }
    }
}

impl From<StoredUpsampleMode> for UpsampleMode {
    fn from(value: StoredUpsampleMode) -> Self {
        match value {
            StoredUpsampleMode::Unspecified => Self::Unspecified,
            StoredUpsampleMode::Nearest => Self::Nearest,
            StoredUpsampleMode::Bilinear => Self::Bilinear,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredUpsampleSpec {
    upsample_mode: StoredUpsampleMode,
    scale_factor: i64,
}

impl From<&UpsampleSpec> for StoredUpsampleSpec {
    fn from(value: &UpsampleSpec) -> Self {
        Self {
            upsample_mode: (&value.upsample_mode).into(),
            scale_factor: value.scale_factor,
        }
    }
}

impl From<StoredUpsampleSpec> for UpsampleSpec {
    fn from(value: StoredUpsampleSpec) -> Self {
        Self {
            upsample_mode: value.upsample_mode.into(),
            scale_factor: value.scale_factor,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredAddSpec {
    alpha: f64,
}

impl From<&AddSpec> for StoredAddSpec {
    fn from(value: &AddSpec) -> Self {
        Self { alpha: value.alpha }
    }
}

impl From<StoredAddSpec> for AddSpec {
    fn from(value: StoredAddSpec) -> Self {
        Self { alpha: value.alpha }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(port: &str, node_id: Option<&str>, src_port: &str) -> NodeInput {
        NodeInput {
            port: port.to_string(),
            source: node_id.map(|id| PortRef {
                node_id: id.to_string(),
                port: src_port.to_string(),
            }),
        }
    }

    fn node(id: &str, spec: NodeSpec, inputs: Vec<NodeInput>) -> Node {
        Node {
            id: id.to_string(),
            spec,
            inputs,
        }
    }

    // すべての NodeSpec の種類と、enum の全値(Unspecified を含む)を1つのグラフに入れる
    fn graph_with_every_spec() -> ModelGraph {
        ModelGraph {
            nodes: vec![
                node(
                    "conv",
                    NodeSpec::Conv2D(Conv2DSpec {
                        in_channels: 3,
                        out_channels: 16,
                        kernel_size: 3,
                        stride: 1,
                        padding: 1,
                        dilation: 1,
                    }),
                    vec![input("x", None, "")], // グラフ入力につなぐ
                ),
                node(
                    "pool_max",
                    NodeSpec::Pooling2D(Pooling2DSpec {
                        pooling_type: PoolingType::Max,
                        kernel_size: 2,
                        stride: 2,
                        padding: 0,
                    }),
                    vec![input("x", Some("conv"), "y")],
                ),
                node(
                    "pool_avg",
                    NodeSpec::Pooling2D(Pooling2DSpec {
                        pooling_type: PoolingType::Average,
                        kernel_size: 2,
                        stride: 2,
                        padding: 0,
                    }),
                    vec![input("x", Some("conv"), "y")],
                ),
                node(
                    "pool_unspecified",
                    NodeSpec::Pooling2D(Pooling2DSpec {
                        pooling_type: PoolingType::Unspecified,
                        kernel_size: 2,
                        stride: 2,
                        padding: 0,
                    }),
                    vec![input("x", Some("conv"), "y")],
                ),
                node(
                    "bn",
                    NodeSpec::BatchNorm(BatchNormalizerSpec {
                        num_features: 16,
                        eps: 1e-5,
                        momentum: 0.1,
                    }),
                    vec![input("x", Some("pool_max"), "y")],
                ),
                node(
                    "linear",
                    NodeSpec::Linear(LinearSpec {
                        in_features: 16,
                        out_features: 10,
                        bias: true,
                    }),
                    vec![input("x", Some("bn"), "y")],
                ),
                node(
                    "relu",
                    NodeSpec::Activation(ActivationSpec {
                        activation_type: ActivationType::Relu,
                        dim: 0,
                    }),
                    vec![input("x", Some("linear"), "y")],
                ),
                node(
                    "sigmoid",
                    NodeSpec::Activation(ActivationSpec {
                        activation_type: ActivationType::Sigmoid,
                        dim: 0,
                    }),
                    vec![input("x", Some("linear"), "y")],
                ),
                node(
                    "softmax",
                    NodeSpec::Activation(ActivationSpec {
                        activation_type: ActivationType::Softmax,
                        dim: 1,
                    }),
                    vec![input("x", Some("linear"), "y")],
                ),
                node(
                    "tanh",
                    NodeSpec::Activation(ActivationSpec {
                        activation_type: ActivationType::Tanh,
                        dim: 0,
                    }),
                    vec![input("x", Some("linear"), "y")],
                ),
                node(
                    "act_unspecified",
                    NodeSpec::Activation(ActivationSpec {
                        activation_type: ActivationType::Unspecified,
                        dim: 0,
                    }),
                    vec![input("x", Some("linear"), "y")],
                ),
                node(
                    "ipool",
                    NodeSpec::IndexedPooling(IndexedPoolingSpec {
                        kernel_size: 2,
                        stride: 2,
                        padding: 0,
                    }),
                    vec![input("x", Some("conv"), "y")],
                ),
                node(
                    "unpool",
                    NodeSpec::Unpooling(UnpoolingSpec {
                        kernel_size: 2,
                        stride: 2,
                        padding: 0,
                    }),
                    vec![
                        input("x", Some("ipool"), "y"),
                        input("indices", Some("ipool"), "indices"),
                    ],
                ),
                node(
                    "up_nearest",
                    NodeSpec::Upsample(UpsampleSpec {
                        upsample_mode: UpsampleMode::Nearest,
                        scale_factor: 2,
                    }),
                    vec![input("x", Some("unpool"), "y")],
                ),
                node(
                    "up_bilinear",
                    NodeSpec::Upsample(UpsampleSpec {
                        upsample_mode: UpsampleMode::Bilinear,
                        scale_factor: 2,
                    }),
                    vec![input("x", Some("unpool"), "y")],
                ),
                node(
                    "up_unspecified",
                    NodeSpec::Upsample(UpsampleSpec {
                        upsample_mode: UpsampleMode::Unspecified,
                        scale_factor: 2,
                    }),
                    vec![input("x", Some("unpool"), "y")],
                ),
                node(
                    "add",
                    NodeSpec::Add(AddSpec { alpha: 0.5 }),
                    vec![
                        input("x0", Some("up_nearest"), "y"),
                        input("x1", Some("up_bilinear"), "y"),
                    ],
                ),
                node(
                    "concat",
                    NodeSpec::Concat(ConcatSpec),
                    vec![
                        input("x0", Some("add"), "y"),
                        input("x1", Some("conv"), "y"),
                    ],
                ),
            ],
            outputs: vec![PortRef {
                node_id: "concat".to_string(),
                port: "y".to_string(),
            }],
        }
    }

    // ModelGraph -> JSON -> ModelGraph で元に戻ること(全レイヤーの変換を一度に確かめる)
    #[test]
    fn round_trip_keeps_every_spec() {
        let graph = graph_with_every_spec();
        let json = to_json(&graph).unwrap();
        assert_eq!(from_json(&json).unwrap(), graph);
    }

    #[test]
    fn empty_graph_round_trips() {
        let graph = ModelGraph {
            nodes: vec![],
            outputs: vec![],
        };
        assert_eq!(from_json(&to_json(&graph).unwrap()).unwrap(), graph);
    }

    // 保存形式を固定するテスト。これが落ちたら、保存済みの JSON が読めなくなる変更をしている。
    #[test]
    fn reads_stored_format() {
        let json = r#"{
            "nodes": [
                {"id": "conv", "spec": {"type": "conv2d", "in_channels": 3, "out_channels": 8,
                  "kernel_size": 3, "stride": 1, "padding": 1, "dilation": 1},
                 "inputs": [{"port": "x", "source": null}]},
                {"id": "cat", "spec": {"type": "concat"},
                 "inputs": [{"port": "x0", "source": {"node_id": "conv", "port": "y"}}]}
            ],
            "outputs": [{"node_id": "cat", "port": "y"}]
        }"#;
        let graph = from_json(json).unwrap();
        assert_eq!(graph.nodes.len(), 2);
        assert!(matches!(graph.nodes[0].spec, NodeSpec::Conv2D(Conv2DSpec { out_channels: 8, .. })));
        assert!(matches!(graph.nodes[1].spec, NodeSpec::Concat(ConcatSpec)));
        assert_eq!(graph.nodes[1].inputs[0].source.as_ref().unwrap().node_id, "conv");
    }

    #[test]
    fn broken_json_is_error() {
        assert!(from_json("not json").is_err());
        assert!(from_json(r#"{"nodes": [{"id": "a", "spec": {"type": "unknown"}, "inputs": []}], "outputs": []}"#).is_err());
    }
}
