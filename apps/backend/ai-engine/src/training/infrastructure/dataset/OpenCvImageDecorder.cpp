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

    // 8bit(0-255) -> float(0-1.0)に変換
    cv::Mat floatImage;
    // CV_8UC3(0-255の整数・3チャネル) -> CV_32FC3(float・チャネル) + 1.0/255.0倍で0.0-1.0に正規化
    image.convertTo(floatImage, CV_32FC3, 1.0 / 255.0);

    const int height = floatImage.rows;
    const int width = floatImage.cols;
    const int channels = floatImage.channels();

    // ImageDataへ詰め替え(HWC -> CWH)
    // shapeは{channels, height, width}の並びであるためここで構造体に入れる
    ImageData result;
    result.shape = {
        static_cast<size_t>(channels),
        static_cast<size_t>(height),
        static_cast<size_t>(width)};

    result.values.resize(static_cast<size_t>(channels) * height * width);

    // 処理が重いためこれは例
    /*
    for (int c = 0; c < channels; c++)
    {
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                float pixel = floatImage.at<cv::Vec3f>(y, x)[c];
                size_t chwindex = static_cast<size_t>(c) * height * width + static_cast<size_t>(y) * width + x;
                result.values[chwindex] = pixel;
            }
        }
    }*/

    std::vector<cv::Mat> channelMats;
    cv::split(floatImage, channelMats); // channelMats[0]=R, [1]=G, [2]=B の連続領域を持つMatになる

    for (int c = 0; c < channels; ++c)
    {
        std::memcpy(
            result.values.data() + static_cast<size_t>(c) * height * width,
            channelMats[c].data,
            static_cast<size_t>(height) * width * sizeof(float));
    }

    return result;
}