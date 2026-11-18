#include <opencv2/opencv.hpp>
#include <iostream>
#include <stdexcept>
#include <string>

#include "training/infrastructure/image/OpenCvImageDecoder.hpp"
#include "training/application/impl/image/ImageNormalizer.hpp"
#include "training/infrastructure/image/ColorMaskLabelConverter.hpp"
#include "training/entities/image/ColorLabelMap.hpp"
#include "training/entities/image/RgbColor.hpp"

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

    // 「規定されていない色のピクセルを持つアノテーション画像」のモックを作成
    void createMockAnnotationImageWithUnknownColor(const std::string &path)
    {
        cv::Mat mask(255, 255, CV_8UC3, cv::Scalar(0, 0, 0));                                 // 背景: 黒
        cv::rectangle(mask, cv::Rect(0, 0, 100, 255), cv::Scalar(125, 125, 255), cv::FILLED); // BGRのピンク(x: 0-99)
        cv::rectangle(mask, cv::Rect(150, 0, 105, 255), cv::Scalar(0, 255, 0), cv::FILLED);   // BGRの緑(x: 150-254)
        cv::rectangle(mask, cv::Rect(100, 0, 50, 255), cv::Scalar(255, 0, 0), cv::FILLED);    // BGRの青(x: 100-149)
        cv::imwrite(path, mask);
    }
} // namespace

int main()
{
    // スモークテスト(規定のピクセル値を持つモック画像を作成し、デコード・正規化・クラスID変換が正しく行われるかを確認)
    {
        const std::string imagePath = "/tmp/mock_training_image.png";
        const std::string maskPath = "/tmp/mock_annotation_image.png";

        createMockTrainingImage(imagePath);
        createMockAnnotationImage(maskPath);
        std::cout << "mock images created: " << imagePath << ", " << maskPath << std::endl;

        OpenCvImageDecoder decoder;

        // ---------- 学習用画像: デコード + 正規化 ----------
        ImageData rawInput = decoder.decode(imagePath);
        check(rawInput.shape().size() == 3 && rawInput.getChannels() == 3 && rawInput.getHeight() == 255 && rawInput.getWidth() == 255,
              "decode(training image): shape == {3,255,255}");
        check(rawInput.raw().size() == 3u * 255u * 255u,
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
        check(normalized.shape == rawInput.shape(), "normalize(): shape preserved");
        check(normalized.values.size() == rawInput.raw().size(), "normalize(): values size preserved");

        // ---------- アノテーション画像: デコード + クラスID変換 ----------
        ImageData rawMask = decoder.decode(maskPath);
        check(rawMask.shape().size() == 3 && rawMask.getChannels() == 3 && rawMask.getHeight() == 255 && rawMask.getWidth() == 255,
              "decode(mask image): shape == {3,255,255}");

        ColorLabelMap labelMap;
        labelMap.addEntry(RgbColor(0, 0, 0), 0);   // 背景
        labelMap.addEntry(RgbColor(255, 0, 0), 1); // クラスA(赤)
        labelMap.addEntry(RgbColor(0, 255, 0), 2); // クラスB(緑)

        ColorMaskLabelConverter converter(labelMap);
        ImageData classMap = converter.convert(rawMask);

        check(classMap.shape().size() == 3 && classMap.getChannels() == 1 && classMap.getHeight() == 255 && classMap.getWidth() == 255,
              "ColorMaskLabelConverter::convert(): shape == {1,255,255}");
        check(classMap.raw().size() == 255u * 255u,
              "ColorMaskLabelConverter::convert(): values.size() == 255*255");

        auto classAt = [&](size_t y, size_t x) -> int
        {
            return static_cast<int>(classMap.at(0, y, x));
        };

        check(classAt(10, 50) == 1, "class at (y=10,x=50) in red region == 1");
        check(classAt(10, 200) == 2, "class at (y=10,x=200) in green region == 2");
        check(classAt(10, 125) == 0, "class at (y=10,x=125) in background == 0");
    }
    // スモークテスト(規定されていない色のピクセルを持つアノテーション画像を作成し、クラスID変換が正しく行われるかを確認)
    {
        const std::string maskPath = "/tmp/mock_annotation_image_with_unknown_color.png";
        createMockAnnotationImageWithUnknownColor(maskPath);
        std::cout << "mock annotation image with unknown color created: " << maskPath << std::endl;

        OpenCvImageDecoder decoder;
        ImageData rawMask = decoder.decode(maskPath);

        ColorLabelMap labelMap;
        labelMap.addEntry(RgbColor(0, 0, 0), 0);   // 背景
        labelMap.addEntry(RgbColor(255, 0, 0), 1); // クラスA(赤)
        labelMap.addEntry(RgbColor(0, 255, 0), 2); // クラスB(緑)
        labelMap.addEntry(RgbColor(0, 0, 255), 3); // クラスC(青)

        // 無視する色を指定しないと、labelmap にない色(ピンク)はエラーになる。
        {
            ColorMaskLabelConverter converter(labelMap);
            bool thrown = false;
            std::string message;
            try
            {
                converter.convert(rawMask);
            }
            catch (const UnknownMaskColorError &e)
            {
                thrown = true;
                message = e.what();
            }
            check(thrown, "unknown color without ignore color throws UnknownMaskColorError");
            check(message.find("(255,125,125)") != std::string::npos, "error message names the unknown color (255,125,125)");
        }

        // ピンクを無視する色に指定すると、その画素だけが ignoreIndex になる。
        {
            ColorMaskLabelConverter converter(labelMap, /*ignoreIndex=*/200, RgbColor(255, 125, 125));
            ImageData classMap = converter.convert(rawMask);

            auto classAt = [&](size_t y, size_t x) -> int
            {
                return static_cast<int>(classMap.at(0, y, x));
            };

            check(classAt(10, 200) == 2, "class at (y=10,x=200) in green region == 2");
            check(classAt(10, 125) == 3, "class at (y=10,x=125) in blue region == 3");
            check(classAt(10, 50) == 200, "class at (y=10,x=50) in ignore color region == ignoreIndex(200)");
        }

        // 無視する色を指定しても、それ以外の未知の色はエラーになる。
        {
            ColorMaskLabelConverter converter(labelMap, 255, RgbColor(224, 224, 192));
            bool thrown = false;
            try
            {
                converter.convert(rawMask);
            }
            catch (const UnknownMaskColorError &)
            {
                thrown = true;
            }
            check(thrown, "unknown color other than the ignore color still throws");
        }

        // 無視する色が labelmap のクラスの色と同じなら、作成時に拒否する。
        {
            bool thrown = false;
            try
            {
                ColorMaskLabelConverter converter(labelMap, 255, RgbColor(0, 255, 0));
            }
            catch (const std::invalid_argument &)
            {
                thrown = true;
            }
            check(thrown, "ignore color equal to a labelmap class color is rejected");
        }
    }

    if (failureCount == 0)
    {
        std::cout << "All image pipeline tests passed." << std::endl;
        return 0;
    }

    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
