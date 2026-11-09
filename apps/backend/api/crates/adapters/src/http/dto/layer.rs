use entities::model::layer::{
    ActivationSpec, ActivationType, AddSpec, BatchNormalizerSpec, ConcatSpec, Conv2DSpec,
    IndexedPoolingSpec, LinearSpec, NodeSpec, Pooling2DSpec, PoolingType, UnpoolingSpec,
    UpsampleMode, UpsampleSpec,
};
use serde::{Deserialize, Serialize};

// NodeSpecのDTO
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeSpecDto {
    // snake_case のままだと "conv2_d" になるので個別に指定する
    #[serde(rename = "conv2d")]
    Conv2D(Conv2DSpecDto),
    #[serde(rename = "pooling2d")]
    Pooling2D(Pooling2DSpecDto),
    BatchNorm(BatchNormalizerSpecDto),
    Linear(LinearSpecDto),
    Activation(ActivationSpecDto),
    IndexedPooling(IndexedPoolingSpecDto),
    Unpooling(UnpoolingSpecDto),
    Upsample(UpsampleSpecDto),
    Add(AddSpecDto),
    Concat, // パラメータはない
}

impl From<NodeSpecDto> for NodeSpec {
    fn from(value: NodeSpecDto) -> Self {
        match value {
            NodeSpecDto::Conv2D(spec) => NodeSpec::Conv2D(spec.into()),
            NodeSpecDto::Pooling2D(spec) => NodeSpec::Pooling2D(spec.into()),
            NodeSpecDto::BatchNorm(spec) => NodeSpec::BatchNorm(spec.into()),
            NodeSpecDto::Linear(spec) => NodeSpec::Linear(spec.into()),
            NodeSpecDto::Activation(spec) => NodeSpec::Activation(spec.into()),
            NodeSpecDto::IndexedPooling(spec) => NodeSpec::IndexedPooling(spec.into()),
            NodeSpecDto::Unpooling(spec) => NodeSpec::Unpooling(spec.into()),
            NodeSpecDto::Upsample(spec) => NodeSpec::Upsample(spec.into()),
            NodeSpecDto::Add(spec) => NodeSpec::Add(spec.into()),
            NodeSpecDto::Concat => NodeSpec::Concat(ConcatSpec),
        }
    }
}

// Conv2DのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct Conv2DSpecDto {
    pub in_channels: i64,
    pub out_channels: i64,
    pub kernel_size: i64,
    pub stride: i64,
    pub padding: i64,
    pub dilation: i64,
}

impl From<Conv2DSpecDto> for Conv2DSpec {
    fn from(value: Conv2DSpecDto) -> Self {
        Conv2DSpec {
            in_channels: value.in_channels,
            out_channels: value.out_channels,
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
            dilation: value.dilation,
        }
    }
}

// PoolingTypeのDTO
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PoolingTypeDto {
    // entity からの変換(応答)を漏れなく書くためだけにある。GUI からは受け付けない
    #[serde(skip_deserializing)]
    Unspecified,
    Max,
    Average,
}

impl From<PoolingTypeDto> for PoolingType {
    fn from(value: PoolingTypeDto) -> Self {
        match value {
            PoolingTypeDto::Unspecified => PoolingType::Unspecified,
            PoolingTypeDto::Max => PoolingType::Max,
            PoolingTypeDto::Average => PoolingType::Average,
        }
    }
}

// Pooling2DのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct Pooling2DSpecDto {
    pub pooling_type: PoolingTypeDto,
    pub kernel_size: i64,
    pub stride: i64,
    pub padding: i64,
}

