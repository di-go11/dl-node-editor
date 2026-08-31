#pragma once

#include "training/application/interfaces/image/IImagePreprocessor.hpp"
#include "training/entities/image/ResizeParam.hpp"

#include <opencv2/core.hpp>

#include <cstddef>
#include <vector>

class OpenCvImageResizer : public IImagePreprocessor
{
public:
    OpenCvImageResizer(const ResizeParam &resizeParam);
    ImageData process(const ImageData &rowImage) const override;

private:
    // InterpolationMethod(entities層のフレームワーク非依存enum)を
    // OpenCVの cv::INTER_* 定数(int)へ変換する。
    // Auto のときだけ shrinking の値から縮小=INTER_AREA / 拡大=INTER_LINEAR を決める。
    static int toCvInterpolation(InterpolationMethod method, bool shrinking);

    // AspectRatioPolicy ごとの実処理。いずれも目標サイズ(_resizeParam)の ImageData を返す。
    ImageData applyWarp(const ImageData &src) const;
    ImageData applyLetterbox(const ImageData &src, const LetterboxPolicy &policy) const;
    ImageData applyCenterCrop(const ImageData &src, const CenterCropPolicy &policy) const;

    // src(CHW 平坦)の各チャンネルプレーンを (dstHeight, dstWidth) へ resize し、
    // チャンネルごとの CV_8UC1 Mat(データ所有)として返す。
    std::vector<cv::Mat> resizePlanes(
        const ImageData &src, size_t dstHeight, size_t dstWidth) const;

    // チャンネルごとの Mat 列(すべて同一サイズ)を CHW 平坦の ImageData へ詰め直す。
    static ImageData planesToImageData(const std::vector<cv::Mat> &planes);

    ResizeParam _resizeParam;
};
