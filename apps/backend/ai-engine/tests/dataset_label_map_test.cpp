// データセットの形式(pascal_voc / original)ごとの色表と、それを使ったマスクの読み込みのテスト。
//   - PascalVoc: VOC のカラーマップ(21 クラス固定)。labelmap.txt は読まない
//   - Original : labelmap.txt から読む。なければエラー
//   - VocSegmentationData に PascalVoc の色表を渡すと、VOC のマスクの色がクラス ID になり、
//     void(224,224,192)は無視する色として ignore_index になる
#include <opencv2/opencv.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>

#include "training/entities/domain-objects/DatasetSplit.hpp"
#include "training/entities/domain-objects/ImageAnnotationConfig.hpp"
#include "training/entities/image/ColorLabelMap.hpp"
#include "training/entities/image/RgbColor.hpp"
#include "training/infrastructure/dataset/DatasetLabelMap.hpp"
#include "training/infrastructure/dataset/VocSegmentationData.hpp"
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

    // 空のデータセット置き場を作る(前回の残りは消す)
    fs::path freshDir(const std::string &name)
    {
        const fs::path dir = fs::temp_directory_path() / name;
        fs::remove_all(dir);
        fs::create_directories(dir);
        return dir;
    }

    void writeText(const fs::path &path, const std::string &text)
    {
        fs::create_directories(path.parent_path());
        std::ofstream(path) << text;
    }

    // VOC と同じ構成で、画像 1 枚(id = "a")のデータセットを作る。
    // マスクは左から 背景(黒)/ aeroplane(128,0,0)/ void(224,224,192)/ person(192,128,128)。
    // 本家のマスクはパレット PNG だが、OpenCV はパレットを RGB に展開して読むので、同じ色の RGB PNG で代用する。
    void writeVocLayoutDataset(const fs::path &root)
    {
        fs::create_directories(root / "JPEGImages");
        fs::create_directories(root / "SegmentationClass");
        writeText(root / "ImageSets" / "Segmentation" / "train.txt", "a\n");

        cv::Mat image(8, 8, CV_8UC3, cv::Scalar(10, 20, 30));
        cv::imwrite((root / "JPEGImages" / "a.jpg").string(), image);

        cv::Mat mask(8, 8, CV_8UC3, cv::Scalar(0, 0, 0)); // OpenCV は BGR の順
        cv::rectangle(mask, cv::Rect(2, 0, 2, 8), cv::Scalar(0, 0, 128), cv::FILLED);     // aeroplane
        cv::rectangle(mask, cv::Rect(4, 0, 2, 8), cv::Scalar(192, 224, 224), cv::FILLED); // void
        cv::rectangle(mask, cv::Rect(6, 0, 2, 8), cv::Scalar(128, 128, 192), cv::FILLED); // person
        cv::imwrite((root / "SegmentationClass" / "a.png").string(), mask);
    }
} // namespace

