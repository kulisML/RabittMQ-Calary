'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/api';

export default function Home() {
    const router = useRouter();

    useEffect(() => {
        if (isAuthenticated()) {
            router.replace('/labs');
        } else {
            router.replace('/login');
        }
    }, [router]);

    return (
        <div className="loading" style={{ minHeight: '100vh' }}>
            <div className="spinner" />
        </div>
    );
}
