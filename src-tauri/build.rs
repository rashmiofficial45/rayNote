fn main() {
    println!("cargo:rerun-if-changed=src/resource_usage.c");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/resource_usage.c")
            .compile("raynote_resource_usage");
        println!("cargo:rustc-link-lib=framework=IOKit");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    }
    tauri_build::build()
}
