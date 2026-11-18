#[derive(Debug, Clone)]
pub struct HttpConfig {
    max_dataset_upload_bytes: usize,
}

impl HttpConfig {
    pub fn new(max_dataset_upload_bytes: usize) -> Result<Self, String> {
        if max_dataset_upload_bytes == 0 {
            return Err("上限は0より大きい値".into());
        }
        Ok(Self {
            max_dataset_upload_bytes,
        })
    }
    pub fn max_dataset_upload_bytes(&self) -> usize {
        self.max_dataset_upload_bytes
    }
}
