/**
 * WebSocket observe proxy — read-only view for teachers (ТЗ §8.3, Этап 2).
 * /ws/observe/{student_id}/{lab_id} → read-only terminal + code stream.
 * 
 * Teachers can watch a student's terminal and code in real time,
 * but cannot send any input.
 */
const WebSocket = require('ws');
const { getContainerInfo } = require('./auth');

function setupObserveProxy(server) {
    const wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const match = url.pathname.match(/^\/ws\/observe\/(\d+)\/(\d+)$/);

        if (!match) return;

        const studentId = parseInt(match[1]);
        const labId = parseInt(match[2]);
        // For observe, we use JWT token from query (no ticket needed — teacher auth)
        const token = url.searchParams.get('token');

        wss.handleUpgrade(req, socket, head, (ws) => {
            handleObserveConnection(ws, studentId, labId, token);
        });
    });

    return wss;
}

async function handleObserveConnection(ws, studentId, labId, token) {
    // TODO: validate JWT token and check teacher role
    // For now, we allow connection if container is running

    const container = await getContainerInfo(studentId, labId);
    if (!container || container.status !== 'running') {
        ws.close(4002, 'Container not running');
        return;
    }

    // Connect to ttyd in read-only mode
    const ttydUrl = `ws://host.docker.internal:${container.port}/ws`;
    let upstream;

    try {
        upstream = new WebSocket(ttydUrl);
    } catch (err) {
        console.error(`[Observe] Failed to connect to ttyd:`, err.message);
        ws.close(4003, 'Cannot connect to container');
        return;
    }

    upstream.on('open', () => {
        console.log(`[Observe] Teacher connected: student=${studentId} lab=${labId}`);
    });

    // READ ONLY: container output → teacher browser
    upstream.on('message', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        }
    });

    // BLOCK: teacher input is NOT forwarded to container
    ws.on('message', () => {
        // Intentionally empty — read-only mode
    });

    ws.on('close', () => {
        console.log(`[Observe] Teacher disconnected: student=${studentId} lab=${labId}`);
        if (upstream.readyState === WebSocket.OPEN) {
            upstream.close();
        }
        // Do NOT publish container.stop — teacher closing doesn't stop container
    });

    upstream.on('close', () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(4004, 'Container terminal closed');
        }
    });

    upstream.on('error', (err) => {
        console.error(`[Observe] Upstream error: ${err.message}`);
    });

    ws.on('error', (err) => {
        console.error(`[Observe] Client error: ${err.message}`);
    });
}

module.exports = { setupObserveProxy };
