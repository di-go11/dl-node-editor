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
    /// マスク画像でこの色のピクセルを ignore_index に変換する(Pascal VOC の void は 224,224,192)。
    /// None なら、色表(VOC のカラーマップ / labelmap.txt)にない色があった時点で学習エンジンがエラーにする。
    pub ignore_color: Option<RgbColor>,
}

/// マスク画像の色。値域(0〜255)は ignore_index と同じく学習エンジン(C++)が検証する
#[derive(Debug, PartialEq, Clone, Copy)]
pub struct RgbColor {
    pub r: u32,
    pub g: u32,
    pub b: u32,
}

// アノテーションの種類(データセットの形式)。どちらも VOC と同じディレクトリ構成で、
// マスクの色とクラスの対応をどこから取るかが違う。
#[derive(Debug, PartialEq, Clone)]
pub enum ImageAnnotationConfig {
    /// 本家 PASCAL VOC。VOC のカラーマップ(21 クラス固定)を使い、labelmap.txt は読まない
    PascalVoc(PascalVocConfig),
    /// 独自形式(CVAT の Segmentation mask 書き出しなど)。色とクラスの対応は labelmap.txt で決める
    Original,
}

/// pascalvoc
#[derive(Debug, PartialEq, Clone)]

pub struct PascalVocConfig {
    pub include_difficult: bool,
}
