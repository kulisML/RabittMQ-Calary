/**
 * WebSocket editor proxy — file sync (ТЗ §8.3, §3.3).
 * /ws/editor/{student_id}/{lab_id} → sync code to container /workspace.
 *
 * Flow:
 * 1. Browser sends code changes via WebSocket (debounced client-side 300ms)
 * 2. Gateway writes changes to /workspace inside the Docker container
 * 3. Uses `docker exec` to write files
 */
const WebSocket = require('ws');
const { exec } = require('child_process');
const { validateTicket, getContainerInfo } = require('./auth');

// Debounce writes: accumulate changes and write once per 300ms
const pendingWrites = new Map();

function setupEditorProxy(server) {
    const wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const match = url.pathname.match(/^\/ws\/editor\/(\d+)\/(\d+)$/);

        if (!match) return;

        const studentId = parseInt(match[1]);
        const labId = parseInt(match[2]);
        const ticket = url.searchParams.get('ticket');

        wss.handleUpgrade(req, socket, head, (ws) => {
            handleEditorConnection(ws, studentId, labId, ticket);
        });
    });

    return wss;
}

async function handleEditorConnection(ws, studentId, labId, ticket) {
    // Validate ticket
    const auth = await validateTicket(ticket);
    if (!auth || auth.studentId !== studentId || auth.labId !== labId) {
        ws.close(4001, 'Invalid or expired ticket');
        return;
    }

    // Poll Redis until container is running (max 15s)
    let container = null;
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
        container = await getContainerInfo(studentId, labId);
        if (container && container.status === 'running') break;
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!container || container.status !== 'running') {
        ws.close(4002, 'Container not running (timeout)');
        return;
    }

    const containerName = `edulab-${studentId}-${labId}`;
    console.log(`[Editor] Connected: student=${studentId} lab=${labId}`);

    // Send current file content to browser on connect
    readFileFromContainer(containerName, 'main.py', (content) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'file_content', filename: 'main.py', content }));
        }
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            if (msg.type === 'file_change') {
                // Debounced write to container
                const key = `${containerName}:${msg.filename}`;

                if (pendingWrites.has(key)) {
                    clearTimeout(pendingWrites.get(key).timer);
                }

                pendingWrites.set(key, {
                    timer: setTimeout(() => {
                        writeFileToContainer(containerName, msg.filename, msg.content);
                        pendingWrites.delete(key);
                    }, 300), // 300ms debounce
                });
            }

            if (msg.type === 'read_file') {
                readFileFromContainer(containerName, msg.filename, (content) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'file_content', filename: msg.filename, content }));
                    }
                });
            }
        } catch (err) {
            console.error('[Editor] Parse error:', err.message);
        }
    });

    ws.on('close', () => {
        console.log(`[Editor] Disconnected: student=${studentId} lab=${labId}`);
        // Clean up pending writes
        for (const [key, val] of pendingWrites) {
            if (key.startsWith(containerName)) {
                clearTimeout(val.timer);
                pendingWrites.delete(key);
            }
        }
    });

    ws.on('error', (err) => {
        console.error(`[Editor] Error: ${err.message}`);
    });
}

function writeFileToContainer(containerName, filename, content) {
    // Use docker exec to write file to /workspace
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const escapedContent = content.replace(/'/g, "'\\''");
    const cmd = `docker exec ${containerName} sh -c 'echo '"'"'${escapedContent}'"'"' > /workspace/${safeFilename}'`;

    // Use base64 for safer encoding
    const b64 = Buffer.from(content).toString('base64');
    const execCmd = `docker exec ${containerName} sh -c "echo '${b64}' | base64 -d > /workspace/${safeFilename}"`;

    exec(execCmd, (err) => {
        if (err) {
            console.error(`[Editor] Write failed: ${err.message}`);
        }
    });
}

function readFileFromContainer(containerName, filename, callback) {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const cmd = `docker exec ${containerName} cat /workspace/${safeFilename}`;

    exec(cmd, (err, stdout) => {
        if (err) {
            callback('');
        } else {
            callback(stdout);
        }
    });
}

module.exports = { setupEditorProxy };
