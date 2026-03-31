/**
 * API client — HTTP requests to EduLab backend with JWT auth.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('edulab_token');
}

export function setToken(token: string) {
    localStorage.setItem('edulab_token', token);
}

export function clearToken() {
    localStorage.removeItem('edulab_token');
}

export function isAuthenticated(): boolean {
    return !!getToken();
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
    const token = getToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
    });

    if (res.status === 401) {
        clearToken();
        if (typeof window !== 'undefined') {
            window.location.href = '/login';
        }
        throw new Error('Unauthorized');
    }

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
    }

    return res.json();
}

// === Auth API (ТЗ §8.1) ===

export async function login(email: string, password: string) {
    const data = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    setToken(data.access_token);
    pingNow();
    return data;
}

export async function logout() {
    try {
        await request('/auth/logout', { method: 'POST' });
    } finally {
        clearToken();
    }
}

export async function getMe() {
    return request('/auth/me');
}

// === Labs API (ТЗ §8.2) ===

export async function getLabs() {
    return request('/labs');
}

export async function getLab(labId: number) {
    return request(`/labs/${labId}`);
}

export async function getLabRooms(labId: number) {
    return request(`/rooms/lab/${labId}`);
}

export async function createRoom(labId: number, name: string) {
    return request('/rooms', {
        method: 'POST',
        body: JSON.stringify({ lab_id: labId, name }),
    });
}

export async function openRoom(roomId: number) {
    return request(`/rooms/${roomId}/open`, { method: 'POST' });
}

export async function pingRoom(roomId: number) {
    return request(`/rooms/${roomId}/ping`, { method: 'POST' });
}

export function stopRoomBeacon(roomId: number) {
    if (typeof window === 'undefined') return;
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${API_URL}/rooms/${roomId}/stop`, {
        method: 'POST',
        keepalive: true,
        headers,
    }).catch(console.error);
}

// === AI API ===
export async function triggerAIAnalysis(roomId: number, labId: number, code: string) {
    return request('/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ room_id: roomId, lab_id: labId, code }),
    });
}

export async function getAIPlaques(roomId: number, labId: number) {
    return request(`/ai/plaques/${roomId}/${labId}`);
}

// === Gamification API ===
export async function getGamerProfile() {
    return request('/gamification/me');
}

export async function grantAchievement(userId: number, achievementSlug: string) {
    return request(`/gamification/internal/grant?user_id=${userId}&achievement_slug=${achievementSlug}`, {
        method: 'POST',
    });
}




export async function createLab(data: {
    title: string;
    description: string;
    language?: string;
    template_code?: string;
    tests_json?: string;
}) {
    return request('/labs', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

// === Dashboard API (ТЗ §8.4, Этап 2) ===

export async function getTeacherGroups() {
    return request('/dashboard/groups');
}

export async function getGroupStudents(groupId: number) {
    return request(`/dashboard/groups/${groupId}`);
}

export async function getAllContainers() {
    return request('/dashboard/containers');
}

export async function getStudentStats(studentId: number) {
    return request(`/dashboard/student/${studentId}/stats`);
}
// === Online Status Keep-Alive ===
let pingInterval: ReturnType<typeof setInterval> | null = null;

export function pingNow() {
    if (typeof window !== 'undefined' && isAuthenticated()) {
        request('/auth/ping', { method: 'POST' }).catch((err) => {
            console.debug('[Online] Ping failed', err);
        });
    }
}

if (typeof window !== 'undefined') {
    // Initial ping
    setTimeout(pingNow, 1000); // 1s delay to let everything hydrate
    // Setup interval
    if (!pingInterval) {
        pingInterval = setInterval(pingNow, 60000); // every 60 seconds
    }
}
