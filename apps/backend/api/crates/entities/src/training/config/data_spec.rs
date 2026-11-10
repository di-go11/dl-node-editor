// 特徴抽出方法ごとにあったデータ形式のドメイン

// データのドメイン
#[derive(Debug, PartialEq, Clone)]
pub enum DataSpec {
    Image(ImageSpec),
}

//ImageSpec
#[derive(Debug, PartialEq, Clone)]
pub struct ImageSpec {
    pub input_width: u32,
    pub input_height: u32,
    pub image_task_spec: ImageTaskSpec,
    pub image_annotation_config: ImageAnnotationConfig,
}

// 画像タスクの種類
#[derive(Debug, PartialEq, Clone)]
pub enum ImageTaskSpec {
    Classification,
    Segmentation(SegmentationSpec),
}

/// Segmentation
#[derive(Debug, PartialEq, Clone)]
pub struct SegmentationSpec {
    pub ignore_index: u32,
}

// アノテーションの種類
#[derive(Debug, PartialEq, Clone)]
pub enum ImageAnnotationConfig {
    PascalVoc(PascalVocConfig),
}

/// pascalvoc
#[derive(Debug, PartialEq, Clone)]

pub struct PascalVocConfig {
    pub include_difficult: bool,
}
