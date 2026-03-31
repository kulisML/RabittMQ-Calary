/**
 * WebSocket terminal proxy (ТЗ §8.3).
 * /ws/terminal/{student_id}/{lab_id} → ttyd inside container (port 7681).
 * 
 * ttyd WebSocket protocol:
 * - Client→Server: prefix byte '0' + input data
 * - Server→Client: prefix byte '0' + output data
 * - Client→Server: prefix byte '1' + JSON resize {columns, rows}
 * 
 * Flow (ТЗ §3.3):
 * 1. Browser connects to /ws/terminal/:studentId/:labId?ticket=xxx
 * 2. Gateway validates ticket via Redis
 * 3. Opens WS connection to ttyd inside the Docker container
 * 4. Proxies data with ttyd protocol handling
 * 5. On disconnect → publishes container.stop to RabbitMQ (ТЗ §3.5)
 */
const WebSocket = require('ws');
const { validateTicket, getContainerInfo, incrementRunStats } = require('./auth');
const { publishContainerStop } = require('./rabbitmq');

function setupTerminalProxy(server) {
    const wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const match = url.pathname.match(/^\/ws\/terminal\/(\d+)\/(\d+)$/);

        if (!match) return; // Not a terminal request — skip

        const roomId = parseInt(match[1]);
        const labId = parseInt(match[2]);
        const ticket = url.searchParams.get('ticket');

        wss.handleUpgrade(req, socket, head, (ws) => {
            handleTerminalConnection(ws, roomId, labId, ticket);
        });
    });

    return wss;
}

// Map to store shared ttyd upstream connections per room
const roomUpstreams = new Map();


async function waitForContainer(roomId, labId, maxWait = 15000, interval = 1000) {
    /** Poll Redis until container is running or timeout */
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        const container = await getContainerInfo(roomId, labId);
        if (container && container.status === 'running' && container.port) {
            return container;
        }
        await new Promise(r => setTimeout(r, interval));
    }
    return null;
}

async function handleTerminalConnection(ws, roomId, labId, ticket) {
    // 1. Validate ticket
    const auth = await validateTicket(ticket);
    if (!auth || auth.roomId !== roomId || auth.labId !== labId) {
        ws.close(4001, 'Invalid or expired ticket');
        return;
    }

    // 2. Wait for container to be running 
    console.log(`[Terminal] Waiting for container: room=${roomId} lab=${labId}`);
    const container = await waitForContainer(roomId, labId);
    if (!container) {
        ws.close(4002, 'Container not running (timeout)');
        return;
    }

    const roomKey = `${roomId}:${labId}`;
    let upstreamInfo = roomUpstreams.get(roomKey);

    if (!upstreamInfo) {
        // Connect to ttyd inside the container
        const ttydUrl = `ws://host.docker.internal:${container.port}/ws`;
        let upstream;

        try {
            upstream = new WebSocket(ttydUrl, ['tty']);
        } catch (err) {
            console.error(`[Terminal] Failed to connect to ttyd at ${ttydUrl}:`, err.message);
            ws.close(4003, 'Cannot connect to container terminal');
            return;
        }

        upstreamInfo = {
            upstream,
            clients: new Set(),
            ready: false,
        };
        roomUpstreams.set(roomKey, upstreamInfo);

        // Wait for upstream to actually open
        try {
            await new Promise((resolve, reject) => {
                upstream.on('open', () => {
                    console.log(`[Terminal] Connected to ttyd: room=${roomId} lab=${labId} port=${container.port}`);
                    upstream.send(JSON.stringify({ AuthToken: "" }));
                    upstream.send('1' + JSON.stringify({ columns: 120, rows: 30 }));
                    upstreamInfo.ready = true;
                    resolve();
                });
                upstream.on('error', reject);
                setTimeout(() => reject(new Error('ttyd connection timeout')), 5000);
            });
        } catch (err) {
            console.error(`[Terminal] ttyd connection failed:`, err.message);
            roomUpstreams.delete(roomKey);
            ws.close(4003, 'Cannot connect to container terminal');
            return;
        }

        // Handle ttyd messages -> broadcast to all clients
        upstream.on('message', (data) => {
            // data is usually a Buffer from 'ws'
            if (data.length > 0 && data[0] === 0x30) { // ASCII '0' is 48 (0x30)
                const payload = data.subarray(1);
                for (const client of upstreamInfo.clients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(payload);
                    }
                }
            }
        });

        upstream.on('close', () => {
            console.log(`[Terminal] Upstream closed: room=${roomId} lab=${labId}`);
            for (const client of upstreamInfo.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.close(4004, 'Container terminal closed');
                }
            }
            roomUpstreams.delete(roomKey);
        });

        upstream.on('error', (err) => {
            console.error(`[Terminal] Upstream error: ${err.message}`);
            roomUpstreams.delete(roomKey);
        });
    }

    // Add this WS client to the room
    upstreamInfo.clients.add(ws);

    // Browser sends raw text/binary → prepend ttyd input prefix '0' (0x30) → forward to ttyd
    ws.on('message', (data) => {
        if (upstreamInfo && upstreamInfo.ready && upstreamInfo.upstream.readyState === WebSocket.OPEN) {
            // Buffer.concat ([prefix '0', original data])
            const prefix = Buffer.from([0x30]);
            const msg = Buffer.concat([prefix, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
            upstreamInfo.upstream.send(msg);
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        console.log(`[Terminal] Browser disconnected: room=${roomId} lab=${labId}`);
        if (upstreamInfo) {
            upstreamInfo.clients.delete(ws);
            // Optional: close upstream if no clients left
        }
    });

    ws.on('error', (err) => {
        console.error(`[Terminal] Client error: ${err.message}`);
    });
}

module.exports = { setupTerminalProxy };
