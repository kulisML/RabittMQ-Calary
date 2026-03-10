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
        console.error(`[Observe] Rejecting teacher: student=${studentId} lab=${labId} - container not running or missing in Redis.`);
        ws.close(4002, 'Container not running');
        return;
    }

    // Connect to ttyd in read-only mode using internal network
    const ttydUrl = `ws://host.docker.internal:${container.port}/ws`;
    let upstream;

    try {
        upstream = new WebSocket(ttydUrl, ['tty']);
    } catch (err) {
        console.error(`[Observe] Failed to connect to ttyd:`, err.message);
        ws.close(4003, 'Cannot connect to container');
        return;
    }

    // Attach client-side event listeners FIRST to catch early disconnects
    let isClientClosed = false;

    ws.on('close', () => {
        console.log(`[Observe] Teacher disconnected: student=${studentId} lab=${labId}`);
        isClientClosed = true;
        if (upstream && upstream.readyState === WebSocket.OPEN) {
            upstream.close();
        }
    });

    ws.on('error', (err) => {
        console.error(`[Observe] Client error: ${err.message}`);
    });

    // Wait for upstream to actually open
    await new Promise((resolve, reject) => {
        upstream.on('open', () => {
            if (isClientClosed) {
                // The client disconnected while we were connecting to ttyd
                console.log(`[Observe] Teacher disconnected early. Closing ttyd: student=${studentId} lab=${labId}`);
                upstream.close();
                resolve();
                return;
            }

            console.log(`[Observe] Teacher connected: student=${studentId} lab=${labId}`);
            // Send initial empty AuthToken so ttyd starts sending data
            upstream.send(JSON.stringify({ AuthToken: '' }));

            // Send Window Size message to allocate the PTY and start bash
            upstream.send('1' + JSON.stringify({ columns: 120, rows: 30 }));
            resolve();
        });
        upstream.on('error', (err) => {
            reject(err);
        });
        setTimeout(() => reject(new Error('ttyd connection timeout')), 5000);
    }).catch((err) => {
        if (!isClientClosed) {
            console.error(`[Observe] ttyd connection failed:`, err.message);
            ws.close(4003, 'Cannot connect to container terminal');
        }
    });

    if (isClientClosed || upstream.readyState !== WebSocket.OPEN) return;

    // READ ONLY: container output → teacher browser
    upstream.on('message', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            // ws library returns Buffer by default. Convert to string
            const str = data.toString('utf8');
            console.log(`[Observe DEBUG] ttyd -> Browser: length=${str.length}, prefix='${str[0]}', preview='${str.substring(1, 50).replace(/\n/g, '\\n')}'`);
            if (str.length > 0 && str[0] === '0') {
                const payload = str.slice(1);
                console.log(`[Observe DEBUG] Sending to teacher: length=${payload.length}`);

                // IMPORTANT: In gateway/ws-terminal.js, we also just send strings.
                // Wait, ttyd uses text frames, but let's see what ws.send does
                ws.send(payload); // Send actual content to browser
            }
        }
    });

    // BLOCK: teacher input is NOT forwarded to container
    ws.on('message', () => {
        // Intentionally empty — read-only mode
    });

    upstream.on('close', () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(4004, 'Container terminal closed');
        }
    });

    upstream.on('error', (err) => {
        console.error(`[Observe] Upstream error: ${err.message}`);
    });
}

module.exports = { setupObserveProxy };
