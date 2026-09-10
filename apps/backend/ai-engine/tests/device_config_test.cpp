// ComputeDevice entity(parseComputeDevice / computeDeviceToString)の単体テスト。
//
//   - "cpu" / "cuda" / "cuda:N" のパース
//   - 不正な文字列で std::runtime_error になること
//   - computeDeviceToString との往復
//
// libtorch には一切依存しない(entity は純粋な値とパース関数のみ)。

#include <iostream>
#include <stdexcept>
#include <string>

#include "training/entities/domain-objects/ComputeDevice.hpp"

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

// deviceStr をパースして std::runtime_error が飛ぶことを確認する。
void checkThrows(const std::string &deviceStr)
{
    bool threw = false;
    try
    {
        parseComputeDevice(deviceStr);
    }
    catch (const std::runtime_error &)
    {
        threw = true;
    }
    check(threw, "\"" + deviceStr + "\" は std::runtime_error になる");
}
} // namespace

int main()
{
    // ---- 正常系: パース ----
    {
        const ComputeDevice cpu = parseComputeDevice("cpu");
        check(cpu.type == ComputeDeviceType::Cpu && cpu.index == 0, "\"cpu\" -> Cpu");

        const ComputeDevice cuda = parseComputeDevice("cuda");
        check(cuda.type == ComputeDeviceType::Cuda && cuda.index == 0, "\"cuda\" -> Cuda index 0");

        const ComputeDevice cuda0 = parseComputeDevice("cuda:0");
        check(cuda0.type == ComputeDeviceType::Cuda && cuda0.index == 0, "\"cuda:0\" -> Cuda index 0");

        const ComputeDevice cuda3 = parseComputeDevice("cuda:3");
        check(cuda3.type == ComputeDeviceType::Cuda && cuda3.index == 3, "\"cuda:3\" -> Cuda index 3");

        const ComputeDevice cuda12 = parseComputeDevice("cuda:12");
        check(cuda12.type == ComputeDeviceType::Cuda && cuda12.index == 12, "\"cuda:12\" -> Cuda index 12(複数桁)");
    }

    // ---- 異常系 ----
    checkThrows("");
    checkThrows("gpu");
    checkThrows("gpu:0");
    checkThrows("cuda:");     // インデックスが空
    checkThrows("cuda:-1");   // 負のインデックス
    checkThrows("cuda:1.5");  // 整数でない
    checkThrows("cuda:1x");   // 末尾にゴミ
    checkThrows("cuda:0:1");  // コロンが余分
    checkThrows("CPU");       // 大文字は受け付けない
    checkThrows(" cpu");      // 前後の空白は許容しない

    // ---- computeDeviceToString ----
    {
        check(computeDeviceToString(ComputeDevice{ComputeDeviceType::Cpu, 0}) == "cpu",
              "computeDeviceToString(Cpu) -> \"cpu\"");
        check(computeDeviceToString(ComputeDevice{ComputeDeviceType::Cuda, 0}) == "cuda:0",
              "computeDeviceToString(Cuda,0) -> \"cuda:0\"");
        check(computeDeviceToString(ComputeDevice{ComputeDeviceType::Cuda, 2}) == "cuda:2",
              "computeDeviceToString(Cuda,2) -> \"cuda:2\"");
    }

    // ---- 往復: parse(toString(x)) == x ----
    {
        const ComputeDevice cases[] = {
            {ComputeDeviceType::Cpu, 0},
            {ComputeDeviceType::Cuda, 0},
            {ComputeDeviceType::Cuda, 1},
            {ComputeDeviceType::Cuda, 7},
        };
        for (const ComputeDevice &d : cases)
        {
            const ComputeDevice round = parseComputeDevice(computeDeviceToString(d));
            check(round.type == d.type && round.index == d.index,
                  "往復一致: " + computeDeviceToString(d));
        }
    }

    if (failureCount == 0)
    {
        std::cout << "All device config tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
