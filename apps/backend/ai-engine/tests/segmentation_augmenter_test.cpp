// OpenCvSegmentationAugmenter(segmentation の train 用の幾何拡張)のテスト。CPU のみ。
//   - 出力サイズは常に入力と同じ W×H(縦横の取り違えに気づけるよう、W ≠ H で試す)
//   - マスクの値は元のクラス ID と ignore_index だけ(nearest で補間されている)
//   - 縮小したときの余白は、画像が 0、マスクが ignore_index
//   - 画像とマスクに同じ変換がかかる
//   - 同じ sampleSeed なら同じ結果、違う sampleSeed なら結果が変わる
//   - 左右反転は horizontalFlip = true のときだけ、確率 0.5 くらいでかかる
//   - 倍率の範囲が不正なら例外
#include <cstdint>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

#include "training/entities/image/AugmentationConfig.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/infrastructure/image/OpenCvSegmentationAugmenter.hpp"

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

    constexpr size_t kWidth = 32;
    constexpr size_t kHeight = 16;
    constexpr uint8_t kIgnore = 255;

    // 左半分が クラス 1 / 画素値 200、右半分が クラス 0 / 画素値 0 の画像とマスク。
    // 画像は 3 チャンネルとも同じ値にする(全チャンネルに同じ変換がかかるかを見るため)。
    ImageData makeHalfImage(size_t channels)
    {
        std::vector<uint8_t> values(channels * kHeight * kWidth);
        for (size_t c = 0; c < channels; ++c)
            for (size_t y = 0; y < kHeight; ++y)
                for (size_t x = 0; x < kWidth; ++x)
                    values[(c * kHeight + y) * kWidth + x] = (x < kWidth / 2) ? 200 : 0;
        return ImageData({channels, kHeight, kWidth}, std::move(values));
    }

    ImageData makeHalfMask()
    {
        std::vector<uint8_t> values(kHeight * kWidth);
        for (size_t y = 0; y < kHeight; ++y)
            for (size_t x = 0; x < kWidth; ++x)
                values[y * kWidth + x] = (x < kWidth / 2) ? 1 : 0;
        return ImageData({1, kHeight, kWidth}, std::move(values));
    }

    // 横方向のグラデーション(左右反転すると値が変わる)
    ImageData makeGradientImage()
    {
        std::vector<uint8_t> values(kHeight * kWidth);
        for (size_t y = 0; y < kHeight; ++y)
            for (size_t x = 0; x < kWidth; ++x)
                values[y * kWidth + x] = static_cast<uint8_t>(x * 8);
        return ImageData({1, kHeight, kWidth}, std::move(values));
    }

    bool shapeIs(const ImageData &img, size_t c, size_t h, size_t w)
    {
        return img.getChannels() == c && img.getHeight() == h && img.getWidth() == w && img.raw().size() == c * h * w;
    }

    bool isMirrorOf(const ImageData &a, const ImageData &b)
    {
        for (size_t c = 0; c < a.getChannels(); ++c)
            for (size_t y = 0; y < a.getHeight(); ++y)
                for (size_t x = 0; x < a.getWidth(); ++x)
                    if (a.at(c, y, x) != b.at(c, y, a.getWidth() - 1 - x))
                        return false;
        return true;
    }

    AugmentationConfig fixedScale(float scale, bool flip)
    {
        AugmentationConfig config;
        config.horizontalFlip = flip;
        config.scaleMin = scale;
        config.scaleMax = scale;
        return config;
    }
} // namespace

