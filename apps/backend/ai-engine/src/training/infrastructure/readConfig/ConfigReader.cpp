#include "training/infrastructure/readConfig/ConfigReader.hpp"

#include <cstdint>
#include <fstream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <iostream>

namespace
{
    double parseDouble(const std::string &value, const std::string &key)
    {
        if (value.empty())
        {
            throw std::runtime_error(key + " value is empty");
        }
        try
        {
            return std::stod(value);
        }
        catch (...)
        {
            throw std::runtime_error(key + " value is not a number: " + value);
        }
    }

    // 整数として読む。std::stoll は "12abc" を 12 として受理してしまうため、
    // 変換後に末尾が残っていないかも確認する。
    int64_t parseInt64(const std::string &value, const std::string &key)
    {
        if (value.empty())
        {
            throw std::runtime_error(key + " value is empty");
        }
        try
        {
            size_t pos = 0;
            const long long parsed = std::stoll(value, &pos);
            if (pos != value.size())
            {
                throw std::invalid_argument("trailing characters");
            }
            return static_cast<int64_t>(parsed);
        }
        catch (...)
        {
            throw std::runtime_error(key + " value is not an integer: " + value);
        }
    }

    LossType parseLossType(const std::string &value)
    {
        if (value == "CrossEntropy")
        {
            return LossType::CrossEntropy;
        }
        if (value == "Mse_loss")
        {
            return LossType::MseLoss;
        }
        if (value == "Dice_loss")
        {
            return LossType::DiceLoss;
        }
        if (value == "Focal_loss")
        {
            return LossType::FocalLoss;
        }
        if (value == "Combo_loss")
        {
            return LossType::ComboLoss;
        }
        if (value == "Boundary_loss")
        {
            return LossType::BoundaryLoss;
        }
        throw std::runtime_error("Unknown loss type: " + value);
    }

    bool parseBool(const std::string &value, const std::string &key)
    {
        if (value == "true" || value == "True" || value == "1")
        {
            return true;
        }
        if (value == "false" || value == "False" || value == "0")
        {
            return false;
        }
        throw std::runtime_error(key + " value must be true or false: " + value);
    }

    // 設定ファイルは行順が自由なので(optimizer_type が learning_rate より後に
    // 書かれていてもよい)、パース中は種別と各ハイパーパラメータを個別に受け取り、
    // 全行を読み終えてから OptimizerConfig(variant)を組み立てる。
    // 未指定(nullopt)のフィールドは各 Config 構造体の既定値のままにする。
    struct OptimizerFields
    {
        OptimizerType type = OptimizerType::Adam;
        std::optional<double> learningRate;
        std::optional<double> weightDecay;
        std::optional<double> beta1;
        std::optional<double> beta2;
        std::optional<double> eps;
        std::optional<double> momentum;
        std::optional<bool> nesterov;
    };

    // 指定されていれば上書きする。
    void applyIfSet(double &target, const std::optional<double> &source)
    {
        if (source.has_value())
        {
            target = *source;
        }
    }

    OptimizerConfig buildOptimizerConfig(const OptimizerFields &fields)
    {
        switch (fields.type)
        {
        case OptimizerType::Adam:
        {
            AdamOptimizerConfig c;
            applyIfSet(c.learningRate, fields.learningRate);
            applyIfSet(c.weightDecay, fields.weightDecay);
            applyIfSet(c.beta1, fields.beta1);
            applyIfSet(c.beta2, fields.beta2);
            applyIfSet(c.eps, fields.eps);
            return c;
        }
        case OptimizerType::AdamW:
        {
            AdamWOptimizerConfig c;
            applyIfSet(c.learningRate, fields.learningRate);
            applyIfSet(c.weightDecay, fields.weightDecay);
            applyIfSet(c.beta1, fields.beta1);
            applyIfSet(c.beta2, fields.beta2);
            return c;
        }
        case OptimizerType::SGD:
        {
            SGDOptimizerConfig c;
            applyIfSet(c.learningRate, fields.learningRate);
            applyIfSet(c.weightDecay, fields.weightDecay);
            applyIfSet(c.momentum, fields.momentum);
            if (fields.nesterov.has_value())
            {
                c.nesterov = *fields.nesterov;
            }
            return c;
        }
        }

        throw std::runtime_error("buildOptimizerConfig: 未知の OptimizerType");
    }

