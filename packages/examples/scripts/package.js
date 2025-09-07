#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const example = process.argv[2];
if (!example) {
    console.error('Usage: node scripts/package.js <example-name>');
    process.exit(1);
}

console.log(`Packaging ${example}...`);

const handlerFile = example.replace(/\.handler$/, '');
const tempDir = 'temp-package';

// Create temp directory
fs.mkdirSync(tempDir, { recursive: true });

// Copy JS file
fs.copyFileSync(
    path.join('dist/examples', handlerFile + '.js'), 
    path.join(tempDir, handlerFile + '.js')
);

// Copy source map if exists
try {
    fs.copyFileSync(
        path.join('dist/examples', handlerFile + '.js.map'), 
        path.join(tempDir, handlerFile + '.js.map')
    );
} catch {}

// Copy node_modules
execSync(`cp -r node_modules ${tempDir}`);

// Copy SDK by following the symlink to get actual files
const sdkSourcePath = '../lambda-durable-functions-sdk-js/dist';
const sdkNodeModulesPath = path.join(tempDir, 'node_modules/@amzn/durable-executions-language-sdk');
fs.mkdirSync(sdkNodeModulesPath, { recursive: true });
execSync(`cp -r ${sdkSourcePath}/* ${sdkNodeModulesPath}/`);
execSync(`cp ../lambda-durable-functions-sdk-js/package.json ${sdkNodeModulesPath}/`);

// Create zip
execSync(`cd ${tempDir} && zip -r ../${example}.zip .`);

// Cleanup
execSync(`rm -rf ${tempDir}`);

console.log(`Created: ${example}.zip`);
