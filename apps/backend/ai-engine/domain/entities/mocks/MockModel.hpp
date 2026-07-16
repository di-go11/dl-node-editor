#include <gmock/gmock.h>
#include "../interface/IModelType.hpp"

class MockModel : public IModelType {
public:
    MOCK_METHOD(std::string, getModelType, (), (const, override));

};