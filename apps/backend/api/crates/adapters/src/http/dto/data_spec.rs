use entities::training::config::{
    DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, PascalVocConfig, SegmentationSpec,
};
use serde::Deserialize;

// DataSpecのDTO
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DataSpecDto {
    Image(ImageSpecDto),
}

impl From<DataSpecDto> for DataSpec {
    fn from(value: DataSpecDto) -> Self {
        match value {
            DataSpecDto::Image(spec) => DataSpec::Image(spec.into()),
        }
    }
}

// ImageSpecのDTO
#[derive(Debug, Deserialize)]
pub struct ImageSpecDto {
    pub input_width: u32,
    pub input_height: u32,
    pub image_task_spec: ImageTaskSpecDto,
    pub image_annotation_config: ImageAnnotationConfigDto,
}

impl From<ImageSpecDto> for ImageSpec {
    fn from(value: ImageSpecDto) -> Self {
        ImageSpec {
            input_width: value.input_width,
            input_height: value.input_height,
            image_task_spec: value.image_task_spec.into(),
            image_annotation_config: value.image_annotation_config.into(),
        }
    }
}

// ImageTaskSpecのDTO
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImageTaskSpecDto {
    Classification,
    Segmentation(SegmentationSpecDto),
}

impl From<ImageTaskSpecDto> for ImageTaskSpec {
    fn from(value: ImageTaskSpecDto) -> Self {
        match value {
            ImageTaskSpecDto::Classification => ImageTaskSpec::Classification,
            ImageTaskSpecDto::Segmentation(spec) => ImageTaskSpec::Segmentation(spec.into()),
        }
    }
}

// SegmentationSpecのDTO
#[derive(Debug, Deserialize)]
pub struct SegmentationSpecDto {
    pub ignore_index: u32,
}

impl From<SegmentationSpecDto> for SegmentationSpec {
    fn from(value: SegmentationSpecDto) -> Self {
        SegmentationSpec {
            ignore_index: value.ignore_index,
        }
    }
}

// ImageAnnotationConfigのDTO
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImageAnnotationConfigDto {
    PascalVoc(PascalVocConfigDto),
}

impl From<ImageAnnotationConfigDto> for ImageAnnotationConfig {
    fn from(value: ImageAnnotationConfigDto) -> Self {
        match value {
            ImageAnnotationConfigDto::PascalVoc(config) => {
                ImageAnnotationConfig::PascalVoc(config.into())
            }
        }
    }
}

// PascalVocConfigのDTO
#[derive(Debug, Deserialize)]
pub struct PascalVocConfigDto {
    pub include_difficult: bool,
}

impl From<PascalVocConfigDto> for PascalVocConfig {
    fn from(value: PascalVocConfigDto) -> Self {
        PascalVocConfig {
            include_difficult: value.include_difficult,
        }
    }
}
