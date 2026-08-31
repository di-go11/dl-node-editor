#include "training/infrastructure/image/OpenCvImageResizer.hpp"

#include <opencv2/opencv.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <utility>
#include <variant>
#include <vector>

namespace
{
// std::visit 用の overloaded ヘルパー(C++17)。
template <class... Ts>
struct overloaded : Ts...
{
    using Ts::operator()...;
};
template <class... Ts>
overloaded(Ts...) -> overloaded<Ts...>;

// slack(= 余ったピクセル数)を anchor に応じて左・上へどれだけ割り当てるかを返す。
size_t frontOffset(size_t slack, bool front, bool center)
{
    if (center)
    {
        return slack / 2;
    }
    return front ? 0 : slack;
}
} // namespace

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

std::vector<cv::Mat> OpenCvImageResizer::resizePlanes(
    const ImageData &src, size_t dstHeight, size_t dstWidth) const
{
    const size_t channels = src.getChannels();
    const size_t srcHeight = src.getHeight();
    const size_t srcWidth = src.getWidth();

    const bool shrinking = (dstWidth < srcWidth) || (dstHeight < srcHeight);
    const int interpolation = toCvInterpolation(_resizeParam.interpolationMethod, shrinking);

    // ImageData は CHW 平坦なので、各チャンネルのプレーンは raw() 内で連続している。
    // その連続領域を cv::Mat ヘッダで「コピーせず」参照し、チャンネルごとに resize する。
    const std::vector<uint8_t> &data = src.raw();

    std::vector<cv::Mat> planes;
    planes.reserve(channels);

    for (size_t c = 0; c < channels; ++c)
    {
        const cv::Mat srcPlane(
            static_cast<int>(srcHeight),
            static_cast<int>(srcWidth),
            CV_8UC1,
            const_cast<uint8_t *>(data.data()) + c * srcHeight * srcWidth);

        cv::Mat dstPlane; // resize がデータを確保する(Mat がバッファを所有)。
        cv::resize(
            srcPlane,
            dstPlane,
            cv::Size(static_cast<int>(dstWidth), static_cast<int>(dstHeight)),
            0,
            0,
            interpolation);

        planes.push_back(std::move(dstPlane));
    }

    return planes;
}

ImageData OpenCvImageResizer::planesToImageData(const std::vector<cv::Mat> &planes)
{
    const size_t channels = planes.size();
    const size_t height = static_cast<size_t>(planes.front().rows);
    const size_t width = static_cast<size_t>(planes.front().cols);

    std::vector<uint8_t> values(channels * height * width);
    for (size_t c = 0; c < channels; ++c)
    {
        const cv::Mat &plane = planes[c];
        // Mat は行ごとにパディングを持ちうるので、行単位でコピーして CHW 平坦へ詰める。
        for (size_t y = 0; y < height; ++y)
        {
            const uint8_t *row = plane.ptr<uint8_t>(static_cast<int>(y));
            std::copy(row, row + width, values.data() + (c * height + y) * width);
        }
    }

    return ImageData({channels, height, width}, std::move(values));
}

ImageData OpenCvImageResizer::applyWarp(const ImageData &src) const
{
    // アスペクト比を無視して目標サイズへ直接引き伸ばす。
    return planesToImageData(resizePlanes(src, _resizeParam.height, _resizeParam.width));
}

