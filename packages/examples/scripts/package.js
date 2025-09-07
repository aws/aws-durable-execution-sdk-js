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

// Copy SDK from workspace location
const sdkSourcePath = '../lambda-durable-functions-sdk-js';
const sdkNodeModulesPath = path.join(tempDir, 'node_modules/@amzn/durable-executions-language-sdk');
fs.mkdirSync(path.dirname(sdkNodeModulesPath), { recursive: true });

// Copy the entire built SDK directory
execSync(`cp -r ${sdkSourcePath}/dist ${sdkNodeModulesPath}`);

// Copy and fix package.json to point to correct main file
const packageJson = JSON.parse(fs.readFileSync(`${sdkSourcePath}/package.json`, 'utf8'));
packageJson.main = 'index.js'; // Fix main field since we're copying dist contents to root
fs.writeFileSync(path.join(sdkNodeModulesPath, 'package.json'), JSON.stringify(packageJson, null, 2));

// Copy dex-internal-sdk dependency (pre-built)
const dexSdkSourcePath = '../dex-internal-sdk';
const dexSdkNodeModulesPath = path.join(tempDir, 'node_modules/@amzn/dex-internal-sdk');
if (fs.existsSync(`${dexSdkSourcePath}/dist-cjs`)) {
    fs.mkdirSync(path.dirname(dexSdkNodeModulesPath), { recursive: true });
    execSync(`cp -r ${dexSdkSourcePath}/dist-cjs/* ${dexSdkNodeModulesPath}/`);
    
    // Copy and fix dex-internal-sdk package.json
    const dexPackageJson = JSON.parse(fs.readFileSync(`${dexSdkSourcePath}/package.json`, 'utf8'));
    dexPackageJson.main = 'index.js'; // Point to root since we copied dist-cjs contents
    fs.writeFileSync(path.join(dexSdkNodeModulesPath, 'package.json'), JSON.stringify(dexPackageJson, null, 2));
}

// Create zip
execSync(`cd ${tempDir} && zip -r ../${example}.zip .`);

// Cleanup
execSync(`rm -rf ${tempDir}`);

console.log(`Created: ${example}.zip`);
