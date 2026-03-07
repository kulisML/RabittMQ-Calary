/**
 * WebSocket client for editor and terminal connections (ТЗ §8.3).
 */

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

export function connectTerminal(
    studentId: number,
    labId: number,
    ticket: string,
    onData: (data: ArrayBuffer | string) => void,
    onClose: () => void,
): WebSocket {
    const url = `${WS_URL}/ws/terminal/${studentId}/${labId}?ticket=${ticket}`;
    const ws = new WebSocket(url);

    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event) => {
        onData(event.data);
    };

    ws.onclose = () => {
        onClose();
    };

    ws.onerror = (err) => {
        console.error('[WS Terminal] Error:', err);
    };

    return ws;
}

export function connectEditor(
    studentId: number,
    labId: number,
    ticket: string,
    onFileContent: (filename: string, content: string) => void,
    onClose: () => void,
): WebSocket {
    const url = `${WS_URL}/ws/editor/${studentId}/${labId}?ticket=${ticket}`;
    const ws = new WebSocket(url);

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'file_content') {
                onFileContent(msg.filename, msg.content);
            }
        } catch (e) {
            console.error('[WS Editor] Parse error:', e);
        }
    };

    ws.onclose = () => {
        onClose();
    };

    ws.onerror = (err) => {
        console.error('[WS Editor] Error:', err);
    };

    return ws;
}

export function sendFileChange(ws: WebSocket, filename: string, content: string) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'file_change',
            filename,
            content,
        }));
    }
}

export function sendTerminalInput(ws: WebSocket, data: string) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
    }
}
