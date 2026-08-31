#include "training/infrastructure/image/OpenCvImageDecoder.hpp"
#include <opencv2/opencv.hpp>
#include <cstring>
#include <stdexcept>
#include <utility>
#include <vector>

OpenCvImageDecoder::OpenCvImageDecoder() {}

ImageData OpenCvImageDecoder::decode(const std::string &imagePath)
{
    // 画像の読み込み
    cv::Mat image = cv::imread(imagePath, cv::IMREAD_COLOR);

    if (image.empty())
    {
        throw std::runtime_error("OpenCvImageDecoder: failed to read image: " + imagePath);
    }

    // opencvでは基本bgrで読み込まれるため、bgrからrgbに変換する処理
    cv::cvtColor(image, image, cv::COLOR_BGR2RGB);

    const size_t height = static_cast<size_t>(image.rows);
    const size_t width = static_cast<size_t>(image.cols);
    const size_t channels = static_cast<size_t>(image.channels());

    // ImageDataへ詰め替え(HWC interleaved -> CHW planar)。
    // ImageDataは生成時にshapeとvaluesのサイズ整合が固定されるため、
    // ローカルバッファに詰め終えてから最後に一度だけ構築する。
    std::vector<uint8_t> values(channels * height * width);

    std::vector<cv::Mat> channelMats;
    cv::split(image, channelMats); // channelMats[0]=R, [1]=G, [2]=B の連続領域(CV_8UC1)を持つMatになる

    for (size_t c = 0; c < channels; ++c)
    {
        std::memcpy(
            values.data() + c * height * width,
            channelMats[c].data,
            height * width * sizeof(uint8_t));
    }

    return ImageData({channels, height, width}, std::move(values));
}
