#include "api/grpc/TrainingProtoMapper.hpp"

#include "training/entities/utils/Overloaded.hpp"

#include <cctype>
#include <stdexcept>
#include <string>
#include <variant>

namespace
{
    [[noreturn]] void invalid(const std::string &message)
    {
        throw std::invalid_argument("StartTrainingRequest: " + message);
    }

    void requirePositive(int64_t value, const std::string &name)
    {
        if (value < 1)
        {
            invalid(name + " は 1 以上にしてください(" + std::to_string(value) + ")");
        }
    }

    void requireNonNegative(int64_t value, const std::string &name)
    {
        if (value < 0)
        {
            invalid(name + " は 0 以上にしてください(" + std::to_string(value) + ")");
        }
    }

    void requireGreaterThanZero(double value, const std::string &name)
    {
        if (!(value > 0.0))
        {
            invalid(name + " は 0 より大きくしてください(" + std::to_string(value) + ")");
        }
    }

    // model_name は checkpoint のファイル名(<model_name>_last.pt)に使われるため、
    // 保存先の外に書き込めないよう、英数字・'-'・'_' だけを許す。
    void validateModelName(const std::string &modelName)
    {
        if (modelName.empty())
        {
            invalid("model_name が空です");
        }
        for (const char c : modelName)
        {
            if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_'))
            {
                invalid("model_name に使えない文字が含まれています(英数字・'-'・'_' のみ): " + modelName);
            }
        }
    }

    // ---- model_graph ----

    LayersConfig toLayer(const training::v1::LayerConfig &layer, size_t index)
    {
        const std::string at = "model_graph.layers[" + std::to_string(index) + "]";
        switch (layer.params_case())
        {
        case training::v1::LayerConfig::kConv2D:
        {
            const auto &p = layer.conv2d();
            Conv2DParams conv;
            conv.inChannels = p.in_channels();
            conv.outChannels = p.out_channels();
            conv.kernelSize = p.kernel_size();
            conv.stride = p.stride();
            conv.padding = p.padding();
            conv.dilation = p.dilation();
            requirePositive(conv.inChannels, at + ".conv2d.in_channels");
            requirePositive(conv.outChannels, at + ".conv2d.out_channels");
            requirePositive(conv.kernelSize, at + ".conv2d.kernel_size");
            requirePositive(conv.stride, at + ".conv2d.stride");
            requireNonNegative(conv.padding, at + ".conv2d.padding");
            requirePositive(conv.dilation, at + ".conv2d.dilation");
            return LayersConfig{conv};
        }
        case training::v1::LayerConfig::kPooling2D:
        {
            const auto &p = layer.pooling2d();
            PoolingParams pool;
            switch (p.pooling_type())
            {
            case training::v1::POOLING_TYPE_MAX:
                pool.type = PoolingType::Max;
                break;
            case training::v1::POOLING_TYPE_AVERAGE:
                pool.type = PoolingType::Average;
                break;
            default:
                invalid(at + ".pooling2d.pooling_type が指定されていません");
            }
            pool.kernelSize = p.kernel_size();
            pool.stride = p.stride();
            pool.padding = p.padding();
            requirePositive(pool.kernelSize, at + ".pooling2d.kernel_size");
            requirePositive(pool.stride, at + ".pooling2d.stride");
            requireNonNegative(pool.padding, at + ".pooling2d.padding");
            return LayersConfig{pool};
        }
        case training::v1::LayerConfig::kBatchNorm:
        {
            const auto &p = layer.batch_norm();
            BatchNormParams bn;
            bn.numFeatures = p.num_features();
            bn.eps = p.eps();
            bn.momentum = p.momentum();
            requirePositive(bn.numFeatures, at + ".batch_norm.num_features");
            requireGreaterThanZero(bn.eps, at + ".batch_norm.eps");
            return LayersConfig{bn};
        }
        case training::v1::LayerConfig::kLinear:
        {
            const auto &p = layer.linear();
            LinearParams linear;
            linear.inFeatures = p.in_features();
            linear.outFeatures = p.out_features();
            linear.bias = p.bias();
            requirePositive(linear.inFeatures, at + ".linear.in_features");
            requirePositive(linear.outFeatures, at + ".linear.out_features");
            return LayersConfig{linear};
        }
        case training::v1::LayerConfig::kActivation:
        {
            const auto &p = layer.activation();
            ActivationParams activation;
            switch (p.activation_type())
            {
            case training::v1::ACTIVATION_TYPE_RELU:
                activation.activationType = ActivationType::ReLU;
                break;
            case training::v1::ACTIVATION_TYPE_SIGMOID:
                activation.activationType = ActivationType::Sigmoid;
                break;
            case training::v1::ACTIVATION_TYPE_SOFTMAX:
                activation.activationType = ActivationType::Softmax;
                break;
            case training::v1::ACTIVATION_TYPE_TANH:
                activation.activationType = ActivationType::Tanh;
                break;
            default:
                invalid(at + ".activation.activation_type が指定されていません");
            }
            activation.dim = p.dim();
            return LayersConfig{activation};
        }
        case training::v1::LayerConfig::kIndexedPooling:
        {
            const auto &p = layer.indexed_pooling();
            IndexedPoolingParams pool;
            pool.kernelSize = p.kernel_size();
            pool.stride = p.stride();
            pool.padding = p.padding();
            requirePositive(pool.kernelSize, at + ".indexed_pooling.kernel_size");
            requirePositive(pool.stride, at + ".indexed_pooling.stride");
            requireNonNegative(pool.padding, at + ".indexed_pooling.padding");
            return LayersConfig{pool};
        }
        case training::v1::LayerConfig::kUnpooling:
        {
            const auto &p = layer.unpooling();
            UnpoolingParams unpool;
            unpool.kernelSize = p.kernel_size();
            unpool.stride = p.stride();
            unpool.padding = p.padding();
            requirePositive(unpool.kernelSize, at + ".unpooling.kernel_size");
            requirePositive(unpool.stride, at + ".unpooling.stride");
            requireNonNegative(unpool.padding, at + ".unpooling.padding");
            return LayersConfig{unpool};
        }
        case training::v1::LayerConfig::PARAMS_NOT_SET:
            break;
        }
        invalid(at + " の層の種類が指定されていません");
    }

