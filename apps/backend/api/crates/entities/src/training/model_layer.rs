// model_graph.proto の層(ノードの中身)に対応するパーツ。
// f64 を持つものは Eq を derive できないため PartialEq のみ。

// NodeSpec
// 並び順は model_graph.proto の NodeSpec(oneof params)と対応させる。
#[derive(Debug, Clone, PartialEq)]
pub enum NodeSpec {
    Conv2D(Conv2DSpec),
    Pooling2D(Pooling2DSpec),
    BatchNorm(BatchNormalizerSpec),
    Linear(LinearSpec),
    Activation(ActivationSpec),
    IndexedPooling(IndexedPoolingSpec),
    Unpooling(UnpoolingSpec),
    Upsample(UpsampleSpec),
    Add(AddSpec),
    Concat(ConcatSpec),
}

// Conv2D
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conv2DSpec {
    in_channels: i64,
    out_channels: i64,
    kernel_size: i64,
    stride: i64,
    padding: i64,
    dilation: i64,
}

// PoolingType
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PoolingType {
    Unspecified,
    Max,
    Average,
}
// Pooling2D
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pooling2DSpec {
    pool_type: PoolingType,
    kernel_size: i64,
    stride: i64,
    padding: i64,
}

// BatchNormalizer
#[derive(Debug, Clone, PartialEq)]
pub struct BatchNormalizerSpec {
    num_features: i64,
    eps: f64,
    momentum: f64,
}

// Linear
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearSpec {
    in_features: i64,
    out_features: i64,
    bias: bool,
}

// ActivationType
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivationType {
    Unspecified,
    ReLU,
    Sigmoid,
    Softmax,
    Tanh,
}
// Activation
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivationSpec {
    activation_type: ActivationType,
    dim: i32,
}

// IndexedPooling
// 出力ポートは y と indices。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedPoolingSpec {
    kernel_size: i64,
    stride: i64,
    padding: i64,
}

// Unpooling
// 入力ポートは x と indices。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnpoolingSpec {
    kernel_size: i64,
    stride: i64,
    padding: i64,
}

// UpsampleMode
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpsampleMode {
    Unspecified,
    Nearest,
    Bilinear,
}
// Upsample
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpsampleSpec {
    upsample_mode: UpsampleMode,
    scale_factor: i64,
}

// Add
// alpha は 2 番目以降の入力にかける係数。proto 上の 0(未指定)は 1.0 として扱われる。
#[derive(Debug, Clone, PartialEq)]
pub struct AddSpec {
    alpha: f64,
}

// Concat
// 入力をチャンネル方向に結合する。パラメータはない。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcatSpec;
