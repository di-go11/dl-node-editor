#include "training/infrastructure/dataset/OpenCvImageDecoder.hpp"
#include <opencv2/opencv.hpp>
#include <stdexcept>

OpenCvImageDecoder::OpenCvImageDecoder() {}

ImageData OpenCvImageDecoder::decode(const std::string &imagePath)
{
    // 画像の読み込み
    cv::Mat image = cv::imread(imagePath, cv::IMREAD_COLOR);

    if (image.empty())
    {
        throw std::runtime_error("error: import image!");
    }

    // opencvでは基本bgrで読み込まれるため、bgrからrgbに変換する処理
    cv::cvtColor(image, image, cv::COLOR_BGR2RGB);

    const int height = image.rows;
    const int width = image.cols;
    const int channels = image.channels();

    // ImageDataへ詰め替え(HWC -> CHW)
    // shapeは{channels, height, width}の並びであるためここで構造体に入れる
    ImageData result;
    result.shape = {
        static_cast<size_t>(channels),
        static_cast<size_t>(height),
        static_cast<size_t>(width)};

    result.values.resize(static_cast<size_t>(channels) * height * width);

    std::vector<cv::Mat> channelMats;
    cv::split(image, channelMats); // channelMats[0]=R, [1]=G, [2]=B の連続領域(CV_8UC1)を持つMatになる

    for (int c = 0; c < channels; ++c)
    {
        std::memcpy(
            result.values.data() + static_cast<size_t>(c) * height * width,
            channelMats[c].data,
            static_cast<size_t>(height) * width * sizeof(uint8_t));
    }

    return result;
}
