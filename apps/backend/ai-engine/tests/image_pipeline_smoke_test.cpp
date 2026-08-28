#include <opencv2/opencv.hpp>
#include <iostream>
#include <string>

#include "training/infrastructure/dataset/OpenCvImageDecoder.hpp"
#include "training/adapters/impl/ImageNormalizer.hpp"
#include "training/infrastructure/dataset/ColorMaskLabelConverter.hpp"
#include "training/entities/segmentation/ColorLabelMap.hpp"
#include "training/entities/domain-objects/RgbColor.hpp"

namespace
{
    int failureCount = 0;

    void check(bool condition, const std::string &message)
    {
        if (condition)
        {
            std::cout << "[PASS] " << message << std::endl;
        }
        else
        {
            std::cout << "[FAIL] " << message << std::endl;
            ++failureCount;
        }
    }

    // 255x255のランダムなカラー画像を「学習用画像」のモックとして作成
    void createMockTrainingImage(const std::string &path)
    {
        cv::Mat image(255, 255, CV_8UC3);
        cv::randu(image, cv::Scalar(0, 0, 0), cv::Scalar(255, 255, 255));
        cv::imwrite(path, image);
    }

    // 背景(黒)/クラスA(赤)/クラスB(緑)に塗り分けた255x255の画像を
    // 「アノテーション(マスク)画像」のモックとして作成
    void createMockAnnotationImage(const std::string &path)
    {
        cv::Mat mask(255, 255, CV_8UC3, cv::Scalar(0, 0, 0));                               // 背景: 黒
        cv::rectangle(mask, cv::Rect(0, 0, 100, 255), cv::Scalar(0, 0, 255), cv::FILLED);   // BGRの赤(x: 0-99)
        cv::rectangle(mask, cv::Rect(150, 0, 105, 255), cv::Scalar(0, 255, 0), cv::FILLED); // BGRの緑(x: 150-254)
        cv::imwrite(path, mask);
    }
} // namespace

int main()
{
    const std::string imagePath = "/tmp/mock_training_image.png";
    const std::string maskPath = "/tmp/mock_annotation_image.png";

    createMockTrainingImage(imagePath);
    createMockAnnotationImage(maskPath);
    std::cout << "mock images created: " << imagePath << ", " << maskPath << std::endl;

    OpenCvImageDecoder decoder;

    // ---------- 学習用画像: デコード + 正規化 ----------
    ImageData rawInput = decoder.decode(imagePath);
    check(rawInput.shape.size() == 3 && rawInput.shape[0] == 3 && rawInput.shape[1] == 255 && rawInput.shape[2] == 255,
          "decode(training image): shape == {3,255,255}");
    check(rawInput.values.size() == 3u * 255u * 255u,
          "decode(training image): values.size() == 3*255*255");

    NormalizedImageData normalized = ImageNormalizer::normalize(rawInput);
    bool allInRange = true;
    for (float v : normalized.values)
    {
        if (v < 0.0f || v > 1.0f)
        {
            allInRange = false;
            break;
        }
    }
    check(allInRange, "normalize(): all values within [0.0, 1.0]");
    check(normalized.shape == rawInput.shape, "normalize(): shape preserved");
    check(normalized.values.size() == rawInput.values.size(), "normalize(): values size preserved");

    // ---------- アノテーション画像: デコード + クラスID変換 ----------
    ImageData rawMask = decoder.decode(maskPath);
    check(rawMask.shape.size() == 3 && rawMask.shape[0] == 3 && rawMask.shape[1] == 255 && rawMask.shape[2] == 255,
          "decode(mask image): shape == {3,255,255}");

    ColorLabelMap labelMap;
    labelMap.addEntry(RgbColor(0, 0, 0), 0);   // 背景
    labelMap.addEntry(RgbColor(255, 0, 0), 1); // クラスA(赤)
    labelMap.addEntry(RgbColor(0, 255, 0), 2); // クラスB(緑)

    ColorMaskLabelConverter converter(labelMap);
    ImageData classMap = converter.convert(rawMask);

    check(classMap.shape.size() == 3 && classMap.shape[0] == 1 && classMap.shape[1] == 255 && classMap.shape[2] == 255,
          "ColorMaskLabelConverter::convert(): shape == {1,255,255}");
    check(classMap.values.size() == 255u * 255u,
          "ColorMaskLabelConverter::convert(): values.size() == 255*255");

    auto classAt = [&](size_t y, size_t x) -> int
    {
        return static_cast<int>(classMap.values[y * 255 + x]);
    };

    check(classAt(10, 50) == 1, "class at (y=10,x=50) in red region == 1");
    check(classAt(10, 200) == 2, "class at (y=10,x=200) in green region == 2");
    check(classAt(10, 125) == 0, "class at (y=10,x=125) in background == 0");

    if (failureCount == 0)
    {
        std::cout << "All image pipeline tests passed." << std::endl;
        return 0;
    }

    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