    struct LossConfigFields
    {
        LossType type = LossType::CrossEntropy;
        std::optional<double> gamma;
        std::optional<double> alpha;
    };

    LossConfig buildLossConfig(const LossConfigFields &fields)
    {
        switch (fields.type)
        {
        case LossType::CrossEntropy:
            return CrossEntropyConfig{};
        case LossType::MseLoss:
            return MseLossConfig{};
        case LossType::DiceLoss:
            return DiceLossConfig{};
        case LossType::FocalLoss:
            if (!fields.gamma.has_value() || !fields.alpha.has_value())
            {
                throw std::runtime_error("gamma and alpha are required for FocalLoss");
            }
            return FocalLossConfig{*fields.gamma, *fields.alpha};
        case LossType::ComboLoss:
            return ComboLossConfig{fields.alpha.value_or(0.5)};
        case LossType::BoundaryLoss:
            return BoundaryLossConfig{};
        default:
            throw std::runtime_error("buildLossConfig: 未知の LossType");
        }
    }

    struct DatasetFields
    {
        // 種別は文字列のまま貯める。どの種別 enum で解釈するかは modality(TaskFields)が
        // 決めるため、行を読んでいる最中には解釈できない(行順が自由なので)。
        // 未指定なら従来どおり PASCAL VOC として扱う。
        std::string datasetPath;
        std::string typeName = "PascalVoc";
        std::optional<bool> includeDifficult;
    };

    // modality: 何の学習か(Image など)。task の解釈と、DatasetFields::typeName の解釈の
    // 両方を決める唯一の情報源。未指定なら従来どおり画像のセグメンテーション。
    struct TaskFields
    {
        std::string modality = "Image";
        std::string task = "Segmentation";
    };

    ImageTaskType parseImageTaskType(const std::string &task)
    {
        if (task == "Classification")
        {
            return ImageTaskType::IMAGE_CLASSIFICATION;
        }
        else if (task == "Detection")
        {
            return ImageTaskType::OBJECT_DETECTION;
        }
        else if (task == "Segmentation")
        {
            return ImageTaskType::SEMANTIC_SEGMENTATION;
        }
        else
        {
            throw std::runtime_error("Unknown image task: " + task);
        }
    }

    ImageAnnotationType parseImageAnnotationType(const std::string &typeName)
    {
        if (typeName == "PascalVoc")
        {
            return ImageAnnotationType::PASCAL_VOC;
        }
        throw std::runtime_error("Unknown image dataset type: " + typeName);
    }

    // 画像用。モダリティを足すときは、同名で別の種別 enum を受けるオーバーロードを追加する。
    ImageAnnotationConfig buildAnnotationConfig(ImageAnnotationType type, const DatasetFields &fields)
    {
        switch (type)
        {
        case ImageAnnotationType::PASCAL_VOC:
        {
            PascalVocConfig config;
            if (fields.includeDifficult.has_value())
            {
                config.includeDifficult = *fields.includeDifficult;
            }
            return config;
        }
        default:
            throw std::runtime_error("buildAnnotationConfig: 未知の ImageAnnotationType");
        }
    }

    // modality を1回だけ解釈し、その結果で task と dataset の両方を組み立てる。
    // 「画像のデータなのに波形の task」といった不一致は、ここでは構造上起きない。
    static_assert(std::variant_size_v<TrainingTaskType> == 1 && std::variant_size_v<DatasetType> == 1,
                  "モダリティを追加したら applyModality に分岐を追加すること");

