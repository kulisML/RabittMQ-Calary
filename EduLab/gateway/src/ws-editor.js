/**
 * WebSocket editor proxy — file sync (ТЗ §8.3, §3.3).
 * /ws/editor/{student_id}/{lab_id} → sync code to container /workspace.
 */
const WebSocket = require('ws');
const { setupWSConnection, docs } = require('./y-utils');
const { validateTicket } = require('./auth');
const { exec } = require('child_process');

// Debounce writes: accumulate changes and write once per 500ms
const pendingWrites = new Map();

function writeFileToContainer(containerName, filename, content) {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
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

function setupEditorProxy(server) {
    const wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const match = url.pathname.match(/^\/ws\/editor\/(\d+)\/(\d+)$/);

        if (!match) return;

        const roomId = parseInt(match[1]);
        const labId = parseInt(match[2]);
        const ticket = url.searchParams.get('ticket');

        wss.handleUpgrade(req, socket, head, async (ws) => {
            // Validate ticket
            const auth = await validateTicket(ticket);
            if (!auth || auth.roomId !== roomId || auth.labId !== labId) {
                ws.close(4001, 'Invalid or expired ticket');
                return;
            }

            const docName = `room-${roomId}-lab-${labId}`;
            req.url = `/${docName}`;

            // Handle Yjs Connection sync
            setupWSConnection(ws, req, {
                docName: docName,
                gc: true,
            });

            console.log(`[Editor/CRDT] Connected to doc: ${docName}`);

            const wsDoc = docs.get(docName);
            if (wsDoc && !wsDoc.edulabSaveHook) {
                wsDoc.edulabSaveHook = true;
                
                const ytext = wsDoc.getText('monaco');
                const containerName = `edulab-room-${roomId}-${labId}`;
                
                if (ytext.toString() === '') {
                    readFileFromContainer(containerName, 'main.py', (content) => {
                        if (content && ytext.toString() === '') {
                            ytext.insert(0, content);
                        }
                    });
                }
                
                wsDoc.on('update', () => {
                    const filename = 'main.py';
                    const key = `${containerName}:${filename}`;

                    if (pendingWrites.has(key)) {
                        clearTimeout(pendingWrites.get(key));
                    }

                    pendingWrites.set(key, setTimeout(() => {
                        const content = ytext.toString();
                        writeFileToContainer(containerName, filename, content);
                        pendingWrites.delete(key);
                    }, 500));
                });
            }
        });
    });

    return wss;
}

module.exports = { setupEditorProxy };
