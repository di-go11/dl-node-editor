use crate::validation::Violations;

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

impl NodeSpec {
    // 層のパラメータの範囲を確認する(C++ の TrainingProtoMapper.cpp の toNodeSpec() と同じ規則)。
    // at は違反の位置の前半(例: "model_graph.nodes[3].spec")。
    pub(crate) fn validate(&self, at: &str, v: &mut Violations) {
        let field = |name: &str| format!("{at}.{name}");
        match self {
            NodeSpec::Conv2D(conv) => {
                v.at_least(&field("in_channels"), conv.in_channels, 1);
                v.at_least(&field("out_channels"), conv.out_channels, 1);
                v.at_least(&field("kernel_size"), conv.kernel_size, 1);
                v.at_least(&field("stride"), conv.stride, 1);
                v.at_least(&field("padding"), conv.padding, 0);
                v.at_least(&field("dilation"), conv.dilation, 1);
            }
            NodeSpec::Pooling2D(pool) => {
                if pool.pooling_type == PoolingType::Unspecified {
                    v.push(field("pooling_type"), "種類を指定してください");
                }
                validate_window(v, &field, pool.kernel_size, pool.stride, pool.padding);
            }
            NodeSpec::BatchNorm(bn) => {
                v.at_least(&field("num_features"), bn.num_features, 1);
                v.greater_than_zero(&field("eps"), bn.eps);
            }
            NodeSpec::Linear(linear) => {
                v.at_least(&field("in_features"), linear.in_features, 1);
                v.at_least(&field("out_features"), linear.out_features, 1);
            }
            NodeSpec::Activation(activation) => {
                if activation.activation_type == ActivationType::Unspecified {
                    v.push(field("activation_type"), "種類を指定してください");
                }
            }
            NodeSpec::IndexedPooling(pool) => {
                validate_window(v, &field, pool.kernel_size, pool.stride, pool.padding);
            }
            NodeSpec::Unpooling(unpool) => {
                validate_window(v, &field, unpool.kernel_size, unpool.stride, unpool.padding);
            }
            NodeSpec::Upsample(upsample) => {
                if upsample.upsample_mode == UpsampleMode::Unspecified {
                    v.push(field("upsample_mode"), "種類を指定してください");
                }
                v.at_least(&field("scale_factor"), upsample.scale_factor, 1);
            }
            NodeSpec::Add(add) => v.finite(&field("alpha"), add.alpha),
            NodeSpec::Concat(_) => {}
        }
    }
}

// Pooling2D / IndexedPooling / Unpooling で共通の、窓の大きさ・移動幅・余白
fn validate_window(
    v: &mut Violations,
    field: &impl Fn(&str) -> String,
    kernel_size: i64,
    stride: i64,
    padding: i64,
) {
    v.at_least(&field("kernel_size"), kernel_size, 1);
    v.at_least(&field("stride"), stride, 1);
    v.at_least(&field("padding"), padding, 0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn violated_fields(spec: &NodeSpec) -> Vec<String> {
        let mut v = Violations::default();
        spec.validate("n", &mut v);
        match v.into_result() {
            Ok(()) => vec![],
            Err(violations) => violations.into_iter().map(|v| v.field).collect(),
        }
    }

    #[test]
    fn conv2d_accepts_minimum_values() {
        let spec = NodeSpec::Conv2D(Conv2DSpec {
            in_channels: 1,
            out_channels: 1,
            kernel_size: 1,
            stride: 1,
            padding: 0,
            dilation: 1,
        });
        assert_eq!(violated_fields(&spec), Vec::<String>::new());
    }

    #[test]
    fn conv2d_reports_every_field_below_minimum() {
        let spec = NodeSpec::Conv2D(Conv2DSpec {
            in_channels: 0,
            out_channels: 0,
            kernel_size: 0,
            stride: 0,
            padding: -1,
            dilation: 0,
        });
        assert_eq!(
            violated_fields(&spec),
            vec![
                "n.in_channels",
                "n.out_channels",
                "n.kernel_size",
                "n.stride",
                "n.padding",
                "n.dilation"
            ]
        );
    }

    #[test]
    fn pooling_layers_check_window() {
        let specs = [
            NodeSpec::Pooling2D(Pooling2DSpec {
                pooling_type: PoolingType::Max,
                kernel_size: 0,
                stride: 0,
                padding: -1,
            }),
            NodeSpec::IndexedPooling(IndexedPoolingSpec {
                kernel_size: 0,
                stride: 0,
                padding: -1,
            }),
            NodeSpec::Unpooling(UnpoolingSpec {
                kernel_size: 0,
                stride: 0,
                padding: -1,
            }),
        ];
        for spec in specs {
            assert_eq!(
                violated_fields(&spec),
                vec!["n.kernel_size", "n.stride", "n.padding"],
                "{spec:?}"
            );
        }
    }

    #[test]
    fn unspecified_types_are_rejected() {
        let pooling = NodeSpec::Pooling2D(Pooling2DSpec {
            pooling_type: PoolingType::Unspecified,
            kernel_size: 2,
            stride: 2,
            padding: 0,
        });
        assert_eq!(violated_fields(&pooling), vec!["n.pooling_type"]);

        let activation = NodeSpec::Activation(ActivationSpec {
            activation_type: ActivationType::Unspecified,
            dim: 1,
        });
        assert_eq!(violated_fields(&activation), vec!["n.activation_type"]);

        let upsample = NodeSpec::Upsample(UpsampleSpec {
            upsample_mode: UpsampleMode::Unspecified,
            scale_factor: 2,
        });
        assert_eq!(violated_fields(&upsample), vec!["n.upsample_mode"]);
    }

    #[test]
    fn batch_norm_linear_upsample_ranges() {
        let bn = NodeSpec::BatchNorm(BatchNormalizerSpec {
            num_features: 0,
            eps: 0.0,
            momentum: 0.1,
        });
        assert_eq!(violated_fields(&bn), vec!["n.num_features", "n.eps"]);

        let linear = NodeSpec::Linear(LinearSpec {
            in_features: 0,
            out_features: 0,
            bias: true,
        });
        assert_eq!(
            violated_fields(&linear),
            vec!["n.in_features", "n.out_features"]
        );

        let upsample = NodeSpec::Upsample(UpsampleSpec {
            upsample_mode: UpsampleMode::Nearest,
            scale_factor: 0,
        });
        assert_eq!(violated_fields(&upsample), vec!["n.scale_factor"]);
    }

    #[test]
    fn add_alpha_must_be_finite() {
        let ok = NodeSpec::Add(AddSpec { alpha: -1.0 });
        assert_eq!(violated_fields(&ok), Vec::<String>::new());
        let ng = NodeSpec::Add(AddSpec {
            alpha: f64::INFINITY,
        });
        assert_eq!(violated_fields(&ng), vec!["n.alpha"]);
    }
}