int main()
{
    // ---------- PascalVoc: VOC のカラーマップ ----------
    {
        const fs::path root = freshDir("dataset_label_map_test_voc");
        // 形式が PascalVoc なら、labelmap.txt があっても読まない(別のクラス数を書いておく)
        writeText(root / "labelmap.txt", "# label:color_rgb:parts:actions\nbackground:0,0,0::\nthing:1,2,3::\n");

        const ColorLabelMap labelMap = loadDatasetLabelMap(PascalVocConfig{}, root.string());
        check(labelMap.entryCount() == 21, "PascalVoc: クラス数は 21(labelmap.txt は読まない)");
        check(labelMap.resolveClassId(RgbColor(0, 0, 0)) == 0, "PascalVoc: (0,0,0) は background(0)");
        check(labelMap.resolveClassId(RgbColor(128, 0, 0)) == 1, "PascalVoc: (128,0,0) は aeroplane(1)");
        check(labelMap.resolveClassId(RgbColor(192, 128, 128)) == 15, "PascalVoc: (192,128,128) は person(15)");
        check(labelMap.resolveClassId(RgbColor(0, 64, 128)) == 20, "PascalVoc: (0,64,128) は tvmonitor(20)");
        check(labelMap.resolveClassId(RgbColor(224, 224, 192)) == -1, "PascalVoc: void(224,224,192)はクラスではない");
    }
    {
        // labelmap.txt がなくても読める(本家 VOC2012 の配布物にはない)
        const fs::path root = freshDir("dataset_label_map_test_voc_no_labelmap");
        check(loadDatasetLabelMap(PascalVocConfig{}, root.string()).entryCount() == 21,
              "PascalVoc: labelmap.txt がなくても 21 クラス");
    }

    // ---------- Original: labelmap.txt ----------
    {
        const fs::path root = freshDir("dataset_label_map_test_original");
        writeText(root / "labelmap.txt",
                  "# label:color_rgb:parts:actions\nbackground:0,0,0::\nbloccolli:36,179,83::\ncatted_bloccolli:250,50,83::\n");

        const ColorLabelMap labelMap = loadDatasetLabelMap(OriginalConfig{}, root.string());
        check(labelMap.entryCount() == 3, "Original: クラス数は labelmap.txt の行数(3)");
        check(labelMap.resolveClassId(RgbColor(36, 179, 83)) == 1, "Original: 2 行目の色はクラス 1");
        check(labelMap.resolveClassId(RgbColor(128, 0, 0)) == -1, "Original: VOC のカラーマップは使わない");
    }
    {
        const fs::path root = freshDir("dataset_label_map_test_original_missing");
        bool thrown = false;
        try
        {
            loadDatasetLabelMap(OriginalConfig{}, root.string());
        }
        catch (const std::runtime_error &e)
        {
            thrown = std::string(e.what()).find("labelmap.txt") != std::string::npos;
        }
        check(thrown, "Original: labelmap.txt がなければ、そのパスを含むエラー");
    }

    // ---------- VocSegmentationData + PascalVoc の色表 ----------
    {
        const fs::path root = freshDir("dataset_label_map_test_voc_mask");
        writeVocLayoutDataset(root);

        const ColorLabelMap labelMap = loadDatasetLabelMap(PascalVocConfig{}, root.string());
        VocSegmentationData data(root.string(), std::make_shared<OpenCvImageDecoder>(), labelMap, DatasetSplit::Train,
                                 /*ignoreIndex=*/255, RgbColor(224, 224, 192));
        check(data.size() == 1, "VocSegmentationData: train.txt の 1 件を読む");

        const ImageData mask = data.getMask(0);
        auto classAt = [&](size_t x) -> int
        {
            return static_cast<int>(mask.at(0, 3, x));
        };
        check(classAt(0) == 0, "マスク: 背景 → 0");
        check(classAt(2) == 1, "マスク: aeroplane の色 → 1");
        check(classAt(4) == 255, "マスク: void の色 → ignore_index(255)");
        check(classAt(6) == 15, "マスク: person の色 → 15");
    }
    {
        // 無視する色を指定しなければ、void は未知の色としてエラーになる
        const fs::path root = freshDir("dataset_label_map_test_voc_mask_no_ignore");
        writeVocLayoutDataset(root);

        VocSegmentationData data(root.string(), std::make_shared<OpenCvImageDecoder>(),
                                 loadDatasetLabelMap(PascalVocConfig{}, root.string()), DatasetSplit::Train);
        bool thrown = false;
        try
        {
            data.getMask(0);
        }
        catch (const std::runtime_error &)
        {
            thrown = true;
        }
        check(thrown, "マスク: 無視する色がなければ void はエラー");
    }

    if (failureCount > 0)
    {
        std::cout << failureCount << " test(s) failed." << std::endl;
        return 1;
    }
    std::cout << "All tests passed." << std::endl;
    return 0;
}