    void applyModality(const TaskFields &task, const DatasetFields &dataset, AppConfig &out)
    {
        if (dataset.datasetPath.empty())
        {
            throw std::runtime_error("dataset_path is not specified");
        }

        if (task.modality == "Image")
        {
            out.task = parseImageTaskType(task.task);
            out.dataset.datasetPath = dataset.datasetPath;
            out.dataset.annotationConfig =
                DatasetAnnotationConfig{buildAnnotationConfig(parseImageAnnotationType(dataset.typeName), dataset)};
            return;
        }
        throw std::runtime_error("Unknown training_task: " + task.modality);
    }
} // namespace

ConfigReader::ConfigReader() {}

AppConfig ConfigReader::readAll(const std::string &filePath)
{
    AppConfig appConfig;
    OptimizerFields optimizerFields;
    LossConfigFields lossFields;
    DatasetFields datasetFields;
    TaskFields taskFields;
    std::ifstream file(filePath);

    if (!file.is_open())
    {
        throw std::runtime_error("Could not open config file: " + filePath);
    }
    int lineNumber = 0;

    std::string line;
    while (std::getline(file, line))
    {
        lineNumber++;
        // 余計な空白の除去
        line = trim(line);

        // 空行、または「#」で始まる行は無視
        if (line.empty() || line[0] == '#')
        {
            continue;
        }

        // '=' の位置を探して, keyとvalueに分割
        auto delimiterPos = line.find('=');
        if (delimiterPos == std::string::npos)
        {
            throw std::runtime_error("Invalid config line at " + std::to_string(lineNumber) + ": " + line);
        }

        std::string key = trim(line.substr(0, delimiterPos));
        std::string value = trim(line.substr(delimiterPos + 1));

        try
        {
            if (key == "optimizer_type")
            {
                if (value == "Adam")
                {
                    optimizerFields.type = OptimizerType::Adam;
                }
                else if (value == "SGD")
                {
                    optimizerFields.type = OptimizerType::SGD;
                }
                else if (value == "AdamW")
                {
                    optimizerFields.type = OptimizerType::AdamW;
                }
                else
                {
                    throw std::runtime_error("Unknown optimizer type: " + value);
                }
            }
            else if (key == "Activefunction_type")
            {
                if (value == "ReLU")
                {
                    appConfig.activation.activationType = ActivationType::ReLU;
                }
                else if (value == "Sigmoid")
                {
                    appConfig.activation.activationType = ActivationType::Sigmoid;
                }
                else if (value == "Tanh")
                {
                    appConfig.activation.activationType = ActivationType::Tanh;
                }
                else if (value == "Softmax")
                {
                    appConfig.activation.activationType = ActivationType::Softmax;
                }
                else
                {
                    throw std::runtime_error("Unknown activation type: " + value);
                }
            }
            else if (key == "learning_rate")
            {
                if (value.empty())
                {
                    throw std::runtime_error("Learning rate value is empty");
                }

                double parsedValue;
                try
                {
                    parsedValue = std::stod(value);
                }
                catch (...) // パース失敗時のエラー
                {
                    throw std::runtime_error("Learning rate value is not a number: " + value);
                }

                if (parsedValue > 1.0 || parsedValue < 0.0)
                {
                    throw std::runtime_error("Learning rate value is out of range (0.0 - 1.0): " + value);
                }
                optimizerFields.learningRate = parsedValue;
            }
            else if (key == "weight_decay")
            {
                if (value.empty())
                {
                    throw std::runtime_error("Weight decay value is empty");
                }

                double parsedValue;
                try
                {
                    parsedValue = std::stod(value);
                }
                catch (...) // パース失敗時のエラー
                {
                    throw std::runtime_error("Weight decay value is not a number: " + value);
                }

                if (parsedValue < 0.0)
                {
                    throw std::runtime_error("Weight decay value must not be negative: " + value);
                }
                optimizerFields.weightDecay = parsedValue;
            }
            else if (key == "dataset_path")
            {
                if (value.empty())
                {
                    throw std::runtime_error("Dataset path value is empty");
                }
                datasetFields.datasetPath = value;
            }
            else if (key == "output_dir")
            {
                if (value.empty())
                {
                    throw std::runtime_error("output_dir value is empty");
                }
                appConfig.outputDir = value;
            }
            // ---- Optimizer 種別ごとのハイパーパラメータ ----
            // 指定しなければ各 Config 構造体の既定値が使われる。
            // 選択中の optimizer_type に関係ないキーを書いても無視される
            // (例: Adam を選んで momentum を書いても効かない)。
            else if (key == "beta1" || key == "beta2")
            {
                const double parsedValue = parseDouble(value, key);
                if (parsedValue < 0.0 || parsedValue >= 1.0)
                {
                    throw std::runtime_error(key + " value is out of range [0.0, 1.0): " + value);
                }
                (key == "beta1" ? optimizerFields.beta1 : optimizerFields.beta2) = parsedValue;
            }
            else if (key == "eps")
            {
                const double parsedValue = parseDouble(value, key);
                if (parsedValue <= 0.0)
                {
                    throw std::runtime_error("eps value must be greater than 0: " + value);
                }
                optimizerFields.eps = parsedValue;
            }
            else if (key == "momentum")
            {
                const double parsedValue = parseDouble(value, key);
                if (parsedValue < 0.0)
                {
                    throw std::runtime_error("momentum value must not be negative: " + value);
                }
                optimizerFields.momentum = parsedValue;
            }
            else if (key == "nesterov")
            {
                optimizerFields.nesterov = parseBool(value, key);
            }
            // ---- Loss ----
            // loss_type 未指定なら CrossEntropy。種別に関係ないキーは無視される
            // (例: Dice_loss を選んで gamma を書いても効かない)。
            else if (key == "loss_type")
            {
                lossFields.type = parseLossType(value);
            }
            else if (key == "gamma")
            {
                const double parsedValue = parseDouble(value, key);
                if (parsedValue < 0.0)
                {
                    throw std::runtime_error("gamma value must not be negative: " + value);
                }
                lossFields.gamma = parsedValue;
            }
            else if (key == "alpha")
            {
                const double parsedValue = parseDouble(value, key);
                if (parsedValue < 0.0 || parsedValue > 1.0)
                {
                    throw std::runtime_error("alpha value is out of range [0.0, 1.0]: " + value);
                }
                lossFields.alpha = parsedValue;
            }
            else if (key == "ignore_index")
            {
                // マスクは uint8 で前処理されるため、範囲外は黙って切り詰められる前にここで弾く。
                const int64_t parsedValue = parseInt64(value, key);
                if (parsedValue < 0 || parsedValue > 255)
                {
                    throw std::runtime_error("ignore_index value is out of range [0, 255]: " + value);
                }
                appConfig.ignoreIndex = parsedValue;
            }
            else if (key == "model_name")
            {
                if (value.empty())
                {
                    throw std::runtime_error("model_name value is empty");
                }
                // チェックポイントのファイル名(<modelName>_best.pt / _last.pt)に使われる。
                appConfig.modelName = value;
            }
            else if (key == "training_task")
            {
                if (value.empty())
                {
                    throw std::runtime_error("training_task value is empty");
                }
                taskFields.modality = value;
            }
            else if (key == "training_task_type")
            {
                if (value.empty())
                {
                    throw std::runtime_error("training_task_type value is empty");
                }
                taskFields.task = value;
            }
            else if (key == "dataset_type")
            {
                if (value.empty())
                {
                    throw std::runtime_error("dataset_type value is empty");
                }
                datasetFields.typeName = value;
            }
            else if (key == "include_difficult")
            {
                datasetFields.includeDifficult = parseBool(value, key);
            }
            else if (key == "model_architecture")
            {
                if (value == "Sample")
                {
                    appConfig.architecture = ModelArchitectureType::Sample;
                }
                else if (value == "SegNet")
                {
                    appConfig.architecture = ModelArchitectureType::SegNet;
                }
                else
                {
                    throw std::runtime_error("Unknown model architecture: " + value);
                }
            }
            else if (key == "resume_from")
            {
                // 空を許す(= 自動判定)。値があればその .pt から再開する。
                appConfig.resumeFrom = value;
            }
            else if (key == "save_last_every")
            {
                if (value.empty())
                {
                    throw std::runtime_error("save_last_every value is empty");
                }

                int parsedValue;
                try
                {
                    parsedValue = std::stoi(value);
                }
                catch (...)
                {
                    throw std::runtime_error("save_last_every value is not a number: " + value);
                }

                if (parsedValue < 0)
                {
                    throw std::runtime_error("save_last_every value must not be negative: " + value);
                }
                appConfig.saveLastEvery = static_cast<unsigned int>(parsedValue);
            }
            else if (key == "epoch_size")
            {
                if (value.empty())
                {
                    throw std::runtime_error("Epoch size value is empty");
                }

                int parsedValue;
                try
                {
                    parsedValue = std::stoi(value);
                }
                catch (...) // パース失敗時のエラー
                {
                    throw std::runtime_error("Epoch size value is not a number: " + value);
                }

                if (parsedValue <= 0)
                {
                    throw std::runtime_error("Epoch size value must be greater than 0: " + value);
                }
                appConfig.epochSize = static_cast<unsigned int>(parsedValue);
            }
            else if (key == "batch_size")
            {
                if (value.empty())
                {
                    throw std::runtime_error("Batch size value is empty");
                }

                int parsedValue;
                try
                {
                    parsedValue = std::stoi(value);
                }
                catch (...) // パース失敗時のエラー
                {
                    throw std::runtime_error("Batch size value is not a number: " + value);
                }

                if (parsedValue <= 0)
                {
                    throw std::runtime_error("Batch size value must be greater than 0: " + value);
                }
                appConfig.batchSize = static_cast<unsigned int>(parsedValue);
            }
            else if (key == "input_width")
            {
                if (value.empty())
                {
                    throw std::runtime_error("input_width value is empty");
                }
                int parsedValue;
                try
                {
                    parsedValue = std::stoi(value);
                }
                catch (...)
                {
                    throw std::runtime_error("input_width is not a number" + value);
                }

                if (parsedValue <= 0)
                {
                    throw std::runtime_error("input_width value must be greater than 0:" + value);
                }
                appConfig.input_width = static_cast<size_t>(parsedValue);
            }
            else if (key == "input_height")
            {
                if (value.empty())
                {
                    throw std::runtime_error("input_height value is empty");
                }
                int parsedValue;
                try
                {
                    parsedValue = std::stoi(value);
                }
                catch (...)
                {
                    throw std::runtime_error("input_height is not a number" + value);
                }

                if (parsedValue <= 0)
                {
                    throw std::runtime_error("input_height value must be greater than 0:" + value);
                }
                appConfig.input_height = static_cast<size_t>(parsedValue);
            }
            else if (key == "device")
            {
                // "cpu" / "cuda" / "cuda:N" のパースは ComputeDevice entity の
                // parseComputeDevice に一任する(不正値は例外を投げる)。
                appConfig.device = parseComputeDevice(value);
            }
            else
            {
                throw std::runtime_error("Unknown config key: " + key);
            }
        }
        catch (const std::exception &e)
        {
            throw std::runtime_error("Error parsing config line at " + std::to_string(lineNumber) + ": " + e.what());
        }
    }

    // 全行を読み終えてから種別に応じた Config を組み立てる。
    appConfig.optimizer = buildOptimizerConfig(optimizerFields);
    appConfig.loss = buildLossConfig(lossFields);
    applyModality(taskFields, datasetFields, appConfig);

    return appConfig;
}

std::string ConfigReader::trim(const std::string &str)
{
    const char *whitespace = " \t\n\r\f\v";
    size_t start = str.find_first_not_of(whitespace);
    size_t end = str.find_last_not_of(whitespace);

    if (start == std::string::npos || end == std::string::npos)
    {
        return "";
    }

    return str.substr(start, end - start + 1);
}
