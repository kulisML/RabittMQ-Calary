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

        const studentId = parseInt(match[1]);
        const labId = parseInt(match[2]);
        const ticket = url.searchParams.get('ticket');

        wss.handleUpgrade(req, socket, head, (ws) => {
            handleTerminalConnection(ws, studentId, labId, ticket);
        });
    });

    return wss;
}

async function waitForContainer(studentId, labId, maxWait = 15000, interval = 1000) {
    /** Poll Redis until container is running or timeout */
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        const container = await getContainerInfo(studentId, labId);
        if (container && container.status === 'running' && container.port) {
            return container;
        }
        await new Promise(r => setTimeout(r, interval));
    }
    return null;
}

async function handleTerminalConnection(ws, studentId, labId, ticket) {
    // 1. Validate ticket
    const auth = await validateTicket(ticket);
    if (!auth || auth.studentId !== studentId || auth.labId !== labId) {
        ws.close(4001, 'Invalid or expired ticket');
        return;
    }

    // 2. Wait for container to be running (poll Redis)
    console.log(`[Terminal] Waiting for container: student=${studentId} lab=${labId}`);
    const container = await waitForContainer(studentId, labId);
    if (!container) {
        ws.close(4002, 'Container not running (timeout)');
        return;
    }

    // 3. Connect to ttyd inside the container
    const ttydUrl = `ws://host.docker.internal:${container.port}/ws`;
    let upstream;

    try {
        // libwebsockets (ttyd) REQUIRES the 'tty' subprotocol, otherwise it accepts but ignores the connection
        upstream = new WebSocket(ttydUrl, ['tty']);
    } catch (err) {
        console.error(`[Terminal] Failed to connect to ttyd at ${ttydUrl}:`, err.message);
        ws.close(4003, 'Cannot connect to container terminal');
        return;
    }

    // Wait for upstream to actually open
    await new Promise((resolve, reject) => {
        upstream.on('open', () => {
            console.log(`[Terminal] Connected to ttyd: student=${studentId} lab=${labId} port=${container.port}`);
            // ttyd protocol requires an initial AuthToken message to initialize the session
            upstream.send(JSON.stringify({ AuthToken: "" }));

            // ttyd ALSO requires a Window Size message ('1' + JSON) to allocate the PTY and start bash
            upstream.send('1' + JSON.stringify({ columns: 120, rows: 30 }));

            resolve();
        });
        upstream.on('error', (err) => {
            reject(err);
        });
        setTimeout(() => reject(new Error('ttyd connection timeout')), 5000);
    }).catch((err) => {
        console.error(`[Terminal] ttyd connection failed:`, err.message);
        ws.close(4003, 'Cannot connect to container terminal');
        return;
    });

    if (upstream.readyState !== WebSocket.OPEN) return;

    // 4. Proxy data with ttyd protocol handling

    // Browser sends raw text → prepend ttyd input prefix '0' → forward to ttyd
    ws.on('message', (data) => {
        if (upstream.readyState === WebSocket.OPEN) {
            // Convert data to string (utf8) and prepend '0'
            const textData = data.toString('utf8');
            console.log(`[Terminal DEBUG] Browser -> ttyd: ${textData.substring(0, 100).replace(/\n/g, '\\n')}`);
            upstream.send('0' + textData);
        }
    });

    // ttyd sends prefixed messages → strip prefix → forward to browser
    upstream.on('message', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            // ttyd sends text frames like "0\x1b[32mhello..."
            const str = data.toString('utf8');
            console.log(`[Terminal DEBUG] ttyd -> Browser: length=${str.length}, prefix='${str[0]}', preview='${str.substring(1, 50).replace(/\n/g, '\\n')}'`);
            if (str.length > 0) {
                const msgType = str[0];
                if (msgType === '0') {
                    // Output data — send actual content to browser
                    ws.send(str.slice(1));
                }
                // Ignore other ttyd message types (title, prefs)
            }
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        console.log(`[Terminal] Browser disconnected: student=${studentId} lab=${labId}`);
        if (upstream.readyState === WebSocket.OPEN) {
            upstream.close();
        }
        // NOTE: Do NOT stop the container on terminal disconnect.
        // The container stays alive until:
        // 1) Session timeout (TTL in Redis)
        // 2) Student explicitly closes the lab
        // 3) Teacher stops it from dashboard
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
