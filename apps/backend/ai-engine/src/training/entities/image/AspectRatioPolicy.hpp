#pragma once

#include "training/entities/image/LetterboxPolicy.hpp"
#include "training/entities/image/CenterCropPolicy.hpp"
#include "training/entities/image/WarpPolicy.hpp"

#include <variant>

using AspectRatioPolicy = std::variant<WarpPolicy, LetterboxPolicy, CenterCropPolicy>;