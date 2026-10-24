#[path = "../src/database.rs"]
mod database;
#[path = "../src/search.rs"]
mod search;

use std::path::PathBuf;
use database::Database;

fn main() {
    let dir = PathBuf::from("/tmp/app_db_current_dir");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let db = Database::new(dir.clone()).expect("Failed to initialize Database::new");
    drop(db);
    println!("Successfully initialized current Database::new at {:?}", dir);
}
