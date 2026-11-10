// Layer関連のドメインをprotoに変換するためのトレイト実装
use entities::model::{self, layer::*};

use crate::pb::model::v1::{self as model_pb};

impl From<&Conv2DSpec> for model_pb::Conv2DSpec {
    fn from(value: &Conv2DSpec) -> Self {
        model_pb::Conv2DSpec {
            in_channels: value.in_channels,
            out_channels: value.out_channels,
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
            dilation: value.dilation,
        }
    }
}

impl From<&PoolingType> for model_pb::PoolingType {
    fn from(value: &PoolingType) -> Self {
        match value {
            PoolingType::Unspecified => model_pb::PoolingType::Unspecified,
            PoolingType::Max => model_pb::PoolingType::Max,
            PoolingType::Average => model_pb::PoolingType::Average,
        }
    }
}

impl From<&Pooling2DSpec> for model_pb::Pooling2DSpec {
    fn from(value: &Pooling2DSpec) -> Self {
        model_pb::Pooling2DSpec {
            pooling_type: model_pb::PoolingType::from(&value.pooling_type) as i32,
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<&BatchNormalizerSpec> for model_pb::BatchNormSpec {
    fn from(value: &BatchNormalizerSpec) -> Self {
        model_pb::BatchNormSpec {
            num_features: value.num_features,
            eps: value.eps,
            momentum: value.momentum,
        }
    }
}

impl From<&LinearSpec> for model_pb::LinearSpec {
    fn from(value: &LinearSpec) -> Self {
        model_pb::LinearSpec {
            in_features: value.in_features,
            out_features: value.out_features,
            bias: value.bias,
        }
    }
}

impl From<&ActivationType> for model_pb::ActivationType {
    fn from(value: &ActivationType) -> Self {
        match value {
            ActivationType::Unspecified => model_pb::ActivationType::Unspecified,
            ActivationType::Relu => model_pb::ActivationType::Relu,
            ActivationType::Sigmoid => model_pb::ActivationType::Sigmoid,
            ActivationType::Softmax => model_pb::ActivationType::Softmax,
            ActivationType::Tanh => model_pb::ActivationType::Tanh,
        }
    }
}

impl From<&ActivationSpec> for model_pb::ActivationSpec {
    fn from(value: &ActivationSpec) -> Self {
        model_pb::ActivationSpec {
            activation_type: model_pb::ActivationType::from(&value.activation_type) as i32,
            dim: value.dim,
        }
    }
}

impl From<&IndexedPoolingSpec> for model_pb::IndexedPoolingSpec {
    fn from(value: &IndexedPoolingSpec) -> Self {
        model_pb::IndexedPoolingSpec {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<&UnpoolingSpec> for model_pb::UnpoolingSpec {
    fn from(value: &UnpoolingSpec) -> Self {
        model_pb::UnpoolingSpec {
            kernel_size: value.kernel_size,
            stride: value.stride,
            padding: value.padding,
        }
    }
}

impl From<&UpsampleMode> for model_pb::UpsampleMode {
    fn from(value: &UpsampleMode) -> Self {
        match value {
            UpsampleMode::Unspecified => model_pb::UpsampleMode::Unspecified,
            UpsampleMode::Nearest => model_pb::UpsampleMode::Nearest,
            UpsampleMode::Bilinear => model_pb::UpsampleMode::Bilinear,
        }
    }
}

impl From<&UpsampleSpec> for model_pb::UpsampleSpec {
    fn from(value: &UpsampleSpec) -> Self {
        model_pb::UpsampleSpec {
            upsample_mode: model_pb::UpsampleMode::from(&value.upsample_mode) as i32,
            scale_factor: value.scale_factor,
        }
    }
}

impl From<&model::layer::AddSpec> for model_pb::AddSpec {
    fn from(value: &AddSpec) -> Self {
        model_pb::AddSpec { alpha: value.alpha }
    }
}

impl From<&model::layer::ConcatSpec> for model_pb::ConcatSpec {
    fn from(_value: &ConcatSpec) -> Self {
        model_pb::ConcatSpec {}
    }
}
