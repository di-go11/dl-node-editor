#pragma once

#include "training/entities/domain-objects/OptimizerType.hpp"

#include <stdexcept>
#include <string>

// OptimizerType の名前。
//
// この文字列は checkpoint(.pt)に書き込まれ、復元時の照合に使われる。
// 既存の値を変更すると過去の .pt が読めなくなるため変更しないこと。
// 綴りは .config の optimizer_type と揃えてある。
inline std::string optimizerTypeName(OptimizerType type)
{
    switch (type)
    {
    case OptimizerType::Adam:
        return "Adam";
    case OptimizerType::AdamW:
        return "AdamW";
    case OptimizerType::SGD:
        return "SGD";
    }

    throw std::runtime_error("optimizerTypeName: 未知の OptimizerType (" +
                             std::to_string(static_cast<int>(type)) + ")");
}