ImageData OpenCvImageResizer::applyLetterbox(const ImageData &src, const LetterboxPolicy &policy) const
{
    const size_t dstW = _resizeParam.width;
    const size_t dstH = _resizeParam.height;
    const double srcW = static_cast<double>(src.getWidth());
    const double srcH = static_cast<double>(src.getHeight());

    // 目標矩形に収まる最大スケール(アスペクト比保持)。
    double scale = std::min(dstW / srcW, dstH / srcH);
    if (!policy.allowUpscale)
    {
        scale = std::min(scale, 1.0);
    }

    const size_t innerW = std::min<size_t>(
        dstW, std::max<size_t>(1, static_cast<size_t>(std::lround(srcW * scale))));
    const size_t innerH = std::min<size_t>(
        dstH, std::max<size_t>(1, static_cast<size_t>(std::lround(srcH * scale))));

    const std::vector<cv::Mat> inner = resizePlanes(src, innerH, innerW);

    const bool center = policy.anchor == LetterboxAnchor::Center;
    const int left = static_cast<int>(frontOffset(dstW - innerW, true, center));
    const int top = static_cast<int>(frontOffset(dstH - innerH, true, center));
    const int right = static_cast<int>(dstW - innerW) - left;
    const int bottom = static_cast<int>(dstH - innerH) - top;

    std::vector<cv::Mat> planes;
    planes.reserve(inner.size());
    for (const cv::Mat &plane : inner)
    {
        cv::Mat padded;
        cv::copyMakeBorder(
            plane, padded, top, bottom, left, right, cv::BORDER_CONSTANT,
            cv::Scalar(policy.paddingValue));
        planes.push_back(std::move(padded));
    }

    return planesToImageData(planes);
}

ImageData OpenCvImageResizer::applyCenterCrop(
    const ImageData &src, const CenterCropPolicy &policy) const
{
    const size_t dstW = _resizeParam.width;
    const size_t dstH = _resizeParam.height;
    const double srcW = static_cast<double>(src.getWidth());
    const double srcH = static_cast<double>(src.getHeight());

    // 目標矩形を覆う最小スケール(アスペクト比保持)。
    double scale = std::max(dstW / srcW, dstH / srcH);
    if (!policy.allowUpscale)
    {
        scale = std::min(scale, 1.0);
    }

    const size_t coverW = std::max<size_t>(1, static_cast<size_t>(std::lround(srcW * scale)));
    const size_t coverH = std::max<size_t>(1, static_cast<size_t>(std::lround(srcH * scale)));

    const std::vector<cv::Mat> cover = resizePlanes(src, coverH, coverW);

    // 通常は cover >= dst。allowUpscale=false で覆えないときは取れる範囲だけ切り出し、
    // 残りは 0 埋めのままにする(パディングではなくトリミングの Policy なので)。
    const size_t cropW = std::min(dstW, coverW);
    const size_t cropH = std::min(dstH, coverH);

    const bool leftX = policy.anchor == CropAnchor::TopLeft || policy.anchor == CropAnchor::BottomLeft;
    const bool topY = policy.anchor == CropAnchor::TopLeft || policy.anchor == CropAnchor::TopRight;
    const bool center = policy.anchor == CropAnchor::Center;

    const size_t srcX = frontOffset(coverW - cropW, leftX, center);
    const size_t srcY = frontOffset(coverH - cropH, topY, center);
    const cv::Rect roi(
        static_cast<int>(srcX), static_cast<int>(srcY),
        static_cast<int>(cropW), static_cast<int>(cropH));

    // 覆えなかった場合の配置は中央固定にしておく。
    const size_t dstX = (dstW - cropW) / 2;
    const size_t dstY = (dstH - cropH) / 2;
    const cv::Rect dstRoi(
        static_cast<int>(dstX), static_cast<int>(dstY),
        static_cast<int>(cropW), static_cast<int>(cropH));

    std::vector<cv::Mat> planes;
    planes.reserve(cover.size());
    for (const cv::Mat &plane : cover)
    {
        cv::Mat out(static_cast<int>(dstH), static_cast<int>(dstW), CV_8UC1, cv::Scalar(0));
        plane(roi).copyTo(out(dstRoi));
        planes.push_back(std::move(out));
    }

    return planesToImageData(planes);
}

ImageData OpenCvImageResizer::process(const ImageData &rowImage) const
{
    // 既に目的サイズなら resize 系を一切呼ばずそのまま返す。
    if (rowImage.getHeight() == _resizeParam.height && rowImage.getWidth() == _resizeParam.width)
    {
        return rowImage;
    }

    return std::visit(
        overloaded{
            [&](const WarpPolicy &) { return applyWarp(rowImage); },
            [&](const LetterboxPolicy &p) { return applyLetterbox(rowImage, p); },
            [&](const CenterCropPolicy &p) { return applyCenterCrop(rowImage, p); },
        },
        _resizeParam.aspectRatioPolicy);
}
