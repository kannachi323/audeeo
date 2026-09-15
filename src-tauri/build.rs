fn main() {
    println!("cargo:rerun-if-env-changed=AUDEEO_NATIVE_ARCHIVE");
    let mut native_archive = std::env::var("AUDEEO_NATIVE_ARCHIVE").ok();
    // macOS needs the real RevenueCat SDK for entitlement reads as well as purchases.
    if native_archive.is_none() && std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" {
        let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .parent()
            .unwrap()
            .to_path_buf();
        let target = std::env::var("TARGET").unwrap();
        let arch = if target.starts_with("x86_64") {
            "x86_64"
        } else {
            "arm64"
        };
        println!("cargo:rerun-if-changed=../native/apple/Package.swift");
        println!("cargo:rerun-if-changed=../native/apple/Package.resolved");
        println!("cargo:rerun-if-changed=../native/apple/Sources");
        println!("cargo:rerun-if-changed=../scripts/apple-native-build.sh");
        let status = std::process::Command::new("sh")
            .arg(root.join("scripts/apple-native-build.sh"))
            .args(["macos", arch])
            .status()
            .expect("Xcode is required for macOS billing");
        assert!(status.success(), "RevenueCat macOS build failed");
        let output = std::process::Command::new("swift")
            .args(["build", "--package-path"])
            .arg(root.join("native/apple"))
            .args(["-c", "release", "--arch", arch, "--show-bin-path"])
            .output()
            .expect("Cannot locate the macOS billing archive");
        assert!(
            output.status.success(),
            "Cannot locate the macOS billing archive"
        );
        let products = std::path::PathBuf::from(String::from_utf8(output.stdout).unwrap().trim());
        native_archive = Some(
            products
                .join("libAudeeoNative.a")
                .to_string_lossy()
                .into_owned(),
        );
    }
    // iOS must never silently compile the no-SDK purchase stub.
    if native_archive.is_none() && std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "ios" {
        let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .parent()
            .unwrap()
            .to_path_buf();
        let target = std::env::var("TARGET").unwrap();
        let simulator = target.ends_with("sim") || target.starts_with("x86_64");
        let platform = if simulator { "ios-simulator" } else { "ios" };
        let sdk = if simulator {
            "iphonesimulator"
        } else {
            "iphoneos"
        };
        println!("cargo:rerun-if-changed=../native/apple/Package.swift");
        println!("cargo:rerun-if-changed=../native/apple/Package.resolved");
        println!("cargo:rerun-if-changed=../native/apple/Sources");
        println!("cargo:rerun-if-changed=../scripts/apple-native-build.sh");
        let status = std::process::Command::new("sh")
            .arg(root.join("scripts/apple-native-build.sh"))
            .arg(platform)
            .status()
            .expect("Xcode is required for iOS billing");
        assert!(status.success(), "RevenueCat iOS build failed");
        native_archive = Some(
            root.join(format!(
                "native/apple/.build/{platform}/Build/Products/Release-{sdk}/libAudeeoNative.a"
            ))
            .to_string_lossy()
            .into_owned(),
        );
    }
    if let Some(ref archive) = native_archive {
        let archive = std::path::Path::new(archive);
        assert!(
            archive.is_absolute() && archive.exists(),
            "AUDEEO_NATIVE_ARCHIVE must identify a built Apple static archive"
        );
        println!("cargo:rerun-if-changed={}", archive.display());
        // rustc cannot bundle a universal (fat) archive into its staticlib.
        // Select the exact architecture while keeping resources beside the source archive.
        let target = std::env::var("TARGET").unwrap();
        let arch = if target.starts_with("x86_64") {
            "x86_64"
        } else {
            "arm64"
        };
        let output = std::process::Command::new("xcrun")
            .args(["lipo", "-archs"])
            .arg(archive)
            .output()
            .expect("lipo is required");
        assert!(output.status.success(), "Cannot inspect native archive");
        let architectures = String::from_utf8(output.stdout).unwrap();
        assert!(
            architectures.split_whitespace().any(|a| a == arch),
            "Native archive architecture mismatch"
        );
        let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        let thin = out.join("libAudeeoNative.a");
        if architectures.split_whitespace().count() > 1 {
            let status = std::process::Command::new("xcrun")
                .args(["lipo", "-thin", arch])
                .arg(archive)
                .arg("-output")
                .arg(&thin)
                .status()
                .expect("Cannot select native archive architecture");
            assert!(status.success(), "Cannot thin native archive");
        } else {
            std::fs::copy(archive, &thin).expect("Cannot copy native archive");
        }
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=AudeeoNative");
        for framework in [
            "AVFoundation",
            "AuthenticationServices",
            "LocalAuthentication",
            "Security",
            "StoreKit",
            "SwiftUI",
            "Combine",
            "SystemConfiguration",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
        if os == "macos" {
            println!("cargo:rustc-link-lib=framework=AppKit");
            println!("cargo:rustc-link-lib=framework=CoreAudio");
        } else {
            for framework in ["UIKit", "AVKit", "CoreMedia", "CoreVideo"] {
                println!("cargo:rustc-link-lib=framework={framework}");
            }
        }
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build()
}
