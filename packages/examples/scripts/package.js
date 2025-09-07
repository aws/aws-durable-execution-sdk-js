const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const handlerFile = process.argv[2];
if (!handlerFile) {
    console.error('Usage: node package.js <handler-file>');
    process.exit(1);
}

// Extract just the file name without .handler suffix
const fileName = handlerFile.replace('.handler', '');

console.log(`Packaging ${fileName}...`);

const tempDir = 'temp-package';

// Clean up any existing temp directory
if (fs.existsSync(tempDir)) {
    execSync(`rm -rf ${tempDir}`);
}

// Create temp directory
fs.mkdirSync(tempDir);

// Copy JS file
fs.copyFileSync(
    path.join('dist/examples', fileName + '.js'), 
    path.join(tempDir, fileName + '.js')
);

// Copy source map if exists
try {
    fs.copyFileSync(
        path.join('dist/examples', fileName + '.js.map'), 
        path.join(tempDir, fileName + '.js.map')
    );
} catch {}

// Copy required dependencies from root node_modules
console.log('Copying required dependencies...');
fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });

const requiredDeps = [
    '@amzn',
    'tslib',
    '@smithy',
    '@aws-sdk',
    'uuid',
    'fast-xml-parser',
    '@aws-crypto',
    'bowser'
];

for (const dep of requiredDeps) {
    const srcPath = path.join('../../node_modules', dep);
    const destPath = path.join(tempDir, 'node_modules', dep);
    
    if (fs.existsSync(srcPath)) {
        console.log(`Copying ${dep}...`);
        execSync(`cp -r "${srcPath}" "${path.dirname(destPath)}"`);
    }
}

// Create zip file with quiet mode to avoid buffer overflow
const zipFile = `${handlerFile}.zip`;
execSync(`cd ${tempDir} && zip -q -r ../${zipFile} .`);

// Clean up
execSync(`rm -rf ${tempDir}`);

console.log(`Created: ${zipFile}`);
