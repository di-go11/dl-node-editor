#include <gmock/gmock.h>

#include "../interface/IActivationFunctionType.hpp"

class MockActiveFn : public IActivationFunctionType {
public:
    MOCK_METHOD(std::string, getType, (), (const, override));
}; 