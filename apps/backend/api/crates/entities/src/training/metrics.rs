#[derive(Debug, PartialEq, Clone)]
pub enum Metrics {
    Segmentation(SegmentationMetrics),
    Classification(ClassificationMetrics),
}

#[derive(Debug, PartialEq, Clone)]
pub struct SegmentationMetrics {
    pub pixel_accuracy: f64,
    pub miou: f64,
    pub fw_iou: f64,
    pub mean_class_accuracy: f64,
    pub per_class_iou: Vec<f64>,
    pub confusion_matrix: Option<Vec<Vec<u64>>>,
}
#[derive(Debug, PartialEq, Clone)]
pub struct ClassificationMetrics {
    pub accuracy: f64,
    pub macro_f1: f64,
    pub per_class_accuracy: Vec<f64>,
}
