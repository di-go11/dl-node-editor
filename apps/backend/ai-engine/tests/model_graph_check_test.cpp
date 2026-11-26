// checkModelGraph(学習開始前のグラフの検証。gRPC の ValidateModelGraph が呼ぶ)のテスト。
//   - 正しいグラフでは問題なし
//   - 構造の問題があれば、それだけを返す(形は計算しない)
//   - 途中の層のチャンネル数のずれ、出力チャンネル数とクラス数のずれを、ノードの添字付きで返す
//   - クラス数はデータセットの形式から決まる(PascalVoc は 21 固定、Original は labelmap.txt)
//   - labelmap.txt が読めなければ TrainingPreconditionError
//   - segmentation 以外ではクラス数と比べない
// torch・GPU は使わない(リンクだけ ai_engine_lib に合わせる)。

#include "training/ModelGraphCheck.hpp"

#include "training/application/interfaces/ITrainingJobManager.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"

#include <cstddef>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

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

    Conv2DSpec conv(int64_t in, int64_t out)
    {
        Conv2DSpec spec;
        spec.inChannels = in;
        spec.outChannels = out;
        spec.kernelSize = 3;
        spec.padding = 1; // H / W を変えない
        return spec;
    }

    // グラフ入力 → conv1(3 → hidden)→ conv2(conv2In → classes)→ モデルの出力
    ModelGraph twoConvGraph(int64_t hidden, int64_t conv2In, int64_t classes)
    {
        ModelGraph graph;
        graph.nodes.push_back({"conv1", NodeSpec{conv(3, hidden)}, {NodeInput{"x", PortRef{"", ""}}}});
        graph.nodes.push_back({"conv2", NodeSpec{conv(conv2In, classes)}, {NodeInput{"x", PortRef{"conv1", "y"}}}});
        graph.outputs.push_back(PortRef{"conv2", "y"});
        return graph;
    }

    DataSpec imageSpec(ImageAnnotationConfig annotation, ImageTaskSpecs task)
    {
        ImageSpec image;
        image.annotation = annotation;
        image.inputWidth = 64;
        image.inputHeight = 48;
        image.taskSpecs = task;
        return DataSpec{image};
    }

    DataSpec vocSegmentation()
    {
        return imageSpec(PascalVocConfig{}, SegmentationSpec{});
    }

    constexpr int64_t kVocClasses = 21;

    bool contains(const std::string &text, const std::string &part)
    {
        return text.find(part) != std::string::npos;
    }
} // namespace

int main()
{
    // PascalVoc は labelmap.txt を読まないので、データセットのパスは何でもよい
    const std::string noDataset = "/nonexistent/dataset";

    // ---------- 正しいグラフ ----------
    {
        const auto errors = checkModelGraph(twoConvGraph(8, 8, kVocClasses), vocSegmentation(), noDataset);
        check(errors.empty(), "正しいグラフ: 問題なし");
    }

    // ---------- 構造の問題 ----------
    {
        ModelGraph graph = twoConvGraph(8, 8, 3); // クラス数も合っていないが、構造の問題だけが返るはず
        graph.nodes[1].inputs.clear();            // conv2 の必須ポート x を外す
        const auto errors = checkModelGraph(graph, vocSegmentation(), noDataset);
        check(errors.size() == 1, "構造の問題: 構造の問題だけを返す(形は計算しない)");
        check(!errors.empty() && errors[0].nodeIndex == std::optional<std::size_t>{1} && errors[0].port == "x",
              "構造の問題: 未接続のノードの添字とポート");
    }

    // ---------- 途中の層のチャンネル数のずれ ----------
    {
        const auto errors = checkModelGraph(twoConvGraph(8, 4, kVocClasses), vocSegmentation(), noDataset);
        check(errors.size() == 1 && errors[0].nodeIndex == std::optional<std::size_t>{1},
              "途中のずれ: conv2(添字 1)の in_channels が前の層と合わない");
    }

    // ---------- 出力チャンネル数とクラス数のずれ ----------
    {
        const auto errors = checkModelGraph(twoConvGraph(8, 8, 3), vocSegmentation(), noDataset);
        check(errors.size() == 1, "クラス数のずれ: 問題は 1 つ");
        check(!errors.empty() && errors[0].nodeIndex == std::optional<std::size_t>{1} &&
                  contains(errors[0].message, "クラス数(21)"),
              "クラス数のずれ: 出力しているノードの添字と、VOC のクラス数 21");
    }

    // ---------- Original: labelmap.txt からクラス数を求める ----------
    {
        const fs::path dir = fs::temp_directory_path() / "model_graph_check_test_original";
        fs::remove_all(dir);
        fs::create_directories(dir);
        {
            std::ofstream labelmap(dir / "labelmap.txt");
            // CVAT の書き出しと同じ形式(name:r,g,b::)。3 クラス
            labelmap << "# label:color_rgb:parts:actions\n"
                     << "background:0,0,0::\n"
                     << "cat:128,0,0::\n"
                     << "dog:0,128,0::\n";
        }
        const DataSpec original = imageSpec(OriginalConfig{}, SegmentationSpec{});
        check(checkModelGraph(twoConvGraph(8, 8, 3), original, dir.string()).empty(),
              "Original: labelmap.txt の 3 クラスと出力チャンネル数 3 が合う");
        check(checkModelGraph(twoConvGraph(8, 8, kVocClasses), original, dir.string()).size() == 1,
              "Original: 出力チャンネル数 21 は 3 クラスと合わない");
        fs::remove_all(dir);
    }

    // ---------- labelmap.txt が読めない ----------
    {
        bool precondition = false;
        try
        {
            checkModelGraph(twoConvGraph(8, 8, 3), imageSpec(OriginalConfig{}, SegmentationSpec{}), noDataset);
        }
        catch (const TrainingPreconditionError &)
        {
            precondition = true;
        }
        check(precondition, "labelmap.txt が読めない: TrainingPreconditionError");
    }

    // ---------- segmentation 以外はクラス数と比べない ----------
    {
        const auto errors = checkModelGraph(twoConvGraph(8, 8, 3), imageSpec(PascalVocConfig{}, ClassificationSpec{}),
                                            noDataset);
        check(errors.empty(), "classification: 出力チャンネル数とクラス数は比べない");
    }

    if (failureCount == 0)
    {
        std::cout << "All model graph check tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
