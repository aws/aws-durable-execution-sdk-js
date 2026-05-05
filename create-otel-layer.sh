#!/bin/bash
# Creates a Lambda layer zip for @opentelemetry packages
# Layer structure: nodejs/node_modules/@opentelemetry/...

set -e

LAYER_DIR="lambda-layer"
ZIP_NAME="opentelemetry-layer.zip"

# Clean up any previous build
rm -rf "$LAYER_DIR"
rm -f "$ZIP_NAME"

# Create the layer directory structure
mkdir -p "$LAYER_DIR/nodejs"

# Create a package.json with the @opentelemetry dependencies
cat > "$LAYER_DIR/nodejs/package.json" << 'EOF'
{
  "name": "opentelemetry-layer",
  "version": "1.0.0",
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-grpc": "^0.214.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.215.0",
    "@opentelemetry/id-generator-aws-xray": "^2.1.0",
    "@opentelemetry/instrumentation": "^0.216.0",
    "@opentelemetry/instrumentation-aws-sdk": "^0.71.0",
    "@opentelemetry/propagator-aws-xray": "^2.2.0",
    "@opentelemetry/sdk-trace-base": "^2.6.1",
    "@opentelemetry/sdk-trace-node": "^2.6.1",
    "@grpc/grpc-js": "^1.14.3"
  }
}
EOF

# Install dependencies
echo "Installing @opentelemetry packages..."
cd "$LAYER_DIR/nodejs"
npm install --production
cd ../..

# Remove unnecessary files to reduce layer size
echo "Cleaning up unnecessary files..."
find "$LAYER_DIR" -name "*.md" -delete
find "$LAYER_DIR" -name "*.ts" ! -name "*.d.ts" -delete
find "$LAYER_DIR" -name ".package-lock.json" -delete
find "$LAYER_DIR" -name "tsconfig.json" -delete
find "$LAYER_DIR" -name ".eslintrc*" -delete
find "$LAYER_DIR" -name "CHANGELOG*" -delete
find "$LAYER_DIR" -name "LICENSE" -delete

# Create the zip
echo "Creating $ZIP_NAME..."
cd "$LAYER_DIR"
zip -r "../$ZIP_NAME" .
cd ..

# Show the result
echo ""
echo "Layer zip created: $ZIP_NAME"
echo "Size: $(du -h "$ZIP_NAME" | cut -f1)"
echo ""
echo "Structure:"
echo "  $ZIP_NAME"
echo "  └── nodejs/"
echo "      └── node_modules/"
echo "          ├── @opentelemetry/"
echo "          └── @grpc/"

# Clean up build directory
rm -rf "$LAYER_DIR"

echo ""
echo "Done! Upload this zip as a Lambda layer."