impl From<Pooling2DSpecDto> for Pooling2DSpec {
    fn from(value: Pooling2DSpecDto) -> Self {
        Pooling2DSpec {
            pooling_type: value.pooling_type.into(),
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

// BatchNormalizerのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct BatchNormalizerSpecDto {
    pub num_features: i64,
    pub eps: f64,
    pub momentum: f64,
}

impl From<BatchNormalizerSpecDto> for BatchNormalizerSpec {
    fn from(value: BatchNormalizerSpecDto) -> Self {
        BatchNormalizerSpec {
            num_features: value.num_features,
            eps: value.eps,
            momentum: value.momentum,
        }
    }
}

// LinearのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct LinearSpecDto {
    pub in_features: i64,
    pub out_features: i64,
    pub bias: bool,
}

impl From<LinearSpecDto> for LinearSpec {
    fn from(value: LinearSpecDto) -> Self {
        LinearSpec {
            in_features: value.in_features,
            out_features: value.out_features,
            bias: value.bias,
        }
    }
}

// ActivationTypeのDTO
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationTypeDto {
    // entity からの変換(応答)を漏れなく書くためだけにある。GUI からは受け付けない
    #[serde(skip_deserializing)]
    Unspecified,
    Relu,
    Sigmoid,
    Softmax,
    Tanh,
}

impl From<ActivationTypeDto> for ActivationType {
    fn from(value: ActivationTypeDto) -> Self {
        match value {
            ActivationTypeDto::Unspecified => ActivationType::Unspecified,
            ActivationTypeDto::Relu => ActivationType::Relu,
            ActivationTypeDto::Sigmoid => ActivationType::Sigmoid,
            ActivationTypeDto::Softmax => ActivationType::Softmax,
            ActivationTypeDto::Tanh => ActivationType::Tanh,
        }
    }
}

// ActivationのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct ActivationSpecDto {
    pub activation_type: ActivationTypeDto,
    pub dim: i32,
}

impl From<ActivationSpecDto> for ActivationSpec {
    fn from(value: ActivationSpecDto) -> Self {
        ActivationSpec {
            activation_type: value.activation_type.into(),
            dim: value.dim,
        }
    }
}

// IndexedPoolingのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct IndexedPoolingSpecDto {
    pub kernel_size: i64,
    pub stride: i64,
    pub padding: i64,
}

