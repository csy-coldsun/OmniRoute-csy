#!/usr/bin/env node

/**
 * OmniRoute Cross-Platform Build Script
 * 
 * Builds desktop applications for:
 * - Windows (.exe, .msi)
 * - macOS (.dmg, .app)
 * - Linux (.AppImage, .deb)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ora from 'ora';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const electronDir = path.join(rootDir, 'electron');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function runCommand(command, cwd = rootDir) {
  try {
    execSync(command, { cwd, stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`Command failed: ${command}`);
    return false;
  }
}

async function main() {
  log('\n🚀 OmniRoute Cross-Platform Builder\n', colors.cyan);
  log('═══════════════════════════════════════════════════\n', colors.cyan);

  // Step 1: Check Node.js version
  const spinner = ora('Checking Node.js version').start();
  const nodeVersion = process.version;
  if (!nodeVersion.match(/^v1[89]\.|^v2[0-3]\./)) {
    spinner.fail(`Node.js version must be >=18 and <24 (current: ${nodeVersion})`);
    process.exit(1);
  }
  spinner.succeed(`Node.js ${nodeVersion} OK`);

  // Step 2: Install dependencies
  log('\n📦 Installing dependencies...', colors.blue);
  if (!runCommand('npm install')) {
    log('❌ Failed to install dependencies', colors.red);
    process.exit(1);
  }

  // Step 3: Build Next.js app
  log('\n🏗️  Building Next.js application...', colors.blue);
  if (!runCommand('npm run build')) {
    log('❌ Failed to build Next.js app', colors.red);
    process.exit(1);
  }

  // Step 4: Prepare Electron bundle
  log('\n📦 Preparing Electron bundle...', colors.blue);
  if (!runCommand('npm run prepare:bundle', electronDir)) {
    log('❌ Failed to prepare Electron bundle', colors.red);
    process.exit(1);
  }

  // Step 5: Build for all platforms
  log('\n🎯 Building for all platforms...', colors.blue);
  log('═══════════════════════════════════════════════════\n', colors.cyan);

  const platforms = [
    { name: 'Windows', command: 'npm run build:win', icon: '🪟' },
    { name: 'macOS', command: 'npm run build:mac', icon: '🍎' },
    { name: 'Linux', command: 'npm run build:linux', icon: '🐧' },
  ];

  const results = [];

  for (const platform of platforms) {
    log(`\n${platform.icon} Building for ${platform.name}...`, colors.yellow);
    const startTime = Date.now();
    
    const success = runCommand(platform.command, electronDir);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (success) {
      log(`✅ ${platform.name} build completed in ${duration}s`, colors.green);
      results.push({ platform: platform.name, status: '✅ Success', time: `${duration}s` });
    } else {
      log(`❌ ${platform.name} build failed`, colors.red);
      results.push({ platform: platform.name, status: '❌ Failed', time: `${duration}s` });
    }
  }

  // Step 6: Summary
  log('\n\n═══════════════════════════════════════════════════', colors.cyan);
  log('📊 BUILD SUMMARY', colors.cyan);
  log('═══════════════════════════════════════════════════', colors.cyan);
  
  console.table(results);

  const outputDir = path.join(electronDir, 'dist-electron');
  if (fs.existsSync(outputDir)) {
    log(`\n📁 Output directory: ${outputDir}`, colors.blue);
    log('\nGenerated files:', colors.green);
    
    const files = fs.readdirSync(outputDir);
    files.forEach(file => {
      if (!file.startsWith('.')) {
        log(`  - ${file}`, colors.green);
      }
    });
  }

  log('\n✨ Build process completed!\n', colors.green);
  log('═══════════════════════════════════════════════════\n', colors.cyan);
}

main().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
