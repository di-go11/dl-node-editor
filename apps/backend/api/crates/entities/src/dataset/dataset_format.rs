// アップロードできるデータセットの形式と、形式ごとに必要なファイル構成。
// 文字列(pascal_voc / original)は学習設定のアノテーション形式(ImageAnnotationConfig)の JSON 表記と同じ。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatasetFormat {
    /// 本家 PASCAL VOC。マスクは VOC のカラーマップで解釈し、labelmap.txt は使わない
    PascalVoc,
    /// 独自形式(CVAT の Segmentation mask 書き出しなど)。色とクラスの対応は labelmap.txt で決める
    Original,
}

/// データセットのルートからの相対パスで表した、必要なファイルまたはディレクトリ
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequiredEntry {
    Dir(&'static str),
    File(&'static str),
}

impl RequiredEntry {
    pub fn path(&self) -> &'static str {
        match self {
            RequiredEntry::Dir(path) | RequiredEntry::File(path) => path,
        }
    }

    /// 利用者に見せる表記。ディレクトリは末尾に / を付ける(JPEGImages/)
    pub fn display_name(&self) -> String {
        match self {
            RequiredEntry::Dir(path) => format!("{path}/"),
            RequiredEntry::File(path) => (*path).to_string(),
        }
    }
}

// どちらの形式も VOC と同じディレクトリ構成を読む(学習エンジンの VocSegmentationData)。
// 今の学習エンジンはセグメンテーションだけなので、学習に必要なものをそろえて求める。
const VOC_LAYOUT: [RequiredEntry; 4] = [
    RequiredEntry::Dir("JPEGImages"),
    RequiredEntry::Dir("SegmentationClass"),
    RequiredEntry::File("ImageSets/Segmentation/train.txt"),
    RequiredEntry::File("ImageSets/Segmentation/val.txt"),
];

impl DatasetFormat {
    /// 形式の文字列から作る。知らない形式なら None
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pascal_voc" => Some(DatasetFormat::PascalVoc),
            "original" => Some(DatasetFormat::Original),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            DatasetFormat::PascalVoc => "pascal_voc",
            DatasetFormat::Original => "original",
        }
    }

    /// この形式のデータセットに必要なファイル・ディレクトリ
    pub fn required_entries(&self) -> Vec<RequiredEntry> {
        let mut entries = VOC_LAYOUT.to_vec();
        if *self == DatasetFormat::Original {
            entries.push(RequiredEntry::File("labelmap.txt"));
        }
        entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_formats_and_round_trips() {
        for format in [DatasetFormat::PascalVoc, DatasetFormat::Original] {
            assert_eq!(DatasetFormat::parse(format.as_str()), Some(format));
        }
        assert_eq!(DatasetFormat::parse("coco"), None);
        assert_eq!(DatasetFormat::parse("PascalVoc"), None);
    }

    #[test]
    fn only_original_requires_labelmap() {
        let labelmap = RequiredEntry::File("labelmap.txt");
        assert!(!DatasetFormat::PascalVoc
            .required_entries()
            .contains(&labelmap));
        assert!(DatasetFormat::Original
            .required_entries()
            .contains(&labelmap));
    }

    #[test]
    fn directories_are_shown_with_trailing_slash() {
        assert_eq!(
            RequiredEntry::Dir("JPEGImages").display_name(),
            "JPEGImages/"
        );
        assert_eq!(
            RequiredEntry::File("labelmap.txt").display_name(),
            "labelmap.txt"
        );
    }
}
