use crate::pb::training::v1::data_spec::Spec as PbDataSpec;
use crate::pb::training::v1::{self as training_pb};
use entities::training::config::{
    DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, PascalVocConfig,
};

// Data関連のドメインをprotoに変換するためのトレイト実装
impl From<&DataSpec> for training_pb::DataSpec {
    fn from(value: &DataSpec) -> Self {
        match value {
            DataSpec::Image(ImageSpec {
                input_height,
                input_width,
                image_task_spec,
                image_annotation_config,
            }) => training_pb::DataSpec {
                spec: Some(PbDataSpec::Image(training_pb::ImageSpec {
                    annotation: Some(image_annotation_config.into()),
                    input_height: *input_height,
                    input_width: *input_width,
                    task_specs: Some(image_task_spec.into()),
                })),
            },
        }
    }
}

impl From<&ImageAnnotationConfig> for training_pb::ImageAnnotationConfig {
    fn from(value: &ImageAnnotationConfig) -> Self {
        match value {
            ImageAnnotationConfig::PascalVoc(PascalVocConfig { include_difficult }) => Self {
                config: Some(training_pb::image_annotation_config::Config::PascalVoc(
                    training_pb::PascalVocConfig {
                        include_difficult: *include_difficult,
                    },
                )),
            },
            ImageAnnotationConfig::Original => Self {
                config: Some(training_pb::image_annotation_config::Config::Original(
                    training_pb::OriginalConfig {},
                )),
            },
        }
    }
}

impl From<&ImageTaskSpec> for training_pb::ImageTaskSpecs {
    fn from(value: &ImageTaskSpec) -> Self {
        let spec = match value {
            ImageTaskSpec::Classification => training_pb::image_task_specs::Spec::Classification(
                training_pb::ClassificationSpec {},
            ),
            ImageTaskSpec::Segmentation(segmentation_spec) => {
                // 無効のときは r/g/b を 0 にする(C++ は ignore_color_enabled = false なら読まない)
                let color = segmentation_spec.ignore_color;
                training_pb::image_task_specs::Spec::Segmentation(training_pb::SegmentationSpec {
                    ignore_index: segmentation_spec.ignore_index,
                    ignore_color_enabled: color.is_some(),
                    ignore_color_r: color.map_or(0, |c| c.r),
                    ignore_color_g: color.map_or(0, |c| c.g),
                    ignore_color_b: color.map_or(0, |c| c.b),
                })
            }
        };
        Self { spec: Some(spec) }
    }
}
