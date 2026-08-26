#pragma once

#include <string>

class IPathProvidor
{
    public:
        virtual ~IPathProvidor() = default;
        virtual std::string getPath() const = 0;
};