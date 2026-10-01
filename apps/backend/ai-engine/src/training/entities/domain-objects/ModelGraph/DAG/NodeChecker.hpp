#pragma once

#include "GraphNode.hpp"

#include <string>
#include <stdexcept>

inline bool isValidGraphNodeId(const std::string &id)
{
    if (id.empty())
    {
        throw std::runtime_error("GraphNode: id が空です");
    }
    for (const char c : id)
    {
        switch (c)
        {
        case '/':
        case '\\':
        case ':':
        case '*':
        case '?':
        case '"':
        case '<':
        case '>':
        case '|':
        case ' ':
        case '\t':
        case '\r':
        case '\n':
            return false;
        }
    }
    return true;
}
