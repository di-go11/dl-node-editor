// TorchAddLayer(infrastructure)と、Add の形状の規則(entities)が食い違っていないことのテスト。
//
// 形状推論は (C, H, W)、libtorch のテンソルは (N, C, H, W) で表すので、N を除いて比べる。
//   - forward の出力形状が、形状推論の結果と一致すること
//   - forward の値が x0 + alpha * x1 + ... になること
//   - 形の合わない入力では、forward が例外を投げること
//   - ブロードキャストが効く入力(C=1 と C=3)では、libtorch は計算してしまうが、形状推論は拒否すること
//     (形状のチェックはドメインの責務で、forward は検証済みの入力を前提にしている、という取り決めの記録)

#include "training/entities/domain-objects/ModelGraph/Layers/AddSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/NodeShapeRules.hpp"
#include "training/entities/domain-objects/ModelGraph/PortShape.hpp"
#include "training/infrastructure/torchFunc/TorchAddLayer.hpp"

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

    // 形状推論の結果 (C, H, W) と、forward の結果 (N, C, H, W) が一致すること。
    bool sameShape(const FeatureMapShape &expected, const at::Tensor &actual)
    {
        return actual.dim() == 4 && actual.size(0) == kBatch && actual.size(1) == expected.channels &&
               actual.size(2) == expected.height && actual.size(3) == expected.width;
    }

    at::Tensor randFeatureMap(const FeatureMapShape &shape)
    {
        return torch::rand({kBatch, shape.channels, shape.height, shape.width});
    }

    // 形状推論の出力が、特徴マップ 1 つであること。そうでなければ nullptr。
    const FeatureMapShape *singleFeatureMap(const ShapeResult &result)
    {
        if (!result.ok() || result.outputs.size() != 1)
        {
            return nullptr;
        }
        return std::get_if<FeatureMapShape>(&result.outputs[0]);
    }

    // 入力の形の組み合わせごとに、形状推論と forward の出力形状が一致すること。
    void checkForwardMatchesShapeRule(const std::vector<FeatureMapShape> &inShapes, const std::string &name)
    {
        std::vector<PortShape> portShapes;
        std::vector<at::Tensor> tensors;
        for (const auto &shape : inShapes)
        {
            portShapes.push_back(PortShape{shape});
            tensors.push_back(randFeatureMap(shape));
        }

        const ShapeResult inferred = inferOutputShapes(AddSpec{}, portShapes);
        const FeatureMapShape *expected = singleFeatureMap(inferred);
        check(expected != nullptr, name + ": 形状推論が通る");
        if (expected == nullptr)
        {
            std::cout << "    error: " << inferred.error << std::endl;
            return;
        }

        const std::vector<at::Tensor> outputs = TorchAddLayer(AddSpec{}).forward(tensors);
        check(outputs.size() == 1 && sameShape(*expected, outputs[0]),
              name + ": forward の出力形状が、形状推論の結果 " + toString(*expected) + " と一致する");
    }

    void testForwardMatchesShapeRule()
    {
        checkForwardMatchesShapeRule({{4, 8, 8}, {4, 8, 8}}, "2 入力");
        checkForwardMatchesShapeRule({{4, 8, 8}, {4, 8, 8}, {4, 8, 8}}, "3 入力");
        checkForwardMatchesShapeRule({{3, 5, 7}, {3, 5, 7}}, "H と W が違う(正方形でない)入力");
    }

    void testForwardValues()
    {
        // 値は手で計算できるものにする: x0 = 1, x1 = 2, x2 = 3
        const at::Tensor x0 = torch::full({kBatch, 4, 8, 8}, 1.0);
        const at::Tensor x1 = torch::full({kBatch, 4, 8, 8}, 2.0);
        const at::Tensor x2 = torch::full({kBatch, 4, 8, 8}, 3.0);

        const at::Tensor sum = TorchAddLayer(AddSpec{}).forward({x0, x1}).at(0);
        check(torch::allclose(sum, torch::full_like(sum, 3.0)), "alpha = 1(既定): 1 + 2 = 3");

        AddSpec half;
        half.alpha = 0.5;
        const at::Tensor scaled = TorchAddLayer(half).forward({x0, x1, x2}).at(0);
        // x0 には alpha を掛けない: 1 + 0.5 * 2 + 0.5 * 3 = 3.5
        check(torch::allclose(scaled, torch::full_like(scaled, 3.5)),
              "alpha = 0.5 の 3 入力: 1 + 0.5 * 2 + 0.5 * 3 = 3.5(x0 には掛けない)");

        // 乱数の入力でも、x0 + x1 と同じ値になる
        const at::Tensor r0 = randFeatureMap({4, 8, 8});
        const at::Tensor r1 = randFeatureMap({4, 8, 8});
        const at::Tensor r = TorchAddLayer(AddSpec{}).forward({r0, r1}).at(0);
        check(torch::allclose(r, r0 + r1), "乱数の入力でも、forward の値は x0 + x1");
    }

    void testChannelMismatchThrows()
    {
        const FeatureMapShape a{3, 8, 8};
        const FeatureMapShape b{4, 8, 8};

        check(!inferOutputShapes(AddSpec{}, {PortShape{a}, PortShape{b}}).ok(),
              "チャンネル数が違う入力(C=3 と C=4)を、形状推論は拒否する");

        bool threw = false;
        try
        {
            TorchAddLayer(AddSpec{}).forward({randFeatureMap(a), randFeatureMap(b)});
        }
        catch (const std::exception &)
        {
            threw = true;
        }
        check(threw, "チャンネル数が違う入力(C=3 と C=4)では、forward が例外を投げる");
    }

    void testBroadcastIsLooserThanShapeRule()
    {
        // 長さ 1 の次元は libtorch のブロードキャストで引き伸ばされるので、forward は例外にならない。
        // 形状推論は「入力はすべて同じ形」なので拒否する。実行前に形状推論を通すことで、この差を埋めている。
        const FeatureMapShape a{1, 8, 8};
        const FeatureMapShape b{3, 8, 8};

        check(!inferOutputShapes(AddSpec{}, {PortShape{a}, PortShape{b}}).ok(),
              "C=1 と C=3 の入力を、形状推論は拒否する");

        bool threw = false;
        at::Tensor y;
        try
        {
            y = TorchAddLayer(AddSpec{}).forward({randFeatureMap(a), randFeatureMap(b)}).at(0);
        }
        catch (const std::exception &)
        {
            threw = true;
        }
        check(!threw && y.size(1) == 3,
              "C=1 と C=3 の入力でも、forward はブロードキャストして (N, 3, H, W) を返す(形状推論のほうが厳しい)");
    }
}

int main()
{
    torch::manual_seed(0); // 失敗したときに、同じ入力で再現できるようにする

    testForwardMatchesShapeRule();
    testForwardValues();
    testChannelMismatchThrows();
    testBroadcastIsLooserThanShapeRule();

    std::cout << (failureCount == 0 ? "ALL PASSED" : "FAILED: " + std::to_string(failureCount)) << std::endl;
    return failureCount == 0 ? 0 : 1;
}
