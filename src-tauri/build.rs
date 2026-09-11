fn main() {
    println!("cargo:rerun-if-env-changed=AUDEEO_NATIVE_ARCHIVE");
    let mut native_archive = std::env::var("AUDEEO_NATIVE_ARCHIVE").ok();
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
        } else {
            for framework in ["UIKit", "AVKit", "CoreMedia", "CoreVideo"] {
                println!("cargo:rustc-link-lib=framework={framework}");
            }
        }
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    if native_archive.is_none() && std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" {
        let out = std::env::var("OUT_DIR").unwrap();
        let target = std::env::var("TARGET").unwrap();
        let arch = if target.starts_with("aarch64") {
            "arm64"
        } else {
            "x86_64"
        };
        let sources = [
            "../native/apple/Sources/AudeeoNative/MacPanel.swift",
            "../native/apple/Sources/AudeeoNative/Microphone.swift",
            "../native/apple/Sources/AudeeoNative/Playback.swift",
            "../native/apple/Sources/AudeeoNative/SystemAudio.swift",
            "../native/apple/Sources/AudeeoNative/CaptureSources.swift",
            "../native/apple/Sources/AudeeoNative/OAuth.swift",
            "../native/apple/Sources/AudeeoNative/CredentialStore.swift",
            "../native/apple/Sources/AudeeoNative/Purchases.swift",
            "../native/apple/Sources/AudeeoNative/NativeHistory.swift",
        ];
        for source in sources {
            println!("cargo:rerun-if-changed={source}");
        }
        let status = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-emit-library",
                "-static",
                "-module-name",
                "AudeeoNative",
                "-target",
                &format!("{arch}-apple-macosx13.0"),
            ])
            .args(sources)
            .args(["-o", &format!("{out}/libAudeeoNative.a")])
            .status()
            .expect("Swift compiler required");
        assert!(status.success(), "Native Apple build failed");
        println!("cargo:rustc-link-search=native={out}");
        println!("cargo:rustc-link-lib=static=AudeeoNative");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=AuthenticationServices");
        println!("cargo:rustc-link-lib=framework=LocalAuthentication");
        println!("cargo:rustc-link-lib=framework=Security");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        if let Ok(output) = std::process::Command::new("xcode-select")
            .arg("-p")
            .output()
        {
            if output.status.success() {
                let xcode_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                println!("cargo:rustc-link-arg=-Wl,-rpath,{xcode_path}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx");
                println!("cargo:rustc-link-arg=-Wl,-rpath,{xcode_path}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx");
            }
        }
    }
    tauri_build::build()
}
