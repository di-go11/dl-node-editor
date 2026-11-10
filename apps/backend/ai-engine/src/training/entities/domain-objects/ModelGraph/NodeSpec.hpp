#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/PoolingSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/BatchNormSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LinearSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/IndexedPoolingSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/UnpoolingSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/UpsampleSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/AddSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ConcatSpec.hpp"

#include <variant>

// ノードの仕様(そのノードが何をするか)。GraphNode::spec に入る。
//   Layers/ : すべてのノードの *Spec(Conv2D、Add、Concat など。パラメータを持たないものも含む)
// 検証・形状推論・モデルの組み立ては、variant にどの型が入っているかだけで分岐する。
//
// 種類を足すときは、必ず末尾に足す。並び順は NodeSpecFields.hpp の NodeKind と対応していて、
// NodeKind の数値は checkpoint に保存される。
using NodeSpec = std::variant<Conv2DSpec, PoolingSpec, BatchNormSpec, LinearSpec, ActivationSpec, IndexedPoolingSpec, UnpoolingSpec, UpsampleSpec, AddSpec, ConcatSpec>;
