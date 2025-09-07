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

// Copy all dependencies from root node_modules except large unnecessary ones
console.log('Copying dependencies from root node_modules...');
fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });

// Exclude large dev dependencies we don't need in Lambda
const excludeDeps = [
    'typescript',
    'jest',
    'eslint',
    '@types',
    'prettier',
    'webpack',
    'babel'
];

const rootNodeModules = '../../node_modules';
const deps = fs.readdirSync(rootNodeModules);

for (const dep of deps) {
    // Skip if it's in our exclude list
    if (excludeDeps.some(exclude => dep.includes(exclude))) {
        continue;
    }
    
    const srcPath = path.join(rootNodeModules, dep);
    const destPath = path.join(tempDir, 'node_modules', dep);
    
    if (fs.statSync(srcPath).isDirectory()) {
        console.log(`Copying ${dep}...`);
        execSync(`cp -r "${srcPath}" "${path.dirname(destPath)}"`);
    }
}

// Create zip file
const zipFile = `${handlerFile}.zip`;
execSync(`cd ${tempDir} && zip -r ../${zipFile} .`);

// Clean up
execSync(`rm -rf ${tempDir}`);

console.log(`Created: ${zipFile}`);
