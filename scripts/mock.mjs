#!/usr/bin/env node

import { spawn } from 'child_process';
import { createServer } from 'http';
import dgram from 'dgram';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const lockFile = path.join(rootDir, '.mock-lock.json');

const command = process.argv[2];

if (command === 'start') {
    start();
} else if (command === 'stop') {
    stop();
} else {
    console.error('Usage: mock.mjs <start|stop>');
    process.exit(1);
}

// ==================== START ====================

async function start() {
    // Check if already running
    if (fs.existsSync(lockFile)) {
        const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (isProcessRunning(lock.mockZ2mPid) && isProcessRunning(lock.vitePid)) {
            const localIp = await getLocalIp();
            console.log(`http://${localIp}:${lock.vitePort}/?host=${localIp}:${lock.mockZ2mPort}&username=admin`);
            process.exit(0);
        }
        // Stale lock file, remove it
        fs.unlinkSync(lockFile);
    }

    try {
        const mockZ2mPort = await findAvailablePort();
        const vitePort = await findAvailablePort();
        const localIp = await getLocalIp();

        // Build extension first
        await runCommand('npm', ['run', 'build:extension']);

        // Start mock-z2m in background
        const mockZ2m = spawn('node', ['--experimental-strip-types', 'src/mock-z2m.ts'], {
            env: { ...process.env, MOCK_Z2M_PORT: mockZ2mPort.toString(), MOCK_Z2M_INSECURE: 'true' },
            stdio: 'ignore',
            detached: true,
            cwd: rootDir
        });
        mockZ2m.unref();

        // Start Vite dev server in background
        const vite = spawn('npm', ['run', 'dev', '--', '--port', vitePort.toString()], {
            stdio: 'ignore',
            detached: true,
            cwd: rootDir
        });
        vite.unref();

        // Save lock file
        fs.writeFileSync(lockFile, JSON.stringify({
            mockZ2mPid: mockZ2m.pid,
            vitePid: vite.pid,
            mockZ2mPort,
            vitePort,
            startedAt: Date.now()
        }, null, 2));

        // Wait for servers to start
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log(`http://${localIp}:${vitePort}/?host=${localIp}:${mockZ2mPort}&username=admin`);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// ==================== STOP ====================

function stop() {
    if (!fs.existsSync(lockFile)) {
        console.log('No mock servers running (no lock file found)');
        process.exit(0);
    }

    try {
        const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        console.log('Stopping mock servers...');
        
        if (lock.mockZ2mPid) killProcessTree(lock.mockZ2mPid);
        if (lock.vitePid) killProcessTree(lock.vitePid);
        
        fs.unlinkSync(lockFile);
        console.log('Mock servers stopped');
    } catch (error) {
        console.error('Error stopping mock servers:', error.message);
        try { fs.unlinkSync(lockFile); } catch (e) { /* ignore */ }
        process.exit(1);
    }
}

// ==================== HELPERS ====================

function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

function killProcessTree(pid) {
    try {
        process.kill(-pid, 'SIGTERM');
    } catch (e) {
        try { process.kill(pid, 'SIGTERM'); } catch (e2) { /* already dead */ }
    }
}

function findAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.listen(0, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

function getLocalIp() {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.on('error', () => {
            socket.close();
            resolve('localhost');
        });
        socket.connect(80, '8.8.8.8', () => {
            const address = socket.address().address;
            socket.close();
            resolve(address);
        });
    });
}

function runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: 'pipe', cwd: rootDir });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
        });
    });
}
