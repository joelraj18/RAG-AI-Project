import React from 'react';
import { BarChart3, Database, Leaf, LogOut, MessageCircle } from 'lucide-react';
import { InfoTip } from './ui';
import { GLOSSARY } from '../lib/glossary';

export const NAV_ITEMS = [
    { id: 'datasets', label: 'Datasets', icon: Database, needsData: false },
    { id: 'explorer', label: 'Explore', icon: BarChart3, needsData: true },
    { id: 'assistant', label: 'Ask', icon: MessageCircle, needsData: true },
];

const initials = (name = '') =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('') || '?';

export function GlobalNav({ view, onNavigate, hasDataset, user, onSignOut }) {
    return (
        <header className="globalnav">
            <nav className="globalnav__inner" aria-label="Main">
                <button type="button" className="globalnav__brand" onClick={() => onNavigate('datasets')}>
                    <Leaf aria-hidden="true" />
                    <span>DataMind</span>
                </button>

                <ul className="globalnav__links">
                    {NAV_ITEMS.map(({ id, label, icon: Icon, needsData }) => (
                        <li key={id}>
                            <button
                                type="button"
                                className={`globalnav__link ${view === id ? 'is-active' : ''}`}
                                aria-current={view === id ? 'page' : undefined}
                                disabled={needsData && !hasDataset}
                                title={needsData && !hasDataset ? 'Open a dataset first' : undefined}
                                aria-label={label}
                                onClick={() => onNavigate(id)}
                            >
                                <Icon aria-hidden="true" />
                                <span>{label}</span>
                            </button>
                        </li>
                    ))}
                </ul>

                <div className="globalnav__user">
                    <span className="avatar" title={`${user.name} · ${user.email}`} aria-label={`Signed in as ${user.name}`}>
                        {initials(user.name)}
                    </span>
                    <button type="button" className="icon-btn" onClick={onSignOut} aria-label="Sign out" title="Sign out">
                        <LogOut aria-hidden="true" />
                    </button>
                </div>
            </nav>
        </header>
    );
}

/** The slim announcement strip under the nav, like Apple's offers ribbon. */
export function Ribbon({ children }) {
    return (
        <div className="ribbon">
            <p>
                {children}
                <InfoTip text={GLOSSARY.privacy} label="How your data is handled" />
            </p>
        </div>
    );
}
