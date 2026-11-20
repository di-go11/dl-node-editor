#pragma once

#include <variant>

enum class LearningRateSchedulerType
{
    None,
    Poly,
    Cosine,
    Step,
    Lambda,
    ReduceOnPlateau,
};
