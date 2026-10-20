#include "ModelGraphPresets.hpp"

using namespace std;

namespace
{
    namespace support
    {
        void appendConvReluBnPair(ModelGraphBuilder &builder, int inChannels, int outChannels, double bnMomentum, int dilation = 1)
        {
            Conv2DSpec conv1;
            conv1.inChannels = inChannels;
            conv1.outChannels = outChannels;
            conv1.kernelSize = 3;
            conv1.stride = 1;
            conv1.padding = dilation;
            conv1.dilation = dilation;
            builder.add(NodeSpec{conv1});

            ActivationSpec relu1;
            relu1.activationType = ActivationType::ReLU;
            builder.add(NodeSpec{relu1});

            BatchNormSpec bn1;
            bn1.numFeatures = outChannels;
            bn1.momentum = bnMomentum;
            builder.add(NodeSpec{bn1});

            Conv2DSpec conv2;
            conv2.inChannels = outChannels;
            conv2.outChannels = outChannels;
            conv2.kernelSize = 3;
            conv2.stride = 1;
            conv2.padding = dilation;
            conv2.dilation = dilation;
            builder.add(NodeSpec{conv2});

            ActivationSpec relu2;
            relu2.activationType = ActivationType::ReLU;
            builder.add(NodeSpec{relu2});

            BatchNormSpec bn2;
            bn2.numFeatures = outChannels;
            bn2.momentum = bnMomentum;
            builder.add(NodeSpec{bn2});
        }
    }
}

ValidatedModelGraph SegnetModelSample::buildGraph(const int numClasses) const
{
    ModelGraphBuilder builder;
    constexpr double bnMomentum = 0.5; // SegNet と同じ

    // Encoder
    const std::string pool1 = SegnetModelSample::appendEncoderBlock(builder, 3, 64, bnMomentum);
    const std::string pool2 = SegnetModelSample::appendEncoderBlock(builder, 64, 128, bnMomentum);
    const std::string pool3 = SegnetModelSample::appendEncoderBlock(builder, 128, 256, bnMomentum);
    const std::string pool4 = SegnetModelSample::appendEncoderBlock(builder, 256, 512, bnMomentum);
    const std::string pool5 = SegnetModelSample::appendEncoderBlock(builder, 512, 512, bnMomentum);

    // Decoder(対称)
    SegnetModelSample::appendDecoderBlock(builder, 512, 512, bnMomentum, pool5);
    SegnetModelSample::appendDecoderBlock(builder, 512, 256, bnMomentum, pool4);
    SegnetModelSample::appendDecoderBlock(builder, 256, 128, bnMomentum, pool3);
    SegnetModelSample::appendDecoderBlock(builder, 128, 64, bnMomentum, pool2);
    SegnetModelSample::appendDecoderBlock(builder, 64, numClasses, bnMomentum, pool1);

    return ValidatedModelGraph::create(builder.build());
}

string SegnetModelSample::appendEncoderBlock(ModelGraphBuilder &builder, int inChannels, int outChannels, double bnMomentum) const
{
    support::appendConvReluBnPair(builder, inChannels, outChannels, bnMomentum);

    IndexedPoolingSpec pool;
    pool.kernelSize = 2;
    pool.stride = 2;
    pool.padding = 0;

    return builder.add(NodeSpec{pool});
}

void SegnetModelSample::appendDecoderBlock(ModelGraphBuilder &builder, int inChannels, int outChannels, double bnMomentum, const std::string &poolNodeId) const
{
    UnpoolingSpec unpool;
    unpool.kernelSize = 2;
    unpool.stride = 2;
    unpool.padding = 0;

    builder.add(NodeSpec{unpool}, {NodeInput{"x", builder.lastOutput()},
                                   NodeInput{"indices", PortRef{poolNodeId, "indices"}}});

    support::appendConvReluBnPair(builder, inChannels, outChannels, bnMomentum);
}

ValidatedModelGraph UnetModelSample::buildGraph(const int numClasses) const
{
    ModelGraphBuilder builder;
    constexpr double bnMomentum = 0.5; // SegNet と同じ

    // Encoder
    const std::string skip1 = UnetModelSample::appendEncoderBlock(builder, 3, 32, bnMomentum);
    const std::string skip2 = UnetModelSample::appendEncoderBlock(builder, 32, 64, bnMomentum);
    const std::string skip3 = UnetModelSample::appendEncoderBlock(builder, 64, 128, bnMomentum);
    support::appendConvReluBnPair(builder, 128, 256, bnMomentum); // enc4: pooling なし

    UnetModelSample::appendDecoderBlock(builder, 256, 128, 128, bnMomentum, skip3);
    UnetModelSample::appendDecoderBlock(builder, 128, 64, 64, bnMomentum, skip2);
    UnetModelSample::appendDecoderBlock(builder, 64, 32, 32, bnMomentum, skip1);

    Conv2DSpec convFinal;
    convFinal.inChannels = 32;
    convFinal.outChannels = numClasses;
    convFinal.kernelSize = 1;

    builder.add(NodeSpec{convFinal});
    return ValidatedModelGraph::create(builder.build());
}

string UnetModelSample::appendEncoderBlock(ModelGraphBuilder &builder, int inChannels, int outChannels, double bnMomentum) const
{
    support::appendConvReluBnPair(builder, inChannels, outChannels, bnMomentum);

    const std::string skip = builder.lastOutput().nodeId;
    PoolingSpec pool;
    pool.type = PoolingType::Max;
    pool.kernelSize = 2;
    pool.stride = 2;
    pool.padding = 0;
    builder.add(NodeSpec{pool});

    return skip;
}

void UnetModelSample::appendDecoderBlock(ModelGraphBuilder &builder, int upChannels, int skipChannels, int outChannels, double bnMomentum, const std::string &poolNodeId) const
{
    UpsampleSpec upsample;
    upsample.scaleFactor = 2;
    upsample.upsampleMode = UpsampleMode::Bilinear;

    builder.add(NodeSpec{upsample});
    builder.add(NodeSpec{ConcatSpec{}}, {NodeInput{"x", builder.lastOutput()},
                                         NodeInput{"x", PortRef{poolNodeId, "y"}}});

    support::appendConvReluBnPair(builder, upChannels + skipChannels, outChannels, bnMomentum);
}