'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getGamerProfile, isAuthenticated } from '@/lib/api';
import * as d3 from 'd3';

export default function GamerDashboard() {
    const router = useRouter();
    const [profile, setProfile] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (!isAuthenticated()) {
            router.replace('/login');
            return;
        }

        async function loadProfile() {
            try {
                const data = await getGamerProfile();
                setProfile(data);
                setLoading(false);
            } catch (err) {
                console.error("Failed to load gamer profile", err);
                setLoading(false);
            }
        }
        loadProfile();
    }, [router]);

    // D3 Constellation Graph
    useEffect(() => {
        if (!profile || !svgRef.current) return;

        const width = 600;
        const height = 400;
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove(); // Clear previous drawing

        // Basic nodes: Center user, surrounded by skills/achievements
        const nodes: any[] = [{ id: 'User', group: 1, radius: 25 }];
        profile.unlocked_achievements.forEach((ua: any, i: number) => {
            nodes.push({ id: ua.achievement.name, group: 2, radius: 15 });
        });

        const links: any[] = [];
        for (let i = 1; i < nodes.length; i++) {
            links.push({ source: 'User', target: nodes[i].id, distance: 100 });
        }

        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2));

        const link = svg.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', '#3b82f6')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 2);

        const node = svg.append('g')
            .selectAll('circle')
            .data(nodes)
            .join('circle')
            .attr('r', d => d.radius)
            .attr('fill', d => d.group === 1 ? '#60a5fa' : '#34d399')
            .call(d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended) as any);

        const label = svg.append('g')
            .selectAll('text')
            .data(nodes)
            .join('text')
            .attr('dy', 4)
            .attr('dx', 15)
            .attr('fill', '#e2e8f0')
            .attr('font-size', '12px')
            .text(d => d.id);

        simulation.on('tick', () => {
            link
                .attr('x1', (d: any) => d.source.x)
                .attr('y1', (d: any) => d.source.y)
                .attr('x2', (d: any) => d.target.x)
                .attr('y2', (d: any) => d.target.y);

            node
                .attr('cx', (d: any) => d.x)
                .attr('cy', (d: any) => d.y);

            label
                .attr('x', (d: any) => d.x)
                .attr('y', (d: any) => d.y);
        });

        function dragstarted(event: any) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event: any) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event: any) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }

    }, [profile]);


    if (loading) {
        return <div className="page" style={{display:'flex', justifyContent:'center', alignItems:'center'}}>Loading Profile...</div>;
    }

    if (!profile) {
        return <div className="page" style={{display:'flex', justifyContent:'center', alignItems:'center'}}>Profile not found.</div>;
    }

    // Calculate level progress
    const currentLevelBaseXP = (profile.level - 1) * 100;
    const nextLevelXP = profile.level * 100;
    const progress = ((profile.xp - currentLevelBaseXP) / (nextLevelXP - currentLevelBaseXP)) * 100;

    return (
        <div className="page" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', color: '#60a5fa' }}>{profile.name} — Lvl {profile.level}</h1>
                    <p style={{ color: 'var(--text-muted)' }}>Coding since forever.</p>
                </div>
                <button className="btn btn-ghost" onClick={() => router.push('/dashboard')}>← Back to Main</button>
            </div>

            <div style={{
                background: 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(10px)',
                borderRadius: '16px',
                padding: '24px',
                marginBottom: '2rem',
                border: '1px solid rgba(255,255,255,0.1)'
            }}>
                <h3 style={{ marginBottom: '12px', fontSize: '1.2rem' }}>Experience to Level {profile.level + 1}</h3>
                <div style={{
                    width: '100%',
                    background: '#1a202c',
                    borderRadius: '8px',
                    height: '24px',
                    overflow: 'hidden',
                    position: 'relative'
                }}>
                    <div style={{
                        width: `${progress}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)',
                        transition: 'width 1s ease-in-out'
                    }}></div>
                    <span style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: 'white'
                    }}>
                        {profile.xp} / {nextLevelXP} XP
                    </span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                <div style={{
                    flex: '1 1 400px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: '16px',
                    padding: '24px',
                    border: '1px solid rgba(255,255,255,0.1)'
                }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '1.5rem', color: '#34d399' }}>Unlock Showcase</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                        {profile.unlocked_achievements.length === 0 ? (
                            <p style={{color: '#94a3b8'}}>No achievements yet. Get coding!</p>
                        ) : (
                            profile.unlocked_achievements.map((ua: any) => (
                                <div key={ua.id} style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    background: 'rgba(0,0,0,0.3)',
                                    padding: '16px',
                                    borderRadius: '12px',
                                    width: '140px',
                                    textAlign: 'center',
                                    border: '1px solid #34d399'
                                }}>
                                    <div style={{fontSize: '32px', marginBottom: '8px'}}>🏅</div>
                                    <div style={{fontWeight: 'bold', fontSize: '14px'}}>{ua.achievement.name}</div>
                                    <div style={{fontSize: '12px', color: '#94a3b8', marginTop: '4px'}}>{ua.achievement.description}</div>
                                    <div style={{fontSize: '12px', color: '#3b82f6', marginTop: '8px'}}>+{ua.achievement.xp_reward} XP</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div style={{
                    flex: '2 1 500px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: '16px',
                    padding: '24px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '1.5rem', width: '100%', textAlign: 'left', color: '#8b5cf6' }}>Activity Constellation</h3>
                    <p style={{width: '100%', fontSize: '14px', color: '#94a3b8', marginBottom: '16px'}}>Drag nodes to interact with your learning universe.</p>
                    <svg ref={svgRef} width="600" height="400" style={{background: 'rgba(0,0,0,0.2)', borderRadius: '12px'}}></svg>
                </div>
            </div>

        </div>
    );
}
