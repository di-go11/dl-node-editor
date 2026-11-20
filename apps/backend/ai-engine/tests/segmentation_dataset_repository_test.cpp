// SegmentationDatasetRepository のシャッフル(段階 1)とデータ拡張の呼び出し(段階 2)、
// DatasetRepositoryFactory が train / validation で設定を分けることのテスト。CPU のみ。
//   - shuffle = false なら 0, 1, 2, … の順に読む
//   - shuffle = true なら、1 エポックで全サンプルをちょうど 1 回ずつ読み、エポックごとに順番が変わる
//   - 同じ dataSeed なら同じ順番、違う dataSeed なら違う順番
//   - augmenter は全サンプルに 1 回ずつ呼ばれ、sampleSeed は (dataSeed, エポック, サンプル番号) だけで決まる
//     (スレッド数・シャッフル順に関係しない)
//   - factory 経由: train は拡張され、validation は毎エポック同じ
#include <opencv2/opencv.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <numeric>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "training/adapters/impl/parallelProcessFn/SequentialExecutor.hpp"
#include "training/adapters/impl/parallelProcessFn/ThreadExecutor.hpp"
#include "training/adapters/impl/timer/NullTimeRecorder.hpp"
#include "training/application/interfaces/image/IImagePreprocessor.hpp"
#include "training/application/interfaces/image/ISegmentationAugmenter.hpp"
#include "training/entities/domain-objects/DataSpecs/DataSpec.hpp"
#include "training/entities/domain-objects/DatasetSplit.hpp"
#include "training/entities/domain-objects/ImageAnnotationConfig.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/LetterboxPolicy.hpp"
#include "training/infrastructure/dataset/DatasetRepositoryFactory.hpp"
#include "training/infrastructure/dataset/SegmentationDatasetRepository.hpp"
#include "training/infrastructure/dataset/interfaces/ISegmentationData.hpp"
#include "training/infrastructure/image/OpenCvImageDecoder.hpp"

namespace fs = std::filesystem;

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

    constexpr size_t kSampleCount = 10;
    constexpr unsigned int kBatchSize = 3; // 10 = 3 + 3 + 3 + 1(最後の端数バッチ)
    constexpr size_t kSide = 4;

    // サンプル i の画像は全画素が i + 1、マスクは全画素が i % 3。読んだバッチから番号を復元できるようにする。
    class FakeSegmentationData : public ISegmentationData
    {
    public:
        size_t size() const override { return kSampleCount; }
        ImageData getImage(size_t index) const override
        {
            return ImageData({1, kSide, kSide}, std::vector<uint8_t>(kSide * kSide, static_cast<uint8_t>(index + 1)));
        }
        ImageData getMask(size_t index) const override
        {
            return ImageData({1, kSide, kSide}, std::vector<uint8_t>(kSide * kSide, static_cast<uint8_t>(index % 3)));
        }
    };

    class IdentityPreprocessor : public IImagePreprocessor
    {
    public:
        ImageData process(const ImageData &image) const override { return image; }
    };

    // 呼ばれたサンプル番号と sampleSeed を記録し、マスクを 200 で塗る(拡張されたことの目印)。
    class RecordingAugmenter : public ISegmentationAugmenter
    {
    public:
        void apply(ImageData &image, ImageData &mask, uint64_t sampleSeed) const override
        {
            const size_t index = static_cast<size_t>(image.at(0, 0, 0)) - 1;
            {
                std::lock_guard<std::mutex> lock(_mutex);
                _calls.emplace_back(index, sampleSeed);
            }
            mask = ImageData(mask.shape(), std::vector<uint8_t>(mask.raw().size(), 200));
        }
        std::vector<std::pair<size_t, uint64_t>> takeCalls() const
        {
            std::lock_guard<std::mutex> lock(_mutex);
            return std::exchange(_calls, {});
        }

    private:
        mutable std::mutex _mutex;
        mutable std::vector<std::pair<size_t, uint64_t>> _calls;
    };

    std::shared_ptr<SegmentationDatasetRepository> makeRepository(bool shuffle, uint64_t seed,
                                                                  std::shared_ptr<ISegmentationAugmenter> augmenter = nullptr,
                                                                  std::shared_ptr<IParallelExecutor> executor = std::make_shared<SequentialExecutor>())
    {
        return std::make_shared<SegmentationDatasetRepository>(
            std::make_shared<FakeSegmentationData>(), std::make_shared<IdentityPreprocessor>(), std::make_shared<IdentityPreprocessor>(),
            std::make_shared<TrainParam>(1u, kBatchSize), std::move(executor), shuffle, std::move(augmenter), seed);
    }

    struct EpochRead
    {
        std::vector<size_t> order;       // 読んだサンプル番号の順番
        std::vector<size_t> batchSizes;  // バッチごとのサンプル数
        std::vector<uint8_t> maskValues; // 各サンプルのマスクの (0,0,0) の値
    };

    // 1 エポック分読む(学習ループと同じく、先頭で reset する)
    EpochRead readEpoch(IDatasetRepository &repository)
    {
        EpochRead read;
        repository.reset();
        while (repository.hasNext())
        {
            const TrainingBatch batch = repository.getNextBatch();
            read.batchSizes.push_back(batch.input.values.size());
            for (size_t k = 0; k < batch.input.values.size(); ++k)
            {
                const float v = batch.input.values[k].values.front();
                read.order.push_back(static_cast<size_t>(std::lround(v * 255.0f)) - 1);
                read.maskValues.push_back(batch.target.values[k].at(0, 0, 0));
            }
        }
        return read;
    }

    bool isPermutation(std::vector<size_t> order)
    {
        std::sort(order.begin(), order.end());
        std::vector<size_t> expected(kSampleCount);
        std::iota(expected.begin(), expected.end(), 0);
        return order == expected;
    }

    std::map<size_t, uint64_t> toMap(const std::vector<std::pair<size_t, uint64_t>> &calls)
    {
        return std::map<size_t, uint64_t>(calls.begin(), calls.end());
    }

    // ---- factory 経由のテスト用の、VOC 構成のデータセット(train / val とも同じ画像 1 枚) ----
    void writeText(const fs::path &path, const std::string &text)
    {
        fs::create_directories(path.parent_path());
        std::ofstream(path) << text;
    }

    fs::path writeTinyVocDataset()
    {
        const fs::path root = fs::temp_directory_path() / "segmentation_dataset_repository_test_voc";
        fs::remove_all(root);
        fs::create_directories(root / "JPEGImages");
        fs::create_directories(root / "SegmentationClass");
        writeText(root / "ImageSets" / "Segmentation" / "train.txt", "a\n");
        writeText(root / "ImageSets" / "Segmentation" / "val.txt", "a\n");

        // 横方向のグラデーション(拡大縮小・切り抜き・反転のどれでも画素が変わる)
        cv::Mat image(32, 32, CV_8UC3);
        for (int y = 0; y < 32; ++y)
            for (int x = 0; x < 32; ++x)
                image.at<cv::Vec3b>(y, x) = cv::Vec3b(static_cast<uchar>(x * 8), static_cast<uchar>(y * 8), 100);
        cv::imwrite((root / "JPEGImages" / "a.jpg").string(), image);

        // 左半分が aeroplane(128,0,0)、右半分が背景
        cv::Mat mask(32, 32, CV_8UC3, cv::Scalar(0, 0, 0));
        cv::rectangle(mask, cv::Rect(0, 0, 16, 32), cv::Scalar(0, 0, 128), cv::FILLED); // OpenCV は BGR
        cv::imwrite((root / "SegmentationClass" / "a.png").string(), mask);
        return root;
    }

    struct SampleRead
    {
        std::vector<float> image;
        std::vector<uint8_t> mask;
    };

    SampleRead readSingleSample(IDatasetRepository &repository)
    {
        repository.reset();
        const TrainingBatch batch = repository.getNextBatch();
        return SampleRead{batch.input.values.front().values, batch.target.values.front().raw()};
    }
} // namespace

