#include "training/infrastructure/dataset/OpenCvImageDecoder.hpp"
#include <opencv2/opencv.hpp>

OpenCvImageDecoder::OpenCvImageDecoder() {}

ImageData OpenCvImageDecoder::decode(const std::string &imagePath)
{
    // 画像の読み込み
    cv::Mat image = cv::imread(imagePath, cv::IMREAD_COLOR);
}