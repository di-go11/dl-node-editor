use sqlx::SqlitePool;

#[derive(Clone)]

pub struct SqliteDatasetRepository {
    pub(super) pool: SqlitePool, //
}

impl SqliteDatasetRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}