int main()
{
    const OpenCvSegmentationAugmenter defaultAugmenter(AugmentationConfig{}, kIgnore);

    // ---------- 既定値(固定値) ----------
    {
        const AugmentationConfig config;
        check(config.horizontalFlip && config.scaleMin == 0.5f && config.scaleMax == 2.0f,
              "AugmentationConfig の既定値は horizontalFlip = true, 倍率 0.5〜2.0");
    }

    // ---------- 出力サイズ・マスクの値・画像とマスクの対応(既定値の設定で 200 通りの seed) ----------
    {
        bool allShapesOk = true;
        bool maskValuesOk = true;
        bool imageMatchesMask = true;
        bool channelsEqual = true;
        bool sawIgnore = false;
        for (uint64_t seed = 0; seed < 200; ++seed)
        {
            ImageData image = makeHalfImage(3);
            ImageData mask = makeHalfMask();
            defaultAugmenter.apply(image, mask, seed);

            allShapesOk = allShapesOk && shapeIs(image, 3, kHeight, kWidth) && shapeIs(mask, 1, kHeight, kWidth);
            for (size_t y = 0; y < kHeight; ++y)
            {
                for (size_t x = 0; x < kWidth; ++x)
                {
                    const uint8_t m = mask.at(0, y, x);
                    const uint8_t v = image.at(0, y, x);
                    maskValuesOk = maskValuesOk && (m == 0 || m == 1 || m == kIgnore);
                    sawIgnore = sawIgnore || (m == kIgnore);
                    // 境目は画像が bilinear で中間の値になるので、余裕を持たせて比べる
                    if (m == 1)
                        imageMatchesMask = imageMatchesMask && v >= 50;
                    else if (m == 0)
                        imageMatchesMask = imageMatchesMask && v <= 150;
                    else
                        imageMatchesMask = imageMatchesMask && v == 0; // 余白は画像も 0
                    channelsEqual = channelsEqual && image.at(1, y, x) == v && image.at(2, y, x) == v;
                }
            }
        }
        check(allShapesOk, "出力サイズは常に入力と同じ(画像 3×16×32、マスク 1×16×32)");
        check(maskValuesOk, "マスクの値は {0, 1, ignore_index} だけ(nearest で補間されている)");
        check(imageMatchesMask, "画像とマスクに同じ変換がかかる(クラス 1 の画素は画像も明るく、余白は画像も 0)");
        check(channelsEqual, "画像の全チャンネルに同じ変換がかかる");
        check(sawIgnore, "200 通りの中に、縮小して余白ができる場合がある");
    }

    // ---------- 縮小(倍率 0.5 固定)の余白 ----------
    {
        const OpenCvSegmentationAugmenter augmenter(fixedScale(0.5f, false), kIgnore);
        ImageData image = makeHalfImage(1);
        ImageData mask = makeHalfMask();
        augmenter.apply(image, mask, 0);

        // 32×16 → 16×8 に縮小し、右と下に余白を足す。縦横を取り違えると余白の範囲がずれる
        bool paddingOk = true;
        bool contentOk = true;
        for (size_t y = 0; y < kHeight; ++y)
        {
            for (size_t x = 0; x < kWidth; ++x)
            {
                const bool inContent = (x < kWidth / 2) && (y < kHeight / 2);
                if (inContent)
                    contentOk = contentOk && mask.at(0, y, x) != kIgnore;
                else
                    paddingOk = paddingOk && mask.at(0, y, x) == kIgnore && image.at(0, y, x) == 0;
            }
        }
        check(paddingOk, "倍率 0.5: 右と下の余白は、マスクが ignore_index、画像が 0");
        check(contentOk, "倍率 0.5: 左上 16×8 には縮小した画像が入る(余白ではない)");
        check(mask.at(0, 0, 0) == 1 && mask.at(0, 0, 15) == 0, "倍率 0.5: 左半分(クラス 1)が左上 8 列に縮む");
    }

    // ---------- 拡大(倍率 2.0 固定)では余白ができない ----------
    {
        const OpenCvSegmentationAugmenter augmenter(fixedScale(2.0f, false), kIgnore);
        bool noIgnore = true;
        for (uint64_t seed = 0; seed < 50; ++seed)
        {
            ImageData image = makeHalfImage(1);
            ImageData mask = makeHalfMask();
            augmenter.apply(image, mask, seed);
            for (uint8_t m : mask.raw())
                noIgnore = noIgnore && m != kIgnore;
        }
        check(noIgnore, "倍率 2.0: 切り抜くだけなので、マスクに ignore_index は出ない");
    }

    // ---------- 同じ seed なら同じ結果、違う seed なら違う結果 ----------
    {
        ImageData image1 = makeGradientImage();
        ImageData mask1 = makeHalfMask();
        ImageData image2 = makeGradientImage();
        ImageData mask2 = makeHalfMask();
        defaultAugmenter.apply(image1, mask1, 12345);
        defaultAugmenter.apply(image2, mask2, 12345);
        check(image1.raw() == image2.raw() && mask1.raw() == mask2.raw(), "同じ sampleSeed なら同じ結果");

        std::set<std::vector<uint8_t>> distinct;
        for (uint64_t seed = 0; seed < 20; ++seed)
        {
            ImageData image = makeGradientImage();
            ImageData mask = makeHalfMask();
            defaultAugmenter.apply(image, mask, seed);
            distinct.insert(image.raw());
        }
        check(distinct.size() >= 15, "違う sampleSeed では結果が変わる(20 通り中 " + std::to_string(distinct.size()) + " 通り)");
    }

    // ---------- 左右反転(倍率 1.0 固定なので、変換は反転だけ) ----------
    {
        const ImageData original = makeGradientImage();

        const OpenCvSegmentationAugmenter flipOn(fixedScale(1.0f, true), kIgnore);
        int flipped = 0;
        int unchanged = 0;
        bool maskFollows = true;
        for (uint64_t seed = 0; seed < 200; ++seed)
        {
            ImageData image = makeGradientImage();
            ImageData mask = makeHalfMask();
            flipOn.apply(image, mask, seed);
            if (isMirrorOf(image, original))
            {
                ++flipped;
                maskFollows = maskFollows && isMirrorOf(mask, makeHalfMask());
            }
            else if (image.raw() == original.raw())
            {
                ++unchanged;
                maskFollows = maskFollows && mask.raw() == makeHalfMask().raw();
            }
        }
        check(flipped + unchanged == 200, "倍率 1.0: 結果は「そのまま」か「左右反転」のどちらか");
        check(flipped >= 70 && flipped <= 130, "horizontalFlip = true: 200 回中 " + std::to_string(flipped) + " 回反転(確率 0.5 くらい)");
        check(maskFollows, "反転したときはマスクも反転し、しないときはマスクもそのまま");

        const OpenCvSegmentationAugmenter flipOff(fixedScale(1.0f, false), kIgnore);
        bool neverFlipped = true;
        for (uint64_t seed = 0; seed < 50; ++seed)
        {
            ImageData image = makeGradientImage();
            ImageData mask = makeHalfMask();
            flipOff.apply(image, mask, seed);
            neverFlipped = neverFlipped && image.raw() == original.raw() && mask.raw() == makeHalfMask().raw();
        }
        check(neverFlipped, "horizontalFlip = false・倍率 1.0: 何も変わらない");
    }

    // ---------- 不正な設定・入力 ----------
    {
        auto throws = [](const AugmentationConfig &config)
        {
            try
            {
                OpenCvSegmentationAugmenter augmenter(config, kIgnore);
            }
            catch (const std::invalid_argument &)
            {
                return true;
            }
            return false;
        };
        AugmentationConfig zero;
        zero.scaleMin = 0.0f;
        AugmentationConfig reversed;
        reversed.scaleMin = 2.0f;
        reversed.scaleMax = 1.0f;
        check(throws(zero), "scaleMin = 0 は例外");
        check(throws(reversed), "scaleMin > scaleMax は例外");
        check(!throws(fixedScale(1.0f, true)), "scaleMin = scaleMax は有効");

        bool sizeMismatchThrows = false;
        try
        {
            ImageData image = makeHalfImage(1);
            ImageData mask({1, kHeight, kWidth / 2}, std::vector<uint8_t>(kHeight * kWidth / 2, 0));
            defaultAugmenter.apply(image, mask, 0);
        }
        catch (const std::invalid_argument &)
        {
            sizeMismatchThrows = true;
        }
        check(sizeMismatchThrows, "画像とマスクのサイズが違えば例外");
    }

    if (failureCount == 0)
    {
        std::cout << "All tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
