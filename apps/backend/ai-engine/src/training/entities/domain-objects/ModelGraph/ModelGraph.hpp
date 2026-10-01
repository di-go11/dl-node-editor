#pragma once

#include "training/entities/domain-objects/ModelGraph/DAG/GraphNode.hpp"
#include <vector>

struct ModelGraph
{
    std::vector<GraphNode> nodes;
    std::vector<PortRef> outputs;
};