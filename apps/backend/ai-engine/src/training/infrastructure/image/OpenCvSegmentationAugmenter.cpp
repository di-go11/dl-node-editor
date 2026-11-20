#include "training/infrastructure/image/OpenCvSegmentationAugmenter.hpp"

#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <random>
#include <stdexcept>
#include <utility>
#include <vector>

namespace
{
    // 1 サンプル分の変換の内容。画像とマスクに同じ値を使う。
    struct TransformParams
    {
        int scaledWidth;
        int scaledHeight;
        int cropX;
        int cropY;
        bool flip;
    };

    // 1 チャンネル分の変換: 拡大縮小 → 余白(右・下)→ 切り抜き → 左右反転
    cv::Mat transformPlane(const cv::Mat &src, const TransformParams &p,
                           int outWidth, int outHeight, int interpolation, uint8_t fillValue)
    {
        cv::Mat scaled;
        cv::resize(src, scaled, cv::Size(p.scaledWidth, p.scaledHeight), 0, 0, interpolation);

        // 入力サイズより小さい辺は、右・下に余白を足して入力サイズにそろえる
        const int padRight = std::max(0, outWidth - p.scaledWidth);
        const int padBottom = std::max(0, outHeight - p.scaledHeight);
        cv::Mat padded;
        cv::copyMakeBorder(scaled, padded, 0, padBottom, 0, padRight,
                           cv::BORDER_CONSTANT, cv::Scalar(fillValue));

        // 入力サイズより大きい辺は、(cropX, cropY) から W×H を切り抜く。
        // 切り抜いた Mat は元の Mat のメモリを参照していて連続していないので、clone で連続したメモリにする
        cv::Mat out = padded(cv::Rect(p.cropX, p.cropY, outWidth, outHeight)).clone();

        if (p.flip)
        {
            cv::flip(out, out, 1); // 1 = 左右反転
        }
        return out;
    }

    // ImageData(CHW 平坦)の全チャンネルに同じ変換をかける
    ImageData transformImage(const ImageData &src, const TransformParams &p,
                             int interpolation, uint8_t fillValue)
    {
        const size_t channels = src.getChannels();
        const size_t height = src.getHeight();
        const size_t width = src.getWidth();
        const size_t planeSize = height * width;

        std::vector<uint8_t> values(channels * planeSize);
        for (size_t c = 0; c < channels; ++c)
        {
            // CHW 平坦なので、チャンネル c のプレーンは raw() の中で連続している。コピーせずに参照する
            const cv::Mat plane(static_cast<int>(height), static_cast<int>(width), CV_8UC1,
                                const_cast<uint8_t *>(src.raw().data() + c * planeSize));

            const cv::Mat out = transformPlane(plane, p, static_cast<int>(width), static_cast<int>(height),
                                               interpolation, fillValue);
            std::memcpy(values.data() + c * planeSize, out.data, planeSize);
        }
        return ImageData(src.shape(), std::move(values));
    }
} // namespace

OpenCvSegmentationAugmenter::OpenCvSegmentationAugmenter(const AugmentationConfig &config, uint8_t ignoreIndex)
    : _config(config), _ignoreIndex(ignoreIndex)
{
    // NaN も弾けるように、否定の形で書く
    if (!(0.0f < _config.scaleMin && _config.scaleMin <= _config.scaleMax))
    {
        throw std::invalid_argument("OpenCvSegmentationAugmenter: 0 < scaleMin <= scaleMax である必要があります");
    }
}

void OpenCvSegmentationAugmenter::apply(ImageData &image, ImageData &mask, uint64_t sampleSeed) const
{
    if (image.getHeight() != mask.getHeight() || image.getWidth() != mask.getWidth())
    {
        throw std::invalid_argument("OpenCvSegmentationAugmenter: 画像とマスクのサイズが一致していません");
    }

    const int width = static_cast<int>(image.getWidth());
    const int height = static_cast<int>(image.getHeight());

    // 乱数はここで全部決める(画像とマスクに同じ値を使うため)
    std::mt19937_64 rng(sampleSeed);

    // scaleMin == scaleMax でも uniform_real_distribution は scaleMin を返すので、そのまま使える
    const float scale = std::uniform_real_distribution<float>(_config.scaleMin, _config.scaleMax)(rng);

    TransformParams p{};
    p.scaledWidth = std::max(1, static_cast<int>(std::lround(width * scale)));
    p.scaledHeight = std::max(1, static_cast<int>(std::lround(height * scale)));

    // 余白を足した後のサイズ。ここから W×H を切り抜くので、切り抜き位置は 0〜(余白後 − W)
    const int paddedWidth = std::max(width, p.scaledWidth);
    const int paddedHeight = std::max(height, p.scaledHeight);
    p.cropX = std::uniform_int_distribution<int>(0, paddedWidth - width)(rng);
    p.cropY = std::uniform_int_distribution<int>(0, paddedHeight - height)(rng);

    p.flip = _config.horizontalFlip && std::bernoulli_distribution(0.5)(rng);

    image = transformImage(image, p, cv::INTER_LINEAR, 0);
    mask = transformImage(mask, p, cv::INTER_NEAREST, _ignoreIndex);
}