    ModelGraph toModelGraph(const training::v1::ModelGraph &graph)
    {
        if (graph.layers_size() == 0)
        {
            invalid("model_graph.layers が空です");
        }
        ModelGraph result;
        result.layers.reserve(graph.layers_size());
        for (int i = 0; i < graph.layers_size(); ++i)
        {
            result.layers.push_back(toLayer(graph.layers(i), static_cast<size_t>(i)));
        }
        return result;
    }

    // ---- optimizer / loss ----

    OptimizerConfig toOptimizer(const training::v1::OptimizerConfig &optimizer)
    {
        switch (optimizer.config_case())
        {
        case training::v1::OptimizerConfig::kAdam:
        {
            const auto &p = optimizer.adam();
            AdamOptimizerConfig c;
            c.learningRate = p.learning_rate();
            c.weightDecay = p.weight_decay();
            c.beta1 = p.beta1();
            c.beta2 = p.beta2();
            c.eps = p.eps();
            requireGreaterThanZero(c.learningRate, "optimizer.adam.learning_rate");
            requireGreaterThanZero(c.eps, "optimizer.adam.eps");
            return c;
        }
        case training::v1::OptimizerConfig::kAdamW:
        {
            const auto &p = optimizer.adam_w();
            AdamWOptimizerConfig c;
            c.learningRate = p.learning_rate();
            c.weightDecay = p.weight_decay();
            c.beta1 = p.beta1();
            c.beta2 = p.beta2();
            requireGreaterThanZero(c.learningRate, "optimizer.adam_w.learning_rate");
            return c;
        }
        case training::v1::OptimizerConfig::kSgd:
        {
            const auto &p = optimizer.sgd();
            SGDOptimizerConfig c;
            c.learningRate = p.learning_rate();
            c.weightDecay = p.weight_decay();
            c.momentum = p.momentum();
            c.nesterov = p.nesterov();
            requireGreaterThanZero(c.learningRate, "optimizer.sgd.learning_rate");
            return c;
        }
        case training::v1::OptimizerConfig::CONFIG_NOT_SET:
            break;
        }
        invalid("optimizer の種類が指定されていません");
    }

