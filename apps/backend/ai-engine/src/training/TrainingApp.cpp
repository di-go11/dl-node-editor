#include "training/TrainingApp.hpp"

#include "training/TrainingJob.hpp"

// entities
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/Conv2DParams.hpp"
#include "training/entities/domain-objects/ActivationParams.hpp"
#include "training/entities/domain-objects/BatchNormParams.hpp"
#include "training/entities/domain-objects/IndexedPoolingParams.hpp"
#include "training/entities/domain-objects/UnpoolingParams.hpp"
#include "training/entities/domain-objects/ModelArchitectureType.hpp"
#include "training/entities/image/ColorLabelMap.hpp"

// infrastructure(具象クラス)
#include "training/infrastructure/readConfig/ConfigReader.hpp"
#include "training/infrastructure/dataset/LabelMapFileReader.hpp"
#include "training/infrastructure/torchFunc/SeedApplier.hpp"

// adapters(具象クラス)
#include "training/adapters/impl/ConsoleProgressObserver.hpp"

#include <exception>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>

namespace
{
    // numClasses = セグメンテーションのクラス数(labelmap.txt のエントリ数)。
    // 最終層は「クラス数チャンネルの生ロジット」を出力する。CrossEntropy が
    // 内部で log_softmax するため、末尾に活性化層は置かない。
    ModelGraph buildSampleModelGraph(int numClasses)
    {
        ModelGraph graph;

        Conv2DParams conv;
        conv.inChannels = 3; // 実データ(RGB画像)に合わせて3チャンネル
        conv.outChannels = numClasses;
        conv.kernelSize = 3;
        conv.stride = 1;
        conv.padding = 1;
        graph.layers.push_back(LayersConfig{conv});

        return graph;
    }

    // Conv(3x3) -> ReLU -> BatchNorm を2回繰り返す共通ブロック。
    // SegNet の encoder/decoder ブロックは中身が同一構造(python版 segnetProgram.py
    // の encoder_block / decoder_block に相当)。
    // dilation を広げても出力サイズが変わらないよう、padding = dilation にする(3x3 の場合)。
    void appendConvReluBnPair(ModelGraph &graph, int inChannels, int outChannels, double bnMomentum, int dilation = 1)
    {
        Conv2DParams conv1;
        conv1.inChannels = inChannels;
        conv1.outChannels = outChannels;
        conv1.kernelSize = 3;
        conv1.stride = 1;
        conv1.padding = dilation;
        conv1.dilation = dilation;
        graph.layers.push_back(LayersConfig{conv1});

        ActivationConfig relu1;
        relu1.activationType = ActivationType::ReLU;
        graph.layers.push_back(LayersConfig{relu1});

        BatchNormParams bn1;
        bn1.numFeatures = outChannels;
        bn1.momentum = bnMomentum;
        graph.layers.push_back(LayersConfig{bn1});

        Conv2DParams conv2;
        conv2.inChannels = outChannels;
        conv2.outChannels = outChannels;
        conv2.kernelSize = 3;
        conv2.stride = 1;
        conv2.padding = dilation;
        conv2.dilation = dilation;
        graph.layers.push_back(LayersConfig{conv2});

        ActivationConfig relu2;
        relu2.activationType = ActivationType::ReLU;
        graph.layers.push_back(LayersConfig{relu2});

        BatchNormParams bn2;
        bn2.numFeatures = outChannels;
        bn2.momentum = bnMomentum;
        graph.layers.push_back(LayersConfig{bn2});
    }

    // encoder_block: Conv×2 の後に indices を記録する pooling。
    void appendEncoderBlock(ModelGraph &graph, int inChannels, int outChannels, double bnMomentum)
    {
        appendConvReluBnPair(graph, inChannels, outChannels, bnMomentum);

        IndexedPoolingParams pool;
        pool.kernelSize = 2;
        pool.stride = 2;
        pool.padding = 0;
        graph.layers.push_back(LayersConfig{pool});
    }

    // decoder_block: 対応する pooling の indices を使う unpooling の後に Conv×2。
    // (python 版 forward() の d5 = dec5[1](e5, indic5); d5 = dec5[0](d5) の順に対応)
    void appendDecoderBlock(ModelGraph &graph, int inChannels, int outChannels, double bnMomentum)
    {
        UnpoolingParams unpool;
        unpool.kernelSize = 2;
        unpool.stride = 2;
        unpool.padding = 0;
        graph.layers.push_back(LayersConfig{unpool});

        appendConvReluBnPair(graph, inChannels, outChannels, bnMomentum);
    }

    // segnetProgram.py の SegNet を再現したグラフ。pooling で得た indices は
    // TorchModel 内の LIFO スタックで対応する unpooling まで運ばれる
    // (enc5→dec5, enc4→dec4, ... という対称構造が前提)。
    ModelGraph buildSegNetGraph(int numClasses)
    {
        ModelGraph graph;
        constexpr double bnMomentum = 0.5; // python 版の BN_momentum デフォルトに合わせる

        // Encoder
        appendEncoderBlock(graph, 3, 64, bnMomentum);
        appendEncoderBlock(graph, 64, 128, bnMomentum);
        appendEncoderBlock(graph, 128, 256, bnMomentum);
        appendEncoderBlock(graph, 256, 512, bnMomentum);
        appendEncoderBlock(graph, 512, 512, bnMomentum);

        // Decoder(対称)
        appendDecoderBlock(graph, 512, 512, bnMomentum);
        appendDecoderBlock(graph, 512, 256, bnMomentum);
        appendDecoderBlock(graph, 256, 128, bnMomentum);
        appendDecoderBlock(graph, 128, 64, bnMomentum);
        appendDecoderBlock(graph, 64, numClasses, bnMomentum);

        return graph;
    }

