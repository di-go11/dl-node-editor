#pragma once

#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"

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
    NodeSpec spec; // このノードが何をするか(層の種類とパラメータ、または Add などの汎用ノード)
    std::vector<NodeInput> inputs;
};