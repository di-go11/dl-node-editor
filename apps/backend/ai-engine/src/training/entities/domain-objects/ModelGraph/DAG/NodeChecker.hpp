#pragma once

#include "GraphNode.hpp"

#include <string>
#include <stdexcept>
#include <cctype>

inline bool isValidGraphNodeId(const std::string &id)
{
    if (id.empty())
    {
        return false;
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
    if (id.size() > 64)
    {
        return false; // 大きすぎるIDは負荷
    }
    return true;
}
