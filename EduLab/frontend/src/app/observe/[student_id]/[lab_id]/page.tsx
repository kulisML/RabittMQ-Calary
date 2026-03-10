'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { isAuthenticated } from '@/lib/api';
import dynamic from 'next/dynamic';

export default function ObservePage() {
    const router = useRouter();
    const params = useParams();
    const studentId = Number(params.student_id);
    const labId = Number(params.lab_id);

    const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
    const terminalRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const xtermRef = useRef<any>(null);
    const terminalBufferRef = useRef<Uint8Array[]>([]);

    useEffect(() => {
        if (!isAuthenticated()) {
            router.replace('/login');
            return;
        }

        const token = localStorage.getItem('edulab_token');
        const defaultWsUrl = typeof window !== 'undefined' ? `ws://${window.location.hostname}:3001` : 'ws://localhost:3001';
        const baseUrl = process.env.NEXT_PUBLIC_WS_URL || defaultWsUrl;
        const wsUrl = `${baseUrl}/ws/observe/${studentId}/${labId}?token=${token}`;

        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => setStatus('connected');
        ws.onclose = () => setStatus('closed');
        ws.onerror = () => setStatus('error');

        ws.onmessage = (event) => {
            const data = event.data;
            if (xtermRef.current) {
                xtermRef.current.write(typeof data === 'string' ? data : new Uint8Array(data));
            } else {
                if (data instanceof ArrayBuffer) {
                    terminalBufferRef.current.push(new Uint8Array(data));
                } else {
                    terminalBufferRef.current.push(new TextEncoder().encode(data));
                }
            }
        };

        wsRef.current = ws;

        return () => {
            ws.close();
        };
    }, [studentId, labId, router]);

    useEffect(() => {
        if (status !== 'connected' || !terminalRef.current) return;

        let term: any = null;
        let resizeListener: () => void;

        async function setupTerminal() {
            const { Terminal } = await import('@xterm/xterm');
            const { FitAddon } = await import('@xterm/addon-fit');
            await import('@xterm/xterm/css/xterm.css');

            // If component unmounted while importing, abort
            if (!terminalRef.current) return;

            term = new Terminal({
                theme: {
                    background: '#0a0e17',
                    foreground: '#e2e8f0',
                    cursor: '#3b82f6',
                    selectionBackground: '#3b82f640',
                },
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 14,
                cursorBlink: false,
                disableStdin: true,
            });

            const fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
            term.open(terminalRef.current);
            fitAddon.fit();

            xtermRef.current = term;

            for (const chunk of terminalBufferRef.current) {
                term.write(chunk);
            }
            terminalBufferRef.current = [];

            resizeListener = () => fitAddon.fit();
            window.addEventListener('resize', resizeListener);
        }

        setupTerminal();

        return () => {
            if (term) {
                term.dispose();
            }
            if (resizeListener) {
                window.removeEventListener('resize', resizeListener);
            }
            xtermRef.current = null;
        };
    }, [status]);

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#0a0e17' }}>
            <div style={{ padding: '12px 20px', backgroundColor: '#111', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#fff', fontWeight: 500, fontFamily: 'monospace' }}>
                    👁 Наблюдение за терминалом (Студент #{studentId}, Лаба #{labId})
                </span>
                <span style={{
                    color: status === 'connected' ? '#10b981' : (status === 'connecting' ? '#fbbf24' : '#ef4444'),
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: status === 'connected' ? '#10b981' : (status === 'connecting' ? '#fbbf24' : '#ef4444') }} />
                    {status === 'connected' ? 'Подключено' : (status === 'connecting' ? 'Подключение...' : (status === 'error' ? 'Ошибка' : 'Отключено'))}
                </span>
            </div>
            <div ref={terminalRef} style={{ flex: 1, padding: 16 }} />
        </div>
    );
}
