#pragma once

#include "GraphNode.hpp"

#include <string>
#include <stdexcept>
#include <cctype>

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
        case '_':
            break;
        case '-':
            break;
        default:
            if (std::isalnum(c) == 0)
            {
                return false;
            }
        }
    }
    return true;
}
