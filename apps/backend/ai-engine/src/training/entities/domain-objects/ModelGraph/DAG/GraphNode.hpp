#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/LayersConfig.hpp"

#include <vector>
#include <string>

// 出力ポート1つを指す。
struct PortRef
{
    std::string nodeId;
    std::string port;
};

// このノードの入力ポート port に、source が指す出力をつなぐ。
struct NodeInput
{
    std::string port;
    PortRef source;
};

struct GraphNode
{
    std::string id;
    LayersConfig layer;
    std::vector<NodeInput> inputs;
};