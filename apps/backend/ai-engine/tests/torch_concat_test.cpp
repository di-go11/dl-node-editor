#include "training/entities/domain-objects/ModelGraph/Layers/ConcatSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/NodeShapeRules.hpp"
#include "training/entities/domain-objects/ModelGraph/PortShape.hpp"
#include "training/infrastructure/torchFunc/TorchConcatLayer.hpp"

#include <torch/torch.h>

#include <iostream>
#include <string>
#include <variant>
#include <vector>

namespace
{
    int failureCount = 0;
    constexpr int64_t kBatch = 2;

    void check(bool condition, const std::string &message)
    {
        std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
        if (!condition)
        {
            ++failureCount;
        }
    }

    bool sameShape(const FeatureMapShape &expected, const at::Tensor &actual)
    {
        return actual.dim() == 4 && actual.size(0) == kBatch && actual.size(1) == expected.channels &&
               actual.size(2) == expected.height && actual.size(3) == expected.width;
    }

    at::Tensor randFeatureMap(const FeatureMapShape &shape)
    {
        return torch::rand({kBatch, shape.channels, shape.height, shape.width});
    }

    const FeatureMapShape *singleFeatureMap(const ShapeResult &result)
    {
        if (!result.ok() || result.outputs.size() != 1)
        {
            return nullptr;
        }
        return std::get_if<FeatureMapShape>(&result.outputs[0]);
    }

    void checkForwardMatchesShapeRule(const std::vector<FeatureMapShape> &inShapes, const std::string &name)
    {
        std::vector<PortShape> portShapes;
        std::vector<at::Tensor> tensors;
        for (const FeatureMapShape &shape : inShapes)
        {
            portShapes.push_back(PortShape{shape});
            tensors.push_back(randFeatureMap(shape));
        }

        const ShapeResult inferred = inferOutputShapes(ConcatSpec{}, portShapes);
        const FeatureMapShape *expected = singleFeatureMap(inferred);
        check(expected != nullptr, name + ": 形状推論が通る");
        if (expected == nullptr)
        {
            std::cout << "    error: " << inferred.error << std::endl;
            return;
        }

        const std::vector<at::Tensor> outputs = TorchConcatLayer(ConcatSpec{}).forward(tensors);
        check(outputs.size() == 1 && sameShape(*expected, outputs[0]),
              name + ": forward の出力形状が、形状推論の結果 " + toString(*expected) + " と一致する");
    }

    void testForwardMatchesShapeRule()
    {
        checkForwardMatchesShapeRule({FeatureMapShape{3, 8, 8}, FeatureMapShape{4, 8, 8}}, "C=3 と C=4 の入力を連結");
        checkForwardMatchesShapeRule({FeatureMapShape{1, 8, 8}, FeatureMapShape{2, 8, 8}, FeatureMapShape{3, 8, 8}},
                                     "C=1、C=2、C=3 の入力を連結");
    }

    void testForwardValues()
    {
        const at::Tensor x0 = torch::full({kBatch, 2, 2, 2}, 1.0);
        const at::Tensor x1 = torch::full({kBatch, 3, 2, 2}, 2.0);
        const at::Tensor x2 = torch::full({kBatch, 1, 2, 2}, 3.0);

        const at::Tensor concatenated = TorchConcatLayer(ConcatSpec{}).forward({x0, x1, x2}).at(0);
        check(concatenated.size(1) == 6, "入力を連結: 2 + 3 + 1 = 6");

        // つないだ順にチャンネルが並ぶ: [0,2) は x0、[2,5) は x1、[5,6) は x2
        check(torch::all(concatenated.slice(1, 0, 2) == 1.0).item<bool>(), "チャンネル 0〜1 は x0 の値(1)");
        check(torch::all(concatenated.slice(1, 2, 5) == 2.0).item<bool>(), "チャンネル 2〜4 は x1 の値(2)");
        check(torch::all(concatenated.slice(1, 5, 6) == 3.0).item<bool>(), "チャンネル 5 は x2 の値(3)");

        // 乱数の入力でも、前半のチャンネルが r0、後半が r1 のまま並ぶ
        const at::Tensor r0 = randFeatureMap({2, 8, 8});
        const at::Tensor r1 = randFeatureMap({3, 8, 8});
        const at::Tensor r = TorchConcatLayer(ConcatSpec{}).forward({r0, r1}).at(0);
        check(torch::equal(r.slice(1, 0, 2), r0) && torch::equal(r.slice(1, 2, 5), r1),
              "乱数の入力でも、前半のチャンネルが r0、後半が r1 になっている");
    }

    // Concat は C が違ってもよい(結合する次元)。結合しない H / W が違うと、形状推論も forward も拒否する。
    void testSizeMismatchThrows()
    {
        const FeatureMapShape a{3, 8, 8};
        const FeatureMapShape b{4, 4, 4};

        check(!inferOutputShapes(ConcatSpec{}, {PortShape{a}, PortShape{b}}).ok(),
              "H/W が違う入力(8x8 と 4x4)を、形状推論は拒否する");

        bool threw = false;
        try
        {
            TorchConcatLayer(ConcatSpec{}).forward({randFeatureMap(a), randFeatureMap(b)});
        }
        catch (const std::exception &)
        {
            threw = true;
        }
        check(threw, "H/W が違う入力(8x8 と 4x4)では、forward も例外を投げる");
    }
}

int main()
{
    torch::manual_seed(0); // 失敗したときに、同じ入力で再現できるようにする

    testForwardMatchesShapeRule();
    testForwardValues();
    testSizeMismatchThrows();

    std::cout << (failureCount == 0 ? "ALL PASSED" : "FAILED: " + std::to_string(failureCount)) << std::endl;
    return failureCount == 0 ? 0 : 1;
}