    LossConfig toLoss(const training::v1::LossConfig &loss)
    {
        switch (loss.config_case())
        {
        case training::v1::LossConfig::kCrossEntropy:
            return CrossEntropyConfig{};
        case training::v1::LossConfig::kMse:
            return MseLossConfig{};
        case training::v1::LossConfig::kDice:
            return DiceLossConfig{};
        case training::v1::LossConfig::kFocal:
        {
            FocalLossConfig c;
            c.gamma = loss.focal().gamma();
            c.alpha = loss.focal().alpha();
            return c;
        }
        case training::v1::LossConfig::kCombo:
        {
            ComboLossConfig c;
            c.alpha = loss.combo().alpha();
            return c;
        }
        case training::v1::LossConfig::kBoundary:
            return BoundaryLossConfig{};
        case training::v1::LossConfig::CONFIG_NOT_SET:
            break;
        }
        invalid("loss の種類が指定されていません");
    }

    // ---- data_spec ----

    ImageAnnotationConfig toAnnotation(const training::v1::ImageAnnotationConfig &annotation)
    {
        switch (annotation.config_case())
        {
        case training::v1::ImageAnnotationConfig::kPascalVoc:
        {
            PascalVocConfig c;
            c.includeDifficult = annotation.pascal_voc().include_difficult();
            return c;
        }
        case training::v1::ImageAnnotationConfig::CONFIG_NOT_SET:
            break;
        }
        invalid("data_spec.image.annotation の形式が指定されていません");
    }

    ImageTaskSpecs toTaskSpecs(const training::v1::ImageTaskSpecs &taskSpecs)
    {
        switch (taskSpecs.spec_case())
        {
        case training::v1::ImageTaskSpecs::kSegmentation:
        {
            const uint32_t ignoreIndex = taskSpecs.segmentation().ignore_index();
            if (ignoreIndex > 255)
            {
                invalid("data_spec.image.task_specs.segmentation.ignore_index は 0〜255 にしてください(" +
                        std::to_string(ignoreIndex) + ")");
            }
            SegmentationSpec spec;
            spec.ignoreIndex = static_cast<uint8_t>(ignoreIndex);
            return spec;
        }
        case training::v1::ImageTaskSpecs::kObjectDetection:
            return ObjectDetectionSpec{};
        case training::v1::ImageTaskSpecs::kClassification:
            return ClassificationSpec{};
        case training::v1::ImageTaskSpecs::SPEC_NOT_SET:
            break;
        }
        invalid("data_spec.image.task_specs のタスクが指定されていません");
    }

    DataSpec toDataSpec(const training::v1::DataSpec &dataSpec)
    {
        switch (dataSpec.spec_case())
        {
        case training::v1::DataSpec::kImage:
        {
            const auto &p = dataSpec.image();
            ImageSpec spec;
            spec.annotation = toAnnotation(p.annotation());
            spec.inputWidth = p.input_width();
            spec.inputHeight = p.input_height();
            spec.taskSpecs = toTaskSpecs(p.task_specs());
            requirePositive(static_cast<int64_t>(spec.inputWidth), "data_spec.image.input_width");
            requirePositive(static_cast<int64_t>(spec.inputHeight), "data_spec.image.input_height");
            return spec;
        }
        case training::v1::DataSpec::SPEC_NOT_SET:
            break;
        }
        invalid("data_spec のデータの種類が指定されていません");
    }

