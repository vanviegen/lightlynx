#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const lockFile = path.join(rootDir, '.mock-lock.json');

// Kill process and all its children
function killProcessTree(pid) {
    try {
        // Try to kill the process group (negative PID)
        process.kill(-pid, 'SIGTERM');
    } catch (e) {
        // If that fails, try killing just the process
        try {
            process.kill(pid, 'SIGTERM');
        } catch (e2) {
            // Process might already be dead
        }
    }
}

function main() {
    if (!fs.existsSync(lockFile)) {
        console.log('No mock servers running (no lock file found)');
        process.exit(0);
    }

    try {
        const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        
        console.log('Stopping mock servers...');
        
        // Kill both processes
        if (lock.mockZ2mPid) {
            killProcessTree(lock.mockZ2mPid);
        }
        if (lock.vitePid) {
            killProcessTree(lock.vitePid);
        }
        
        // Remove lock file
        fs.unlinkSync(lockFile);
        
        console.log('Mock servers stopped');
    } catch (error) {
        console.error('Error stopping mock servers:', error.message);
        // Try to remove the lock file anyway
        try {
            fs.unlinkSync(lockFile);
        } catch (e) {
            // Ignore
        }
        process.exit(1);
    }
}

main();
