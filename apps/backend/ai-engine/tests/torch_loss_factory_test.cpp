#include <vector>
#include <string>
#include <iostream>

#include <torch/torch.h>

#include "training/entities/domain-objects/LossConfig.hpp"
#include "training/entities/domain-objects/LossType.hpp"

#include "training/adapters/interfaces/ILoss.hpp"
#include "training/adapters/interfaces/ILossFactory.hpp"

#include "training/infrastructure/torchFunc/TorchLossFactory.hpp"
#include "training/infrastructure/torchFunc/BoundaryLoss.hpp"
#include "training/infrastructure/torchFunc/CrossEntropy.hpp"
#include "training/infrastructure/torchFunc/ComboLoss.hpp"
#include "training/infrastructure/torchFunc/DiceLoss.hpp"
#include "training/infrastructure/torchFunc/FocalLoss.hpp"
#include "training/infrastructure/torchFunc/MseLoss.hpp"

namespace
{
    int failureCount = 0;

    void check(bool condition, const std::string &message)
    {
        std::cout << (condition ? " [PASS] " : " [FAIL] ") << message << std::endl;
        if (!condition)
        {
            ++failureCount;
        }
    }

    void checkLoss(const CrossEntropyConfig &c)
    {
        auto loss = TorchLossFactory().create(LossConfig{c}, /*numclasses=*/2, /*ignoreIndex =*/-100);
        check(dynamic_cast<CrossEntropy *>(loss.get()) != nullptr, "CrossEntropyConfigからCrossEntropyが生成される"); // もともと、TorchFactory::create()の戻り値はILoss。これでは「ILossインターフェースを満たすなにか」を返すだけ(ポリモーフィズム的には正しい)。よって、その中身を確認するためにこの処理を入れている。 処理の中身としては、仮想関数を持つクラス(インターフェースのような)は内部に仮想関数テーブル(vTable)を持ち、そこに実行時型情報(RTTI)が紐づいている。`dynamic_cast`はこのvtableを見て「このポインタが指しているオブジェクトは、実際には`Focal Loss`か?」を実行時に判定してくれる。もし`ILoss`が仮想関数を一つも持たない普通のクラスの場合、`dynamic_cast`はそもそもコンパイルエラーになる。次に、`dynamic_cast`でポインタ型にキャストした際に、vTableが持つ型情報とキャスト時の型が同じ場合、有効なポインタが返るが、異なる場合、nullptrが返るという特性を利用して、boolの判定を行う。
    }

    void checkLoss(const ComboLossConfig &c)
    {
        auto loss = TorchLossFactory().create(LossConfig{c}, 2, -100);
        check(dynamic_cast<ComboLoss *>(loss.get()) != nullptr, "ComboLossConfigからComboLossが生成される");
    }
    void checkLoss(const DiceLossConfig &c)
    {
        auto loss = TorchLossFactory().create(LossConfig{c}, 2, -100);
        check(dynamic_cast<DiceLoss *>(loss.get()) != nullptr, "DiceLossConfigからDiceLossが生成される");
    }
    void checkLoss(const FocalLossConfig &c)
    {
        auto loss = TorchLossFactory().create(LossConfig(c), 2, -100);
        check(dynamic_cast<FocalLoss *>(loss.get()) != nullptr, "FocalLossConfigからFocalLossが生成される");
    }

    void checkLoss(const MseLossConfig &c)
    {
        auto loss = TorchLossFactory().create(LossConfig(c), 2, -100);
        check(dynamic_cast<MseLoss *>(loss.get()) != nullptr, "MseLossConfigからMseLossが生成される");
    }
    void checkLoss(const BoundaryLossConfig &c)
    {
        auto loss = TorchLossFactory().create(LossConfig(c), 2, -100);
        check(dynamic_cast<BoundaryLoss *>(loss.get()) != nullptr, "BoundaryLossConfigからBoundaryLossが生成される");
    }
}

int main()
{
    checkLoss(CrossEntropyConfig{});
    checkLoss(ComboLossConfig{0.5});
    checkLoss(DiceLossConfig{});
    checkLoss(FocalLossConfig{0.5, 0.1});
    checkLoss(MseLossConfig{});
    checkLoss(BoundaryLossConfig{});

    if (failureCount == 0)
    {
        std::cout << "All torch loss factory tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << "test(s) failed." << std::endl;

    return 1;
}