#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/ResizeParam.hpp"
#include "training/infrastructure/image/OpenCvImageResizer.hpp"

namespace
{
int failureCount = 0;

void check(bool condition, const std::string &message)
{
    std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
    if (!condition)
    {
        ++failureCount;
    }
}

// channels x height x width の、全画素が value の ImageData を作る。
ImageData makeConstImage(size_t channels, size_t height, size_t width, uint8_t value)
{
    std::vector<uint8_t> values(channels * height * width, value);
    return ImageData({channels, height, width}, std::move(values));
}

bool shapeIs(const ImageData &img, size_t c, size_t h, size_t w)
{
    return img.getChannels() == c && img.getHeight() == h && img.getWidth() == w &&
           img.raw().size() == c * h * w;
}

// 指定した列がすべて expected か(全チャンネル・全行)。
bool columnEquals(const ImageData &img, size_t x, uint8_t expected)
{
    for (size_t c = 0; c < img.getChannels(); ++c)
    {
        for (size_t y = 0; y < img.getHeight(); ++y)
        {
            if (img.at(c, y, x) != expected)
            {
                return false;
            }
        }
    }
    return true;
}

bool allEquals(const ImageData &img, uint8_t expected)
{
    for (uint8_t v : img.raw())
    {
        if (v != expected)
        {
            return false;
        }
    }
    return true;
}
} // namespace

int main()
{
    // ---------- Warp: アスペクト比を無視して目標サイズへ ----------
    {
        ResizeParam param;
        param.width = 40;
        param.height = 20;
        param.aspectRatioPolicy = WarpPolicy{};

        OpenCvImageResizer resizer(param);
        ImageData out = resizer.process(makeConstImage(3, 100, 50, 200));

        check(shapeIs(out, 3, 20, 40), "Warp: shape == {3,20,40}");
        check(allEquals(out, 200), "Warp: 一様画像は値が保存される");
    }

    // ---------- 既に目的サイズ: そのまま返る ----------
    {
        ResizeParam param;
        param.width = 32;
        param.height = 32;
        param.aspectRatioPolicy = WarpPolicy{};

        OpenCvImageResizer resizer(param);
        ImageData out = resizer.process(makeConstImage(3, 32, 32, 123));

        check(shapeIs(out, 3, 32, 32), "passthrough: shape 維持");
        check(allEquals(out, 123), "passthrough: 値そのまま");
    }

    // ---------- Letterbox: アスペクト比保持 + パディング ----------
    {
        ResizeParam param;
        param.width = 40;
        param.height = 40;
        LetterboxPolicy lb;
        lb.paddingValue = 128;
        lb.anchor = LetterboxAnchor::Center;
        param.aspectRatioPolicy = lb;

        OpenCvImageResizer resizer(param);
        // src は H=100,W=50 の縦長。scale = min(40/50, 40/100) = 0.4
        //   -> inner W=20, H=40。左右に (40-20)/2 = 10px ずつパディング。
        ImageData out = resizer.process(makeConstImage(3, 100, 50, 200));

        check(shapeIs(out, 3, 40, 40), "Letterbox: shape == {3,40,40}");
        check(columnEquals(out, 0, 128) && columnEquals(out, 9, 128),
              "Letterbox: 左端10列がパディング値");
        check(columnEquals(out, 30, 128) && columnEquals(out, 39, 128),
              "Letterbox: 右端10列がパディング値");
        check(columnEquals(out, 10, 200) && columnEquals(out, 29, 200),
              "Letterbox: 中央20列は元画像の値");
    }

    // ---------- Letterbox: anchor=TopLeft は余白を右へ寄せる ----------
    {
        ResizeParam param;
        param.width = 40;
        param.height = 40;
        LetterboxPolicy lb;
        lb.paddingValue = 128;
        lb.anchor = LetterboxAnchor::TopLeft;
        param.aspectRatioPolicy = lb;

        OpenCvImageResizer resizer(param);
        ImageData out = resizer.process(makeConstImage(3, 100, 50, 200));

        check(columnEquals(out, 0, 200) && columnEquals(out, 19, 200),
              "Letterbox(TopLeft): 左20列が元画像");
        check(columnEquals(out, 20, 128) && columnEquals(out, 39, 128),
              "Letterbox(TopLeft): 右20列がパディング");
    }

    // ---------- CenterCrop: アスペクト比保持で覆ってから中央切り出し ----------
    {
        ResizeParam param;
        param.width = 40;
        param.height = 40;
        CenterCropPolicy cc;
        cc.anchor = CropAnchor::Center;
        param.aspectRatioPolicy = cc;

        OpenCvImageResizer resizer(param);
        // src H=100,W=50。scale = max(40/50, 40/100) = 0.8 -> cover W=40, H=80。
        //   縦を 40 に中央トリミング。
        ImageData out = resizer.process(makeConstImage(3, 100, 50, 200));

        check(shapeIs(out, 3, 40, 40), "CenterCrop: shape == {3,40,40}");
        check(allEquals(out, 200), "CenterCrop: 一様画像は値が保存される(0埋め領域なし)");
    }

    if (failureCount == 0)
    {
        std::cout << "All image resize tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
