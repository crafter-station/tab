// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "coreml-helper",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/huggingface/swift-transformers.git", exact: "1.3.3"),
    ],
    targets: [
        .executableTarget(
            name: "coreml-helper",
            dependencies: [.product(name: "Tokenizers", package: "swift-transformers")]
        )
    ]
)
