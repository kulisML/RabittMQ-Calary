/**
 * EduLab Container Gateway — main entry point (ТЗ §2.1).
 *
 * WebSocket proxy between browser and Docker containers:
 * - /ws/terminal/:studentId/:labId — live terminal (ttyd) (ТЗ §8.3)
 * - /ws/editor/:studentId/:labId — code file sync   (ТЗ §8.3)
 * - /ws/observe/:studentId/:labId — read-only view   (Этап 2)
 *
 * Publishes events to RabbitMQ:
 * - container.stop on WebSocket disconnect (ТЗ §3.5)
 * - container.events for Observer Service  (Этап 2)
 */
const http = require('http');
const express = require('express');
const { connect: connectRabbitMQ } = require('./rabbitmq');
const { setupTerminalProxy } = require('./ws-terminal');
const { setupEditorProxy } = require('./ws-editor');
const { setupObserveProxy } = require('./ws-observe');

const PORT = process.env.GATEWAY_PORT || 3001;

const app = express();

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'edulab-gateway' });
});

const server = http.createServer(app);

// Setup WebSocket proxies
setupTerminalProxy(server);
setupEditorProxy(server);
setupObserveProxy(server);  // Этап 2 — read-only

// Connect to RabbitMQ and start server
async function start() {
    await connectRabbitMQ();

    server.listen(PORT, () => {
        console.log(`[Gateway] EduLab Container Gateway running on port ${PORT}`);
        console.log(`[Gateway] WebSocket endpoints:`);
        console.log(`  /ws/terminal/:studentId/:labId`);
        console.log(`  /ws/editor/:studentId/:labId`);
        console.log(`  /ws/observe/:studentId/:labId  (read-only)`);
    });
}

start().catch((err) => {
    console.error('[Gateway] Failed to start:', err);
    process.exit(1);
});

