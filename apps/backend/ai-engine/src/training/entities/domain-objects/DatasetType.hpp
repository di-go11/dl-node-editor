#pragma once

#include "training/entities/domain-objects/ImageAnnotationType.hpp"

#include <variant>

// データセットの種別。モダリティごとの種別 enum を並べる。
// 1D/3D など別のモダリティを足すときは、専用の enum ヘッダ(ImageAnnotationType.hpp と同様)を
// 作ってここに追加する。variant の並び順は DatasetAnnotationConfig(DatasetConfig.hpp)と揃える。
using DatasetType = std::variant<ImageAnnotationType>;
