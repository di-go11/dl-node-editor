struct DatasetSize {
    int num_samples; // Number of samples in the dataset
    int num_features; // 
    int num_classes;

    DatasetSize(int samples, int features, int classes)
        : num_samples(samples), num_features(features), num_classes(classes) {}
};