#include "training/infrastructure/image/OpenCvImageResizer.hpp"

#include <opencv2/opencv.hpp>

#include <stdexcept>
#include <utility>
#include <vector>

OpenCvImageResizer::OpenCvImageResizer(const ResizeParam &resizeParam) : _resizeParam(resizeParam)
{
}

int OpenCvImageResizer::toCvInterpolation(InterpolationMethod method, bool shrinking)
{
    switch (method)
    {
    case InterpolationMethod::NearestNeighbor:
        return cv::INTER_NEAREST;
    case InterpolationMethod::Bilinear:
        return cv::INTER_LINEAR;
    case InterpolationMethod::Bicubic:
        return cv::INTER_CUBIC;
    case InterpolationMethod::Lanczos:
        return cv::INTER_LANCZOS4;
    case InterpolationMethod::Auto:
        // Auto の場合は shrinking の値から縮小=INTER_AREA / 拡大=INTER_LINEAR を決める。
        return shrinking ? cv::INTER_AREA : cv::INTER_LINEAR;
    default:
        // 縮小はエイリアシング(モアレ)を避けられる面積平均、拡大は双線形が定番。
        return shrinking ? cv::INTER_AREA : cv::INTER_LINEAR;
    }
}

ImageData OpenCvImageResizer::process(const ImageData &rowImage) const
{
    const size_t channels = rowImage.getChannels();
    const size_t srcHeight = rowImage.getHeight();
    const size_t srcWidth = rowImage.getWidth();
    const size_t dstHeight = _resizeParam.height;
    const size_t dstWidth = _resizeParam.width;

    // 既に目的サイズなら cv::resize を呼ばずそのまま返す。
    if (srcHeight == dstHeight && srcWidth == dstWidth)
    {
        return rowImage;
    }

    if (_resizeParam.resizePolicy != ResizePolicy::Warp)
    {
        // Letterbox(アスペクト比保持 + パディング)/ CenterCrop は
        // 座標変換とパディングの設計が別途必要なため未実装。
        throw std::logic_error("OpenCvImageResizer: Letterbox / CenterCrop is not implemented yet");
    }

    const bool shrinking = (dstWidth < srcWidth) || (dstHeight < srcHeight);
    const int interpolation = toCvInterpolation(_resizeParam.interpolationMethod, shrinking);

    // ImageData は CHW 平坦なので、各チャンネルのプレーンは values 内で連続している。
    // その連続領域を cv::Mat ヘッダで「コピーせず」参照し、チャンネルごとに resize する。
    const std::vector<uint8_t> &src = rowImage.raw();
    std::vector<uint8_t> dst(channels * dstHeight * dstWidth);

    for (size_t c = 0; c < channels; ++c)
    {
        const cv::Mat srcPlane(
            static_cast<int>(srcHeight),
            static_cast<int>(srcWidth),
            CV_8UC1,
            const_cast<uint8_t *>(src.data()) + c * srcHeight * srcWidth);

        cv::Mat dstPlane(
            static_cast<int>(dstHeight),
            static_cast<int>(dstWidth),
            CV_8UC1,
            dst.data() + c * dstHeight * dstWidth);

        cv::resize(
            srcPlane,
            dstPlane,
            cv::Size(static_cast<int>(dstWidth), static_cast<int>(dstHeight)),
            0,
            0,
            interpolation);
    }

    return ImageData({channels, dstHeight, dstWidth}, std::move(dst));
}
