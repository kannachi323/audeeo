// swift-tools-version: 5.9
import PackageDescription
let package = Package(
 name: "AudeeoNative", platforms: [.macOS(.v13)],
 products: [.library(name: "AudeeoNative", type: .static, targets: ["AudeeoNative"])],
 dependencies: [.package(url: "https://github.com/RevenueCat/purchases-ios.git", exact: "5.89.0")],
 targets: [.target(name: "AudeeoNative", dependencies: [.product(name: "RevenueCat", package: "purchases-ios")])]
)
