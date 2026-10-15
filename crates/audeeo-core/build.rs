// Builds the Swift capture package on macOS and links it statically.
// Other platforms need nothing native beyond their Rust dependencies.
fn main() {
    println!("cargo:rerun-if-changed=apple/Package.swift");
    println!("cargo:rerun-if-changed=apple/Sources");
    println!("cargo:rerun-if-env-changed=AUDEEO_CORE_SKIP_SWIFT");
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    // A cross `cargo check` from Linux has no Swift toolchain; linking would
    // fail later, but type-checking the Rust side still works.
    if target != "macos" || std::env::var_os("AUDEEO_CORE_SKIP_SWIFT").is_some() {
        return;
    }
    link_swift();
}

#[cfg(target_os = "macos")]
fn link_swift() {
    swift_rs::SwiftLinker::new("13.0")
        .with_package("AudeeoCoreNative", "apple/")
        .link();
    for framework in ["AVFoundation", "CoreAudio", "AppKit"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}

#[cfg(not(target_os = "macos"))]
fn link_swift() {
    panic!("audeeo-core's macOS capture builds on a macOS host; set AUDEEO_CORE_SKIP_SWIFT=1 to type-check elsewhere");
}
