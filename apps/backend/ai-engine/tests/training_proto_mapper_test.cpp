// TrainingProtoMapper(proto <-> ドメインの変換と値の確認)の単体テスト。
// torch に依存しない(ai_engine_grpc / ai_engine_proto だけをリンクする)。

#include "api/grpc/TrainingProtoMapper.hpp"

#include <cmath>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <variant>

namespace
{
int failureCount = 0;

void check(bool condition, const std::string &message)
{
    std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
    if (!condition)
    {
        ++failureCount;
    }
}

// Rust 側が送る想定の、正しいリクエスト(画像セグメンテーション、Conv 1 層)。
training::v1::StartTrainingRequest makeValidRequest()
{
    training::v1::StartTrainingRequest r;
    r.set_model_name("seg_model-1");
    auto *conv = r.mutable_model_graph()->add_layers()->mutable_conv2d();
    conv->set_in_channels(3);
    conv->set_out_channels(3);
    conv->set_kernel_size(3);
    conv->set_stride(1);
    conv->set_padding(1);
    conv->set_dilation(1);

    auto *adam = r.mutable_optimizer()->mutable_adam();
    adam->set_learning_rate(0.005);
    adam->set_beta1(0.9);
    adam->set_beta2(0.999);
    adam->set_eps(1e-8);

    r.mutable_loss()->mutable_cross_entropy();
    r.set_epoch(3);
    r.set_batch(2);
    r.set_dataset_path("/data/train");
    r.set_device("cuda:1");
    r.set_save_last_every(2);

    auto *image = r.mutable_data_spec()->mutable_image();
    image->mutable_annotation()->mutable_pascal_voc()->set_include_difficult(true);
    image->set_input_width(128);
    image->set_input_height(96);
    image->mutable_task_specs()->mutable_segmentation()->set_ignore_index(255);
    return r;
}

// modify で壊したリクエストが invalid_argument で拒否されるか。
void checkRejected(const std::function<void(training::v1::StartTrainingRequest &)> &modify, const std::string &message)
{
    training::v1::StartTrainingRequest r = makeValidRequest();
    modify(r);
    bool rejected = false;
    try
    {
        toStartTrainingCommand(r);
    }
    catch (const std::invalid_argument &)
    {
        rejected = true;
    }
    check(rejected, "拒否: " + message);
}
} // namespace