    // SegNet の encoder 4・5 段目の pooling をやめ、代わりに Conv を dilation = 2, 4 にした構成。
    // 対応する decoder 5・4 段目の unpooling も外す(pooling / unpooling は enc1-3 と dec3-1 の 3 組だけになる)。
    // 特徴マップの解像度を 1/8 までに保ったまま、深い段の受容野を広げる(DeepLab 系の考え方)。
    // pooling が 3 段なので、入力サイズは 8 の倍数である必要がある。
    ModelGraph buildSegNetDilatedGraph(int numClasses)
    {
        ModelGraph graph;
        constexpr double bnMomentum = 0.5; // SegNet と同じ

        // Encoder
        appendEncoderBlock(graph, 3, 64, bnMomentum);
        appendEncoderBlock(graph, 64, 128, bnMomentum);
        appendEncoderBlock(graph, 128, 256, bnMomentum);
        appendConvReluBnPair(graph, 256, 512, bnMomentum, /*dilation=*/2); // enc4: pooling なし
        appendConvReluBnPair(graph, 512, 512, bnMomentum, /*dilation=*/4); // enc5: pooling なし

        // Decoder(対称)
        appendConvReluBnPair(graph, 512, 512, bnMomentum, /*dilation=*/4); // dec5: unpooling なし
        appendConvReluBnPair(graph, 512, 256, bnMomentum, /*dilation=*/2); // dec4: unpooling なし
        appendDecoderBlock(graph, 256, 128, bnMomentum);
        appendDecoderBlock(graph, 128, 64, bnMomentum);
        appendDecoderBlock(graph, 64, numClasses, bnMomentum);

        return graph;
    }

    // SegNet の pooling / unpooling をすべてやめ、dilated conv だけで受容野を広げた構成。
    // 特徴マップは最後まで入力と同じ解像度のまま(小さい対象の情報を失わないため)。
    // pooling 1 段ごとに解像度が半分になっていた代わりに、段ごとに dilation を 2 倍にする
    // (encoder: 1, 2, 4, 8, 16 / decoder: 16, 8, 4, 2, 1)。チャンネル構成は SegNet と同じ。
    // 解像度が下がらないので、計算量・メモリは SegNet よりずっと大きい
    // (256x256 で 1 枚あたり順伝播約 2.2 TFLOPs、学習時の活性化は約 3.7 GB。docs/重みと計算量の見積もり.md)。
    ModelGraph buildSegNetFullDilatedGraph(int numClasses)
    {
        ModelGraph graph;
        constexpr double bnMomentum = 0.5; // SegNet と同じ

        // Encoder
        appendConvReluBnPair(graph, 3, 64, bnMomentum, /*dilation=*/1);
        appendConvReluBnPair(graph, 64, 128, bnMomentum, /*dilation=*/2);
        appendConvReluBnPair(graph, 128, 256, bnMomentum, /*dilation=*/4);
        appendConvReluBnPair(graph, 256, 512, bnMomentum, /*dilation=*/8);
        appendConvReluBnPair(graph, 512, 512, bnMomentum, /*dilation=*/16);

        // Decoder(対称)
        appendConvReluBnPair(graph, 512, 512, bnMomentum, /*dilation=*/16);
        appendConvReluBnPair(graph, 512, 256, bnMomentum, /*dilation=*/8);
        appendConvReluBnPair(graph, 256, 128, bnMomentum, /*dilation=*/4);
        appendConvReluBnPair(graph, 128, 64, bnMomentum, /*dilation=*/2);
        appendConvReluBnPair(graph, 64, numClasses, bnMomentum, /*dilation=*/1);

        return graph;
    }

    // .config の model_architecture に応じてグラフ組み立て関数を選ぶ。
    ModelGraph buildGraph(ModelArchitectureType architecture, int numClasses)
    {
        switch (architecture)
        {
        case ModelArchitectureType::Sample:
            return buildSampleModelGraph(numClasses);
        case ModelArchitectureType::SegNet:
            return buildSegNetGraph(numClasses);
        case ModelArchitectureType::SegNetDilated:
            return buildSegNetDilatedGraph(numClasses);
        case ModelArchitectureType::SegNetFullDilated:
            return buildSegNetFullDilatedGraph(numClasses);
        }
        throw std::runtime_error("runTraining: unknown ModelArchitectureType");
    }

} // namespace

void runTraining()
{
    // configの読み込み
    ConfigReader configReader;
    TrainingConfigFile config = configReader.readAll(".config");

    // CLI ではモデル構造を .config の model_architecture とクラス数から組み立てる。
    // クラス数は labelmap.txt のエントリ数(モデル出力チャンネル数の単一の参照元)。
    const std::string labelMapPath =
        (std::filesystem::path(config.command.datasetPath) / "labelmap.txt").string();
    const int numClasses = static_cast<int>(LabelMapFileReader{}.read(labelMapPath).entryCount());
    config.command.modelGraph = buildGraph(config.architecture, numClasses);
    const auto seedApplier = std::make_unique<SeedApplier>();

    // CLI では進捗を標準出力に書く。停止要求は受け付けない(Ctrl+C で止める)。
    auto progressObserver = std::make_shared<ConsoleProgressObserver>();
    try
    {
        const TrainingStatus status = runTrainingJob(config.server, config.command, progressObserver, *seedApplier);
        progressObserver->onFinished(status, "");
    }
    catch (const std::exception &e)
    {
        progressObserver->onFinished(TrainingStatus::Failed, e.what());
        throw;
    }
}
