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

// Find two random available ports
async function findAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.listen(0, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

// Get the local IP address (same logic as in extension.ts)
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

// Check if a process is running
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

async function main() {
    try {
        // Check if already running
        if (fs.existsSync(lockFile)) {
            const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
            const mockZ2mRunning = isProcessRunning(lock.mockZ2mPid);
            const viteRunning = isProcessRunning(lock.vitePid);
            
            if (mockZ2mRunning && viteRunning) {
                const localIp = await getLocalIp();
                console.log(`http://${localIp}:${lock.vitePort}/connect?host=${localIp}:${lock.mockZ2mPort}&username=admin`);
                process.exit(0);
            } else {
                // Stale lock file, remove it
                fs.unlinkSync(lockFile);
            }
        }

        const mockZ2mPort = await findAvailablePort();
        const vitePort = await findAvailablePort();
        const localIp = await getLocalIp();

        // Build extension first
        const buildExtension = spawn('npm', ['run', 'build:extension'], {
            stdio: 'pipe',
            cwd: rootDir
        });

        await new Promise((resolve, reject) => {
            buildExtension.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`build:extension failed with code ${code}`));
            });
        });

        // Start mock-z2m in background
        const mockZ2m = spawn('node', ['--experimental-strip-types', 'src/mock-z2m.ts'], {
            env: {
                ...process.env,
                MOCK_Z2M_PORT: mockZ2mPort.toString(),
                MOCK_Z2M_INSECURE: 'true'
            },
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
        const lock = {
            mockZ2mPid: mockZ2m.pid,
            vitePid: vite.pid,
            mockZ2mPort,
            vitePort,
            startedAt: Date.now()
        };
        fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));

        // Wait a bit for servers to start
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Print the connection URL
        console.log(`http://${localIp}:${vitePort}/connect?host=${localIp}:${mockZ2mPort}&username=admin`);

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();
