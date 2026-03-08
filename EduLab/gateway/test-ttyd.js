const WebSocket = require('ws');

// Connect directly to the port we saw in the logs (63780)
const ws = new WebSocket('ws://host.docker.internal:63780/ws');

ws.on('open', () => {
    console.log('Connected directly to ttyd!');

    // Send AuthToken
    ws.send(JSON.stringify({ AuthToken: "" }));

    // Send window size
    ws.send('1' + JSON.stringify({ columns: 80, rows: 24 }));

    // Send a command after 1s
    setTimeout(() => {
        console.log('Sending ls command');
        ws.send('0ls\n');
    }, 1000);
});

ws.on('message', (data) => {
    console.log('Received from ttyd:', data.toString());
});

ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
});

ws.on('close', (code, reason) => {
    console.log(`WebSocket Closed: ${code} ${reason}`);
});

// Force exit after 3 seconds
setTimeout(() => {
    console.log('Test timeout');
    process.exit(0);
}, 3000);
