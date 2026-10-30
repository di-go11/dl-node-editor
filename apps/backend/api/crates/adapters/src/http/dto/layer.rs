use entities::model::layer::{
    ActivationSpec, ActivationType, AddSpec, BatchNormalizerSpec, ConcatSpec, Conv2DSpec,
    IndexedPoolingSpec, LinearSpec, NodeSpec, Pooling2DSpec, PoolingType, UnpoolingSpec,
    UpsampleMode, UpsampleSpec,
};
use serde::Deserialize;

// NodeSpecのDTO
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PoolingTypeDto {
    Max,
    Average,
}

impl From<PoolingTypeDto> for PoolingType {
    fn from(value: PoolingTypeDto) -> Self {
        match value {
            PoolingTypeDto::Max => PoolingType::Max,
            PoolingTypeDto::Average => PoolingType::Average,
        }
    }
}

// Pooling2DのDTO
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationTypeDto {
    Relu,
    Sigmoid,
    Softmax,
    Tanh,
}

impl From<ActivationTypeDto> for ActivationType {
    fn from(value: ActivationTypeDto) -> Self {
        match value {
            ActivationTypeDto::Relu => ActivationType::Relu,
            ActivationTypeDto::Sigmoid => ActivationType::Sigmoid,
            ActivationTypeDto::Softmax => ActivationType::Softmax,
            ActivationTypeDto::Tanh => ActivationType::Tanh,
        }
    }
}

// ActivationのDTO
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsampleModeDto {
    Nearest,
    Bilinear,
}

impl From<UpsampleModeDto> for UpsampleMode {
    fn from(value: UpsampleModeDto) -> Self {
        match value {
            UpsampleModeDto::Nearest => UpsampleMode::Nearest,
            UpsampleModeDto::Bilinear => UpsampleMode::Bilinear,
        }
    }
}

// UpsampleのDTO
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
pub struct AddSpecDto {
    pub alpha: f64,
}

impl From<AddSpecDto> for AddSpec {
    fn from(value: AddSpecDto) -> Self {
        AddSpec { alpha: value.alpha }
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