int main()
{
    // ---------- shuffle = false ----------
    {
        auto repository = makeRepository(false, 0);
        const EpochRead first = readEpoch(*repository);
        const EpochRead second = readEpoch(*repository);
        std::vector<size_t> expected(kSampleCount);
        std::iota(expected.begin(), expected.end(), 0);
        check(first.order == expected && second.order == expected, "shuffle = false: 毎エポック 0, 1, 2, … の順に読む");
        check(first.batchSizes == std::vector<size_t>({3, 3, 3, 1}), "バッチは 3, 3, 3, 1(最後の端数バッチも読む)");
    }

    // ---------- shuffle = true ----------
    {
        auto repository = makeRepository(true, 42);
        std::vector<std::vector<size_t>> orders;
        bool allPermutations = true;
        for (int e = 0; e < 3; ++e)
        {
            const EpochRead read = readEpoch(*repository);
            allPermutations = allPermutations && isPermutation(read.order);
            orders.push_back(read.order);
        }
        check(allPermutations, "shuffle = true: 1 エポックで全サンプルをちょうど 1 回ずつ読む(重複・抜けなし)");
        check(orders[0] != orders[1] && orders[1] != orders[2], "shuffle = true: reset() のたびに順番が変わる");

        auto sameSeed = makeRepository(true, 42);
        bool sameOrders = true;
        for (int e = 0; e < 3; ++e)
            sameOrders = sameOrders && readEpoch(*sameSeed).order == orders[e];
        check(sameOrders, "同じ dataSeed なら、作り直しても同じ順番");

        auto otherSeed = makeRepository(true, 43);
        check(readEpoch(*otherSeed).order != orders[0], "違う dataSeed なら順番が変わる");
    }

    // ---------- augmenter なし ----------
    {
        auto repository = makeRepository(true, 0, nullptr);
        const EpochRead read = readEpoch(*repository);
        bool untouched = true;
        for (size_t k = 0; k < read.order.size(); ++k)
            untouched = untouched && read.maskValues[k] == read.order[k] % 3;
        check(untouched, "augmenter = nullptr: マスクはそのまま(拡張しない)");
    }

    // ---------- augmenter あり ----------
    {
        constexpr uint64_t kSeed = 7;
        auto augmenter = std::make_shared<RecordingAugmenter>();
        auto repository = makeRepository(false, kSeed, augmenter);

        std::vector<std::map<size_t, uint64_t>> seedsPerEpoch;
        bool allAugmented = true;
        bool calledOncePerSample = true;
        bool seedsMatchFormula = true;
        for (uint64_t epoch = 1; epoch <= 2; ++epoch)
        {
            const EpochRead read = readEpoch(*repository);
            for (uint8_t m : read.maskValues)
                allAugmented = allAugmented && m == 200;

            const auto calls = augmenter->takeCalls();
            const auto seeds = toMap(calls);
            calledOncePerSample = calledOncePerSample && calls.size() == kSampleCount && seeds.size() == kSampleCount;
            for (const auto &[index, seed] : seeds)
                seedsMatchFormula = seedsMatchFormula && seed == SegmentationDatasetRepository::sampleSeed(kSeed, epoch, index);
            seedsPerEpoch.push_back(seeds);
        }
        check(allAugmented, "augmenter あり: 読んだ全サンプルが拡張される");
        check(calledOncePerSample, "augmenter あり: 1 エポックで各サンプルに 1 回ずつ呼ばれる");
        check(seedsMatchFormula, "sampleSeed は sampleSeed(dataSeed, エポック, サンプル番号) と一致");

        bool differAcrossEpochs = true;
        for (const auto &[index, seed] : seedsPerEpoch[0])
            differAcrossEpochs = differAcrossEpochs && seedsPerEpoch[1].at(index) != seed;
        check(differAcrossEpochs, "同じサンプルでも、エポックが変われば sampleSeed が変わる");

        std::set<uint64_t> distinct;
        for (const auto &[index, seed] : seedsPerEpoch[0])
            distinct.insert(seed);
        check(distinct.size() == kSampleCount, "同じエポックの中では、サンプルごとに sampleSeed が違う");

        // 4 スレッド + シャッフルありでも、サンプル番号ごとの sampleSeed は逐次・シャッフルなしと同じ
        auto threadedAugmenter = std::make_shared<RecordingAugmenter>();
        auto threaded = makeRepository(true, kSeed, threadedAugmenter, std::make_shared<ThreadExecutor>(4));
        bool sameAsSequential = true;
        for (size_t e = 0; e < 2; ++e)
        {
            readEpoch(*threaded);
            sameAsSequential = sameAsSequential && toMap(threadedAugmenter->takeCalls()) == seedsPerEpoch[e];
        }
        check(sameAsSequential, "スレッド数・シャッフル順を変えても、同じ dataSeed ならサンプルごとの sampleSeed は同じ");
    }

    // ---------- factory 経由: train は拡張され、validation は拡張されない ----------
    {
        const fs::path root = writeTinyVocDataset();
        ImageSpec imageSpec;
        imageSpec.annotation = PascalVocConfig{};
        imageSpec.inputWidth = 32;
        imageSpec.inputHeight = 32;
        imageSpec.taskSpecs = SegmentationSpec{};
        const DataSpec dataSpec = imageSpec;

        DatasetRepositoryFactory factory(std::make_shared<OpenCvImageDecoder>(), LetterboxPolicy{}, std::make_shared<TrainParam>(1u, 1u),
                                         std::make_shared<NullTimeRecorder>(), std::make_shared<SequentialExecutor>(), /*dataSeed=*/0u);
        auto train = factory.create(dataSpec, root.string(), DatasetSplit::Train);
        auto val = factory.create(dataSpec, root.string(), DatasetSplit::Validation);

        const SampleRead valFirst = readSingleSample(*val);
        bool valStable = true;
        for (int e = 0; e < 3; ++e)
        {
            const SampleRead read = readSingleSample(*val);
            valStable = valStable && read.image == valFirst.image && read.mask == valFirst.mask;
        }
        check(valStable, "factory: validation は毎エポック同じ画像・マスク(拡張しない)");

        bool valMaskValuesOk = true;
        for (uint8_t m : valFirst.mask)
            valMaskValuesOk = valMaskValuesOk && (m == 0 || m == 1);
        check(valMaskValuesOk, "factory: validation のマスクは元のクラス ID だけ(余白なし)");

        int trainDiffers = 0;
        bool trainMaskValuesOk = true;
        for (int e = 0; e < 5; ++e)
        {
            const SampleRead read = readSingleSample(*train);
            if (read.image != valFirst.image || read.mask != valFirst.mask)
                ++trainDiffers;
            for (uint8_t m : read.mask)
                trainMaskValuesOk = trainMaskValuesOk && (m == 0 || m == 1 || m == 255);
        }
        check(trainDiffers >= 4, "factory: train は拡張される(5 エポック中 " + std::to_string(trainDiffers) + " 回、validation と違う)");
        check(trainMaskValuesOk, "factory: train のマスクの値は {0, 1, ignore_index} だけ");
    }

    if (failureCount == 0)
    {
        std::cout << "All tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
