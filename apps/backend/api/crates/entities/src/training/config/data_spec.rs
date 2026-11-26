use crate::validation::Violations;

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

/// マスク画像の色。値域(0〜255)は DataSpec::validate() で確認する
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

impl DataSpec {
    pub(crate) fn validate(&self, v: &mut Violations) {
        match self {
            DataSpec::Image(image) => image.validate(v),
        }
    }
}

impl ImageSpec {
    // 違反の位置は HTTP の JSON に合わせる(DataSpec / ImageTaskSpec は種類を "type" に持つので、
    // 中身の項目は data_spec / image_task_spec の直下に並ぶ)
    fn validate(&self, v: &mut Violations) {
        v.at_least("data_spec.input_width", self.input_width.into(), 1);
        v.at_least("data_spec.input_height", self.input_height.into(), 1);
        if let ImageTaskSpec::Segmentation(segmentation) = &self.image_task_spec {
            segmentation.validate(v);
        }
    }
}

impl SegmentationSpec {
    // マスクは 8bit 画像なので、クラス番号も色も 0〜255
    fn validate(&self, v: &mut Violations) {
        let at = "data_spec.image_task_spec";
        v.at_most(&format!("{at}.ignore_index"), self.ignore_index.into(), 255);
        if let Some(color) = self.ignore_color {
            // JSON では ignore_color_r / _g / _b の 3 項目に分かれている
            v.at_most(&format!("{at}.ignore_color_r"), color.r.into(), 255);
            v.at_most(&format!("{at}.ignore_color_g"), color.g.into(), 255);
            v.at_most(&format!("{at}.ignore_color_b"), color.b.into(), 255);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(width: u32, height: u32, task: ImageTaskSpec) -> DataSpec {
        DataSpec::Image(ImageSpec {
            input_width: width,
            input_height: height,
            image_task_spec: task,
            image_annotation_config: ImageAnnotationConfig::Original,
        })
    }

    fn segmentation(ignore_index: u32, ignore_color: Option<RgbColor>) -> ImageTaskSpec {
        ImageTaskSpec::Segmentation(SegmentationSpec {
            ignore_index,
            ignore_color,
        })
    }

    fn violated_fields(spec: &DataSpec) -> Vec<String> {
        let mut v = Violations::default();
        spec.validate(&mut v);
        match v.into_result() {
            Ok(()) => vec![],
            Err(violations) => violations.into_iter().map(|v| v.field).collect(),
        }
    }

    #[test]
    fn input_size_must_be_at_least_one() {
        assert_eq!(
            violated_fields(&image(1, 1, ImageTaskSpec::Classification)),
            Vec::<String>::new()
        );
        assert_eq!(
            violated_fields(&image(0, 0, ImageTaskSpec::Classification)),
            vec!["data_spec.input_width", "data_spec.input_height"]
        );
    }

    #[test]
    fn segmentation_values_must_fit_in_8bit() {
        let ok = segmentation(
            255,
            Some(RgbColor {
                r: 255,
                g: 0,
                b: 255,
            }),
        );
        assert_eq!(violated_fields(&image(8, 8, ok)), Vec::<String>::new());

        let ng = segmentation(
            256,
            Some(RgbColor {
                r: 256,
                g: 0,
                b: 300,
            }),
        );
        assert_eq!(
            violated_fields(&image(8, 8, ng)),
            vec![
                "data_spec.image_task_spec.ignore_index",
                "data_spec.image_task_spec.ignore_color_r",
                "data_spec.image_task_spec.ignore_color_b"
            ]
        );
    }
}
