// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "mlx-helper",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift-lm.git", exact: "3.31.4"),
        .package(url: "https://github.com/ml-explore/mlx-swift.git", exact: "0.31.4"),
        .package(url: "https://github.com/huggingface/swift-transformers.git", exact: "1.3.3"),
    ],
    targets: [
        .executableTarget(
            name: "mlx-helper",
            dependencies: [
                .product(name: "MLX", package: "mlx-swift"),
                .product(name: "MLXLLM", package: "mlx-swift-lm"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
                .product(name: "Tokenizers", package: "swift-transformers"),
            ]
        )
    ]
)