    // ---- metrics ----

    void fillMetrics(const TaskMetrics &metrics, training::v1::StreamProgressResponse &response)
    {
        std::visit(
            Overloaded{
                [&](const SegmentationMetricsConfig &s)
                {
                    training::v1::SegmentationMetrics *out = response.mutable_segmentation();
                    out->set_pixel_acc(s.pixelAccuracy);
                    out->set_miou(s.meanIoU);
                    out->set_fw_iou(s.fwIoU);
                    out->set_mean_class_accuracy(s.meanClassAccuracy);
                    out->mutable_per_class_iou()->Add(s.perClassIoU.begin(), s.perClassIoU.end());
                },
                [&](const ClassificationMetricsConfig &c)
                {
                    training::v1::ClassificationMetrics *out = response.mutable_classification();
                    out->set_accuracy(c.accuracy);
                    out->set_macro_f1(c.macroF1);
                    out->mutable_per_class_accuracy()->Add(c.perClassAccuracy.begin(), c.perClassAccuracy.end());
                },
            },
            metrics);
    }
}

StartTrainingCommand toStartTrainingCommand(const training::v1::StartTrainingRequest &request)
{
    StartTrainingCommand command;

    validateModelName(request.model_name());
    command.modelName = request.model_name();

    command.modelGraph = toModelGraph(request.model_graph());
    command.optimizer = toOptimizer(request.optimizer());
    command.loss = toLoss(request.loss());

    requirePositive(request.epoch(), "epoch");
    requirePositive(request.batch(), "batch");
    command.epochSize = request.epoch();
    command.batchSize = request.batch();
    command.saveLastEvery = request.save_last_every();

    if (request.dataset_path().empty())
    {
        invalid("dataset_path が空です");
    }
    command.datasetPath = request.dataset_path();
    command.resumeFrom = request.resume_from();
    if (request.has_seed())
    {
        command.seed = request.seed().value();
    }

    try
    {
        command.device = parseComputeDevice(request.device());
    }
    catch (const std::exception &e)
    {
        invalid(std::string("device が不正です: ") + e.what());
    }

    if (!request.has_data_spec())
    {
        invalid("data_spec が指定されていません");
    }
    command.dataSpec = toDataSpec(request.data_spec());

    return command;
}

training::v1::TrainingStatus toProtoTrainingStatus(TrainingStatus status)
{
    switch (status)
    {
    case TrainingStatus::Idle:
        return training::v1::TRAINING_STATUS_IDLE;
    case TrainingStatus::Running:
        return training::v1::TRAINING_STATUS_RUNNING;
    case TrainingStatus::Completed:
        return training::v1::TRAINING_STATUS_COMPLETED;
    case TrainingStatus::Failed:
        return training::v1::TRAINING_STATUS_FAILED;
    case TrainingStatus::Stopped:
        return training::v1::TRAINING_STATUS_STOPPED;
    }
    return training::v1::TRAINING_STATUS_UNSPECIFIED;
}

void fillStreamProgressResponse(const TrainingProcessSnapshot &snapshot, training::v1::StreamProgressResponse &response)
{
    response.set_status(toProtoTrainingStatus(snapshot.status));
    response.set_error_message(snapshot.errorMessage);

    if (!snapshot.hasEpochReport)
    {
        response.set_epoch(0); // 1 エポックも終わっていない
        return;
    }

    const EpochReport &report = snapshot.latest;
    response.set_epoch(report.epoch + 1u);
    response.set_train_loss(report.trainLoss);
    response.set_val_loss(report.validation.loss);
    response.set_epoch_elapsed_ms(report.epochElapsedMs);
    response.set_total_elapsed_ms(report.totalElapsedMs);
    fillMetrics(report.validation.taskMetrics, response);
}
