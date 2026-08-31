#pragma once

#include "training/application/interfaces/image/IImagePreprocessor.hpp"
#include "training/entities/image/AspectRatioPolicy.hpp"
#include "training/entities/image/InterpolationMethod.hpp"

#include <cstddef>
#include <cstdint>
#include <memory>

// 画像とラベルマスクで「出力サイズ・アスペクト比ポリシー(ジオメトリ)」は共有しつつ、
// 補間方法とパディング値だけを切り替えて IImagePreprocessor を生成するファクトリ。
//
// ジオメトリを1箇所で持つことで、画像とマスクの幾何変換がズレる事故を防ぐ。
class ResizePreprocessorFactory
{
public:
    // 画像・マスク共通の幾何情報。
    struct Geometry
    {
        size_t width = 0;
        size_t height = 0;
        AspectRatioPolicy aspectRatioPolicy = WarpPolicy{};
    };

    explicit ResizePreprocessorFactory(Geometry geometry);

    // 入力画像用: 補間は呼び出し側指定(既定 Auto)。Letterbox の余白は 0。
    std::shared_ptr<IImagePreprocessor> forImage(
        InterpolationMethod interpolation = InterpolationMethod::Auto) const;

    // ラベルマスク用: 補間は NearestNeighbor 固定(クラスIDを壊さない)。
    // Letterbox の余白は ignoreIndex(損失計算で無視されるラベル)。
    std::shared_ptr<IImagePreprocessor> forMask(uint8_t ignoreIndex = 255) const;

private:
    Geometry _geometry;
};