impl From<IndexedPoolingSpecDto> for IndexedPoolingSpec {
    fn from(value: IndexedPoolingSpecDto) -> Self {
        IndexedPoolingSpec {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

// UnpoolingのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct UnpoolingSpecDto {
    pub kernel_size: i64,
    pub stride: i64,
    pub padding: i64,
}

impl From<UnpoolingSpecDto> for UnpoolingSpec {
    fn from(value: UnpoolingSpecDto) -> Self {
        UnpoolingSpec {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

// UpsampleModeのDTO
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsampleModeDto {
    // entity からの変換(応答)を漏れなく書くためだけにある。GUI からは受け付けない
    #[serde(skip_deserializing)]
    Unspecified,
    Nearest,
    Bilinear,
}

impl From<UpsampleModeDto> for UpsampleMode {
    fn from(value: UpsampleModeDto) -> Self {
        match value {
            UpsampleModeDto::Unspecified => UpsampleMode::Unspecified,
            UpsampleModeDto::Nearest => UpsampleMode::Nearest,
            UpsampleModeDto::Bilinear => UpsampleMode::Bilinear,
        }
    }
}

// UpsampleのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct UpsampleSpecDto {
    pub upsample_mode: UpsampleModeDto,
    pub scale_factor: i64,
}

impl From<UpsampleSpecDto> for UpsampleSpec {
    fn from(value: UpsampleSpecDto) -> Self {
        UpsampleSpec {
            upsample_mode: value.upsample_mode.into(),
            scale_factor: value.scale_factor,
        }
    }
}

// AddのDTO
#[derive(Debug, Serialize, Deserialize)]
pub struct AddSpecDto {
    pub alpha: f64,
}

impl From<AddSpecDto> for AddSpec {
    fn from(value: AddSpecDto) -> Self {
        AddSpec { alpha: value.alpha }
    }
}

// ===== entity -> DTO(GET /models/{model_id}/config の応答用) =====

impl From<NodeSpec> for NodeSpecDto {
    fn from(value: NodeSpec) -> Self {
        match value {
            NodeSpec::Conv2D(spec) => NodeSpecDto::Conv2D(spec.into()),
            NodeSpec::Pooling2D(spec) => NodeSpecDto::Pooling2D(spec.into()),
            NodeSpec::BatchNorm(spec) => NodeSpecDto::BatchNorm(spec.into()),
            NodeSpec::Linear(spec) => NodeSpecDto::Linear(spec.into()),
            NodeSpec::Activation(spec) => NodeSpecDto::Activation(spec.into()),
            NodeSpec::IndexedPooling(spec) => NodeSpecDto::IndexedPooling(spec.into()),
            NodeSpec::Unpooling(spec) => NodeSpecDto::Unpooling(spec.into()),
            NodeSpec::Upsample(spec) => NodeSpecDto::Upsample(spec.into()),
            NodeSpec::Add(spec) => NodeSpecDto::Add(spec.into()),
            NodeSpec::Concat(ConcatSpec) => NodeSpecDto::Concat,
        }
    }
}

impl From<Conv2DSpec> for Conv2DSpecDto {
    fn from(value: Conv2DSpec) -> Self {
        Conv2DSpecDto {
            in_channels: value.in_channels,
            out_channels: value.out_channels,
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
            dilation: value.dilation,
        }
    }
}

impl From<PoolingType> for PoolingTypeDto {
    fn from(value: PoolingType) -> Self {
        match value {
            PoolingType::Unspecified => PoolingTypeDto::Unspecified,
            PoolingType::Max => PoolingTypeDto::Max,
            PoolingType::Average => PoolingTypeDto::Average,
        }
    }
}

impl From<Pooling2DSpec> for Pooling2DSpecDto {
    fn from(value: Pooling2DSpec) -> Self {
        Pooling2DSpecDto {
            pooling_type: value.pooling_type.into(),
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<BatchNormalizerSpec> for BatchNormalizerSpecDto {
    fn from(value: BatchNormalizerSpec) -> Self {
        BatchNormalizerSpecDto {
            num_features: value.num_features,
            eps: value.eps,
            momentum: value.momentum,
        }
    }
}

impl From<LinearSpec> for LinearSpecDto {
    fn from(value: LinearSpec) -> Self {
        LinearSpecDto {
            in_features: value.in_features,
            out_features: value.out_features,
            bias: value.bias,
        }
    }
}

impl From<ActivationType> for ActivationTypeDto {
    fn from(value: ActivationType) -> Self {
        match value {
            ActivationType::Unspecified => ActivationTypeDto::Unspecified,
            ActivationType::Relu => ActivationTypeDto::Relu,
            ActivationType::Sigmoid => ActivationTypeDto::Sigmoid,
            ActivationType::Softmax => ActivationTypeDto::Softmax,
            ActivationType::Tanh => ActivationTypeDto::Tanh,
        }
    }
}

impl From<ActivationSpec> for ActivationSpecDto {
    fn from(value: ActivationSpec) -> Self {
        ActivationSpecDto {
            activation_type: value.activation_type.into(),
            dim: value.dim,
        }
    }
}

impl From<IndexedPoolingSpec> for IndexedPoolingSpecDto {
    fn from(value: IndexedPoolingSpec) -> Self {
        IndexedPoolingSpecDto {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<UnpoolingSpec> for UnpoolingSpecDto {
    fn from(value: UnpoolingSpec) -> Self {
        UnpoolingSpecDto {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<UpsampleMode> for UpsampleModeDto {
    fn from(value: UpsampleMode) -> Self {
        match value {
            UpsampleMode::Unspecified => UpsampleModeDto::Unspecified,
            UpsampleMode::Nearest => UpsampleModeDto::Nearest,
            UpsampleMode::Bilinear => UpsampleModeDto::Bilinear,
        }
    }
}

impl From<UpsampleSpec> for UpsampleSpecDto {
    fn from(value: UpsampleSpec) -> Self {
        UpsampleSpecDto {
            upsample_mode: value.upsample_mode.into(),
            scale_factor: value.scale_factor,
        }
    }
}

impl From<AddSpec> for AddSpecDto {
    fn from(value: AddSpec) -> Self {
        AddSpecDto { alpha: value.alpha }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // GUI が送らない "unspecified" は JSON の時点で弾くこと
    #[test]
    fn unspecified_is_rejected() {
        assert!(serde_json::from_str::<PoolingTypeDto>(r#""unspecified""#).is_err());
        assert!(serde_json::from_str::<ActivationTypeDto>(r#""unspecified""#).is_err());
        assert!(serde_json::from_str::<UpsampleModeDto>(r#""unspecified""#).is_err());
    }

    #[test]
    fn specified_values_are_accepted() {
        assert!(matches!(
            serde_json::from_str::<PoolingTypeDto>(r#""max""#),
            Ok(PoolingTypeDto::Max)
        ));
    }
}
