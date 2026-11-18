#pragma once

#include <string>

#include "training/entities/domain-objects/ImageAnnotationConfig.hpp"
#include "training/entities/image/ColorLabelMap.hpp"

// データセットの形式に応じて、マスクの色とクラス ID の対応(ColorLabelMap)を作る。
//   PascalVocConfig … VOC のカラーマップ(21 クラス固定。VocColorLabelMapFactory)。labelmap.txt は読まない
//   OriginalConfig  … datasetPath/labelmap.txt(LabelMapFileReader)。なければ std::runtime_error
//
// クラス数(モデル出力チャンネル数・損失・評価器)とマスクの変換の両方がこの結果を使う。
// 両者が別々に色表を作ると食い違うおそれがあるため、形式ごとの判断はここ 1 か所にまとめる。
ColorLabelMap loadDatasetLabelMap(const ImageAnnotationConfig &annotation, const std::string &datasetPath);
