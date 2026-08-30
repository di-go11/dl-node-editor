#pragma once

#include "training/application/interfaces/image/IImagePreprocessor.hpp"
#include "training/entities/image/ResizeParam.hpp"

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

    ResizeParam _resizeParam;
};
