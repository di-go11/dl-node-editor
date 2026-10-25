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
    pub in_channels: i64,
    pub out_channels: i64,
    pub kernel_size: i64,
    pub stride: i64,
    pub padding: i64,
    pub dilation: i64,
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
    pub pooling_type: PoolingType,
    pub kernel_size: i64,
    pub stride: i64,
    pub padding: i64,
}

// BatchNormalizer
#[derive(Debug, Clone, PartialEq)]
pub struct BatchNormalizerSpec {
    pub num_features: i64,
    pub eps: f64,
    pub momentum: f64,
}

// Linear
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearSpec {
    pub in_features: i64,
    pub out_features: i64,
    pub bias: bool,
}

// ActivationType
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivationType {
    Unspecified,
    Relu,
    Sigmoid,
    Softmax,
    Tanh,
}
// Activation
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivationSpec {
    pub activation_type: ActivationType,
    pub dim: i32,
}

// IndexedPooling
// 出力ポートは y と indices。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedPoolingSpec {
    pub kernel_size: i64,
    pub stride: i64,
    pub padding: i64,
}

// Unpooling
// 入力ポートは x と indices。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnpoolingSpec {
    pub kernel_size: i64,
    pub stride: i64,
    pub padding: i64,
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
    pub upsample_mode: UpsampleMode,
    pub scale_factor: i64,
}

// Add
// alpha は 2 番目以降の入力にかける係数。proto 上の 0(未指定)は 1.0 として扱われる。
#[derive(Debug, Clone, PartialEq)]
pub struct AddSpec {
    pub alpha: f64,
}

// Concat
// 入力をチャンネル方向に結合する。パラメータはない。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcatSpec;