int main()
{
    // ---------- 正しいリクエストの変換 ----------
    {
        const StartTrainingCommand c = toStartTrainingCommand(makeValidRequest());
        check(c.modelName == "seg_model-1", "変換: model_name");
        check(c.modelGraph.layers.size() == 1 &&
                  std::holds_alternative<Conv2DParams>(c.modelGraph.layers[0].params) &&
                  std::get<Conv2DParams>(c.modelGraph.layers[0].params).padding == 1,
              "変換: model_graph(Conv2D)");
        check(std::holds_alternative<AdamOptimizerConfig>(c.optimizer) &&
                  std::get<AdamOptimizerConfig>(c.optimizer).learningRate == 0.005,
              "変換: optimizer(Adam)");
        check(std::holds_alternative<CrossEntropyConfig>(c.loss), "変換: loss(CrossEntropy)");
        check(c.epochSize == 3 && c.batchSize == 2 && c.saveLastEvery == 2, "変換: epoch / batch / save_last_every");
        check(c.datasetPath == "/data/train" && c.resumeFrom.empty(), "変換: dataset_path / resume_from(空 = 再開しない)");
        check(c.device.type == ComputeDeviceType::Cuda && c.device.index == 1, "変換: device(cuda:1)");

        const ImageSpec *image = std::get_if<ImageSpec>(&c.dataSpec);
        check(image != nullptr && image->inputWidth == 128 && image->inputHeight == 96, "変換: data_spec.image の入力サイズ");
        check(image != nullptr && std::get<PascalVocConfig>(image->annotation).includeDifficult,
              "変換: data_spec.image.annotation(PascalVoc)");
        const SegmentationSpec *seg = image ? std::get_if<SegmentationSpec>(&image->taskSpecs) : nullptr;
        check(seg != nullptr && seg->ignoreIndex == 255, "変換: task_specs.segmentation.ignore_index");
    }
    {
        // ignore_index = 0 は正しい値として通す(拒否しない)
        training::v1::StartTrainingRequest r = makeValidRequest();
        r.mutable_data_spec()->mutable_image()->mutable_task_specs()->mutable_segmentation()->set_ignore_index(0);
        const StartTrainingCommand c = toStartTrainingCommand(r);
        check(std::get<SegmentationSpec>(std::get<ImageSpec>(c.dataSpec).taskSpecs).ignoreIndex == 0,
              "変換: ignore_index = 0 は拒否しない(Rust 側の契約で担保)");
    }

    // ---------- 拒否されるリクエスト ----------
    checkRejected([](auto &r) { r.set_model_name(""); }, "model_name が空");
    checkRejected([](auto &r) { r.set_model_name("../evil"); }, "model_name にパスの区切りが含まれる");
    checkRejected([](auto &r) { r.clear_model_graph(); }, "model_graph.layers が空");
    checkRejected([](auto &r) { r.mutable_model_graph()->add_layers(); }, "層の種類が未指定");
    checkRejected([](auto &r) { r.mutable_model_graph()->mutable_layers(0)->mutable_conv2d()->set_kernel_size(0); },
                  "conv2d.kernel_size = 0");
    checkRejected([](auto &r) { r.mutable_model_graph()->add_layers()->mutable_pooling2d()->set_kernel_size(2); },
                  "pooling_type が UNSPECIFIED");
    checkRejected([](auto &r) { r.clear_optimizer(); }, "optimizer が未指定");
    checkRejected([](auto &r) { r.mutable_optimizer()->mutable_adam()->set_learning_rate(0.0); }, "learning_rate = 0");
    checkRejected([](auto &r) { r.mutable_optimizer()->mutable_adam()->set_eps(0.0); }, "adam.eps = 0");
    checkRejected([](auto &r) { r.clear_loss(); }, "loss が未指定");
    checkRejected([](auto &r) { r.set_epoch(0); }, "epoch = 0");
    checkRejected([](auto &r) { r.set_batch(0); }, "batch = 0");
    checkRejected([](auto &r) { r.set_dataset_path(""); }, "dataset_path が空");
    checkRejected([](auto &r) { r.set_device("gpu"); }, "device が不正");
    checkRejected([](auto &r) { r.clear_data_spec(); }, "data_spec が未指定");
    checkRejected([](auto &r) { r.mutable_data_spec()->mutable_image()->set_input_width(0); }, "input_width = 0");
    checkRejected([](auto &r) { r.mutable_data_spec()->mutable_image()->clear_task_specs(); }, "task_specs が未指定");
    checkRejected([](auto &r) { r.mutable_data_spec()->mutable_image()->clear_annotation(); }, "annotation が未指定");
    checkRejected([](auto &r)
                  { r.mutable_data_spec()->mutable_image()->mutable_task_specs()->mutable_segmentation()->set_ignore_index(256); },
                  "ignore_index = 256(範囲外)");

    // ---------- TrainingStatus の変換 ----------
    check(toProtoTrainingStatus(TrainingStatus::Idle) == training::v1::TRAINING_STATUS_IDLE &&
              toProtoTrainingStatus(TrainingStatus::Running) == training::v1::TRAINING_STATUS_RUNNING &&
              toProtoTrainingStatus(TrainingStatus::Completed) == training::v1::TRAINING_STATUS_COMPLETED &&
              toProtoTrainingStatus(TrainingStatus::Failed) == training::v1::TRAINING_STATUS_FAILED &&
              toProtoTrainingStatus(TrainingStatus::Stopped) == training::v1::TRAINING_STATUS_STOPPED,
          "TrainingStatus: 5 つの状態が proto の値に対応する");

    // ---------- StreamProgressResponse ----------
    {
        // 1 エポックも終わっていない: epoch = 0、metrics は未設定
        TrainingProcessSnapshot s;
        s.status = TrainingStatus::Failed;
        s.errorMessage = "boom";
        training::v1::StreamProgressResponse res;
        fillStreamProgressResponse(s, res);
        check(res.epoch() == 0 && res.metrics_case() == training::v1::StreamProgressResponse::METRICS_NOT_SET,
              "進捗(エポックなし): epoch = 0、metrics は未設定");
        check(res.status() == training::v1::TRAINING_STATUS_FAILED && res.error_message() == "boom",
              "進捗(エポックなし): status と error_message");
    }
    {
        TrainingProcessSnapshot s;
        s.status = TrainingStatus::Running;
        s.hasEpochReport = true;
        s.latest.epoch = 4; // 0 から数えて 4 = 5 エポック終了
        s.latest.trainLoss = 0.4;
        s.latest.validation.loss = 0.3;
        s.latest.epochElapsedMs = 1200;
        s.latest.totalElapsedMs = 6000;
        SegmentationMetricsConfig seg{};
        seg.pixelAccuracy = 0.9;
        seg.meanIoU = 0.5;
        seg.fwIoU = 0.8;
        seg.meanClassAccuracy = 0.6;
        seg.perClassIoU = {0.9, std::nan(""), 0.1};
        s.latest.validation.taskMetrics = seg;

        training::v1::StreamProgressResponse res;
        fillStreamProgressResponse(s, res);
        check(res.epoch() == 5, "進捗: epoch は終了したエポック数(EpochReport::epoch + 1)");
        check(res.train_loss() == 0.4 && res.val_loss() == 0.3, "進捗: train_loss / val_loss");
        check(res.epoch_elapsed_ms() == 1200 && res.total_elapsed_ms() == 6000, "進捗: 経過時間");
        check(res.has_segmentation() && res.segmentation().miou() == 0.5 && res.segmentation().fw_iou() == 0.8,
              "進捗: segmentation の指標");
        check(res.has_segmentation() && res.segmentation().per_class_iou_size() == 3 &&
                  std::isnan(res.segmentation().per_class_iou(1)),
              "進捗: per_class_iou(NaN も含めてそのまま送る)");
    }

    if (failureCount == 0)
    {
        std::cout << "All training proto mapper tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
