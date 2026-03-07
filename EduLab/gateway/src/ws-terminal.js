/**
 * WebSocket terminal proxy (ТЗ §8.3).
 * /ws/terminal/{student_id}/{lab_id} → ttyd inside container (port 7681).
 * 
 * Flow (ТЗ §3.3):
 * 1. Browser connects to /ws/terminal/:studentId/:labId?ticket=xxx
 * 2. Gateway validates ticket via Redis
 * 3. Opens WS connection to ttyd inside the Docker container
 * 4. Proxies data bidirectionally (browser ↔ container terminal)
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

        const studentId = parseInt(match[1]);
        const labId = parseInt(match[2]);
        const ticket = url.searchParams.get('ticket');

        wss.handleUpgrade(req, socket, head, (ws) => {
            handleTerminalConnection(ws, studentId, labId, ticket);
        });
    });

    return wss;
}

async function handleTerminalConnection(ws, studentId, labId, ticket) {
    // 1. Validate ticket
    const auth = await validateTicket(ticket);
    if (!auth || auth.studentId !== studentId || auth.labId !== labId) {
        ws.close(4001, 'Invalid or expired ticket');
        return;
    }

    // 2. Get container info from Redis
    const container = await getContainerInfo(studentId, labId);
    if (!container || container.status !== 'running') {
        ws.close(4002, 'Container not running');
        return;
    }

    // 3. Connect to ttyd inside the container
    const ttydUrl = `ws://host.docker.internal:${container.port}/ws`;
    let upstream;

    try {
        upstream = new WebSocket(ttydUrl);
    } catch (err) {
        console.error(`[Terminal] Failed to connect to ttyd at ${ttydUrl}:`, err.message);
        ws.close(4003, 'Cannot connect to container terminal');
        return;
    }

    upstream.on('open', () => {
        console.log(`[Terminal] Connected: student=${studentId} lab=${labId} port=${container.port}`);
    });

    // Proxy data: browser → container
    ws.on('message', (data) => {
        if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data);
        }
    });

    // Proxy data: container → browser
    upstream.on('message', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        }
    });

    // Track run stats
    upstream.on('message', () => {
        // Simple heuristic: track activity
        incrementRunStats(studentId, labId, false).catch(() => { });
    });

    // Handle disconnect (ТЗ §3.5)
    ws.on('close', () => {
        console.log(`[Terminal] Browser disconnected: student=${studentId} lab=${labId}`);
        if (upstream.readyState === WebSocket.OPEN) {
            upstream.close();
        }
        // Publish container.stop to RabbitMQ (ТЗ §3.5)
        publishContainerStop(studentId, labId, 'browser_closed');
    });

    upstream.on('close', () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(4004, 'Container terminal closed');
        }
    });

    upstream.on('error', (err) => {
        console.error(`[Terminal] Upstream error: ${err.message}`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(4003, 'Container terminal error');
        }
    });

    ws.on('error', (err) => {
        console.error(`[Terminal] Client error: ${err.message}`);
    });
}

module.exports = { setupTerminalProxy };
