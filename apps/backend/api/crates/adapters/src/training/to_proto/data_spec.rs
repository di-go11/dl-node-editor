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
        }
    }
}

impl From<&ImageTaskSpec> for training_pb::ImageTaskSpecs {
    fn from(value: &ImageTaskSpec) -> Self {
        let spec = match value {
            ImageTaskSpec::Classification {} => {
                training_pb::image_task_specs::Spec::Classification(
                    training_pb::ClassificationSpec {},
                )
            }
            ImageTaskSpec::Segmentation(segmentation_spec) => {
                training_pb::image_task_specs::Spec::Segmentation(training_pb::SegmentationSpec {
                    ignore_index: segmentation_spec.ignore_index,
                })
            }
        };
        Self { spec: Some(spec) }
    }
}
