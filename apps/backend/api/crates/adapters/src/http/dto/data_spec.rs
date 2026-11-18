use entities::training::config::{
    DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, PascalVocConfig, RgbColor,
    SegmentationSpec,
};
use serde::{Deserialize, Serialize};

// DataSpecのDTO
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
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
// 無視する色は、フロントエンドのパラメータ(フラットな値の袋)と proto に合わせて
// 「有効か」と r/g/b の 4 つの値で表す。無効なら r/g/b は読まない。
#[derive(Debug, Serialize, Deserialize)]
pub struct SegmentationSpecDto {
    pub ignore_index: u32,
    pub ignore_color_enabled: bool,
    pub ignore_color_r: u32,
    pub ignore_color_g: u32,
    pub ignore_color_b: u32,
}

impl From<SegmentationSpecDto> for SegmentationSpec {
    fn from(value: SegmentationSpecDto) -> Self {
        SegmentationSpec {
            ignore_index: value.ignore_index,
            ignore_color: value.ignore_color_enabled.then_some(RgbColor {
                r: value.ignore_color_r,
                g: value.ignore_color_g,
                b: value.ignore_color_b,
            }),
        }
    }
}

// ImageAnnotationConfigのDTO
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImageAnnotationConfigDto {
    PascalVoc(PascalVocConfigDto),
    // パラメータを持たない。JSON は { "type": "original" }
    Original,
}

impl From<ImageAnnotationConfigDto> for ImageAnnotationConfig {
    fn from(value: ImageAnnotationConfigDto) -> Self {
        match value {
            ImageAnnotationConfigDto::PascalVoc(config) => {
                ImageAnnotationConfig::PascalVoc(config.into())
            }
            ImageAnnotationConfigDto::Original => ImageAnnotationConfig::Original,
        }
    }
}

// PascalVocConfigのDTO
#[derive(Debug, Serialize, Deserialize)]
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

// ===== entity -> DTO(GET /models/{model_id}/config の応答用) =====

impl From<DataSpec> for DataSpecDto {
    fn from(value: DataSpec) -> Self {
        match value {
            DataSpec::Image(spec) => DataSpecDto::Image(spec.into()),
        }
    }
}

impl From<ImageSpec> for ImageSpecDto {
    fn from(value: ImageSpec) -> Self {
        ImageSpecDto {
            input_width: value.input_width,
            input_height: value.input_height,
            image_task_spec: value.image_task_spec.into(),
            image_annotation_config: value.image_annotation_config.into(),
        }
    }
}

impl From<ImageTaskSpec> for ImageTaskSpecDto {
    fn from(value: ImageTaskSpec) -> Self {
        match value {
            ImageTaskSpec::Classification => ImageTaskSpecDto::Classification,
            ImageTaskSpec::Segmentation(spec) => ImageTaskSpecDto::Segmentation(spec.into()),
        }
    }
}

impl From<SegmentationSpec> for SegmentationSpecDto {
    fn from(value: SegmentationSpec) -> Self {
        // 無効のときは色を持っていないので、r/g/b は 0 で埋める(ignore_color_enabled = false なら読まれない)
        let color = value.ignore_color.unwrap_or(RgbColor { r: 0, g: 0, b: 0 });
        SegmentationSpecDto {
            ignore_index: value.ignore_index,
            ignore_color_enabled: value.ignore_color.is_some(),
            ignore_color_r: color.r,
            ignore_color_g: color.g,
            ignore_color_b: color.b,
        }
    }
}

impl From<ImageAnnotationConfig> for ImageAnnotationConfigDto {
    fn from(value: ImageAnnotationConfig) -> Self {
        match value {
            ImageAnnotationConfig::PascalVoc(config) => {
                ImageAnnotationConfigDto::PascalVoc(config.into())
            }
            ImageAnnotationConfig::Original => ImageAnnotationConfigDto::Original,
        }
    }
}

impl From<PascalVocConfig> for PascalVocConfigDto {
    fn from(value: PascalVocConfig) -> Self {
        PascalVocConfigDto {
            include_difficult: value.include_difficult,
        }
    }
}
