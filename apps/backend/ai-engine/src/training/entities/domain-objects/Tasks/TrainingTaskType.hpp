#pragma once
#include "training/entities/domain-objects/Tasks/ImageTaskType.hpp"

#include <variant>

// 学習タスク。モダリティごとの task enum を並べる(波形用などを足すときはここに追加する)。
using TrainingTaskType = std::variant<ImageTaskType>;