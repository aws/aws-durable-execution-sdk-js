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
    path.join('dist', fileName + '.js'), 
    path.join(tempDir, fileName + '.js')
);

// Copy source map if exists
try {
    fs.copyFileSync(
        path.join('dist', fileName + '.js.map'), 
        path.join(tempDir, fileName + '.js.map')
    );
} catch {}

// Create zip file with quiet mode to avoid buffer overflow
const zipFile = `${handlerFile}.zip`;
execSync(`cd ${tempDir} && zip -q -r ../${zipFile} .`);

// Clean up
execSync(`rm -rf ${tempDir}`);

console.log(`Created: ${zipFile}`);
