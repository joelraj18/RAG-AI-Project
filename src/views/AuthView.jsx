import React, { useState } from 'react';
import { Leaf, Lock, Mail, ShieldCheck, Sparkles, User, Zap } from 'lucide-react';
import { Callout } from '../components/ui';

const EMPTY_FORM = { name: '', email: '', password: '' };

const FEATURES = [
    { icon: Zap, title: 'Instant analysis', text: 'Statistics, distributions and correlations the moment a CSV lands.' },
    { icon: ShieldCheck, title: 'Private by design', text: 'Everything runs in your browser. No file ever leaves your device.' },
    { icon: Sparkles, title: 'Insights in plain language', text: 'Anomalies, segments and predictive signals, explained clearly.' },
];

export default function AuthView({ onSignIn, onRegister }) {
    const [mode, setMode] = useState('signin');
    const [form, setForm] = useState(EMPTY_FORM);
    const [error, setError] = useState('');

    const isRegister = mode === 'register';
    const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

    const submit = (e) => {
        e.preventDefault();
        setError('');
        const email = form.email.trim().toLowerCase();
        if (isRegister && !form.name.trim()) return setError('Please enter your name.');
        if (form.password.length < (isRegister ? 6 : 1)) {
            return setError(isRegister ? 'Use a password with at least 6 characters.' : 'Please enter your password.');
        }
        try {
            if (isRegister) onRegister({ name: form.name.trim(), email, password: form.password });
            else onSignIn({ email, password: form.password });
        } catch (err) {
            setError(err.message);
        }
        return undefined;
    };

    const switchMode = (next) => {
        setMode(next);
        setError('');
    };

    return (
        <div className="auth">
            <section className="auth__intro">
                <Leaf className="auth__logo" aria-hidden="true" />
                <h1 className="display">
                    DataMind
                    <br />
                    <span className="display__soft">Data, explained</span>
                </h1>
                <p className="lead">Drop in a CSV and get a complete exploratory analysis in seconds. No setup, no server, no code.</p>
                <ul className="feature-list">
                    {FEATURES.map(({ icon: Icon, title, text }) => (
                        <li key={title}>
                            <Icon aria-hidden="true" />
                            <div>
                                <p className="feature-list__title">{title}</p>
                                <p className="feature-list__text">{text}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="auth__panel" aria-labelledby="auth-heading">
                <div className="segmented" role="tablist" aria-label="Account">
                    <button type="button" role="tab" aria-selected={!isRegister} className={!isRegister ? 'is-active' : ''} onClick={() => switchMode('signin')}>
                        Sign in
                    </button>
                    <button type="button" role="tab" aria-selected={isRegister} className={isRegister ? 'is-active' : ''} onClick={() => switchMode('register')}>
                        Create account
                    </button>
                </div>

                <h2 id="auth-heading" className="auth__heading">
                    {isRegister ? 'Create your DataMind account' : 'Sign in to DataMind'}
                </h2>

                <form onSubmit={submit} noValidate>
                    {isRegister && (
                        <label className="field">
                            <span className="field__label">Name</span>
                            <span className="field__control">
                                <User aria-hidden="true" />
                                <input type="text" autoComplete="name" value={form.name} onChange={update('name')} placeholder="Jane Appleseed" required />
                            </span>
                        </label>
                    )}
                    <label className="field">
                        <span className="field__label">Email</span>
                        <span className="field__control">
                            <Mail aria-hidden="true" />
                            <input type="email" autoComplete="email" value={form.email} onChange={update('email')} placeholder="you@example.com" required />
                        </span>
                    </label>
                    <label className="field">
                        <span className="field__label">Password</span>
                        <span className="field__control">
                            <Lock aria-hidden="true" />
                            <input
                                type="password"
                                autoComplete={isRegister ? 'new-password' : 'current-password'}
                                value={form.password}
                                onChange={update('password')}
                                placeholder={isRegister ? 'At least 6 characters' : 'Password'}
                                required
                            />
                        </span>
                    </label>

                    {error && (
                        <p className="form-error" role="alert">
                            {error}
                        </p>
                    )}

                    <button type="submit" className="btn btn--primary btn--block btn--lg">
                        {isRegister ? 'Create account' : 'Sign in'}
                    </button>
                </form>

                <Callout tone="info" title="Local demo account">
                    Accounts and datasets are stored only in this browser’s local storage. This keeps your workspaces separate on a shared
                    computer, but it is not a secure login, so don’t reuse an important password.
                </Callout>
            </section>
        </div>
    );
}
