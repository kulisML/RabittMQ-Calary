"use client";

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';

// Achievement Data Structure
export interface AchievementData {
    id: string; // Unique generated ID for the toast
    title: string;
    xpReward: number;
    icon?: string;
    levelUp?: boolean;
}

interface GamificationContextType {
    triggerAchievement: (title: string, xp: number, icon?: string, levelUp?: boolean) => void;
}

const GamificationContext = createContext<GamificationContextType | undefined>(undefined);

// A simple glassmorphism CSS injected in-line via style tag
const popupStyles = `
@keyframes slideInRight {
    from { transform: translateX(120%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}
@keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(120%); opacity: 0; }
}
@keyframes pulseGlow {
    0% { box-shadow: 0 0 15px rgba(139, 92, 246, 0.5); }
    50% { box-shadow: 0 0 30px rgba(139, 92, 246, 0.8), 0 0 10px rgba(59, 130, 246, 0.6); }
    100% { box-shadow: 0 0 15px rgba(139, 92, 246, 0.5); }
}
.achievement-toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 9999;
}
.achievement-toast {
    display: flex;
    align-items: center;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(139, 92, 246, 0.4);
    border-radius: 12px;
    padding: 16px 24px;
    color: white;
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
    animation: slideInRight 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
.achievement-toast.closing {
    animation: slideOutRight 0.4s ease-in forwards;
}
.achievement-toast.level-up {
    background: linear-gradient(135deg, rgba(59,130,246,0.2) 0%, rgba(139,92,246,0.3) 100%);
    border: 1px solid rgba(139, 92, 246, 0.8);
    animation: slideInRight 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, pulseGlow 2s infinite ease-in-out;
}
`;

export const GamificationProvider = ({ children }: { children: ReactNode }) => {
    const [achievements, setAchievements] = useState<AchievementData[]>([]);

    const triggerAchievement = useCallback((title: string, xp: number, icon: string = '🏆', levelUp: boolean = false) => {
        // Play Sound Effect
        const audio = new Audio('https://actions.google.com/sounds/v1/ui/message_notification.ogg');
        audio.volume = 0.5;
        audio.play().catch(e => console.log('Audio play failed (maybe no interaction yet)', e));

        const newAchievement: AchievementData = {
            id: Math.random().toString(36).substring(7),
            title,
            xpReward: xp,
            icon,
            levelUp
        };

        setAchievements(prev => [...prev, newAchievement]);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            setAchievements(prev => prev.map(a => a.id === newAchievement.id ? { ...a, closing: true } : a) as any);
            setTimeout(() => {
                setAchievements(prev => prev.filter(a => a.id !== newAchievement.id));
            }, 400); // Wait for the slideOut CSS animation
        }, 5000);
    }, []);

    return (
        <GamificationContext.Provider value={{ triggerAchievement }}>
            {children}
            {/* Inject Global Styles */}
            <style dangerouslySetInnerHTML={{ __html: popupStyles }} />
            
            {/* Toasts Container */}
            <div className="achievement-toast-container">
                {achievements.map(ach => (
                    <div key={ach.id} className={`achievement-toast ${(ach as any).closing ? 'closing' : ''} ${ach.levelUp ? 'level-up' : ''}`}>
                        <div style={{ fontSize: '32px', marginRight: '16px', filter: ach.levelUp ? 'drop-shadow(0 0 8px rgba(255,215,0,0.8))' : 'none' }}>
                            {ach.icon}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>
                                {ach.levelUp ? 'УРОВЕНЬ ПОВЫШЕН!' : 'Достижение разблокировано'}
                            </span>
                            <span style={{ fontSize: '18px', fontWeight: 700, margin: '2px 0' }}>
                                {ach.title}
                            </span>
                            <span style={{ fontSize: '14px', color: '#10b981', fontWeight: 600 }}>
                                +{ach.xpReward} XP
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </GamificationContext.Provider>
    );
};

export const useGamification = () => {
    const context = useContext(GamificationContext);
    if (!context) {
        throw new Error('useGamification must be used within a GamificationProvider');
    }
    return context;
};
