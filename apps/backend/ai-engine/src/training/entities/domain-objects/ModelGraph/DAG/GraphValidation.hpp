#pragma once

#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"

#include <string>
#include <vector>
#include <cstddef>

struct GraphValidationError
{
    std::string nodeId;
    std::string port;
    std::string message;
};

class validatedModelGraph
{
public:
    static validatedModelGraph create(const ModelGraph &graph); // 検証済みモデルのオブジェクトを返すことを保証する。 staticにすることでオブジェクトを作らなくても使用できるためstaticを使う。

    const ModelGraph &getGraph() const { return _graph; };
    // 検証のときに求めた実行順(graph.nodes の添字)。
    const std::vector<std::size_t> &getOrder() const { return _order; }

private:
    validatedModelGraph(ModelGraph, std::vector<std::size_t> order);

    ModelGraph _graph;
    std::vector<std::size_t> _order;
};