// swift-tools-version: 5.9
import PackageDescription

// Capture only. No app, billing or account code belongs in this package.
let package = Package(
    name: "AudeeoCoreNative",
    platforms: [.macOS(.v13)],
    products: [.library(name: "AudeeoCoreNative", type: .static, targets: ["AudeeoCoreNative"])],
    targets: [.target(name: "AudeeoCoreNative", path: "Sources/AudeeoCoreNative")]
)
