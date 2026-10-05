import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Lightbulb } from 'lucide-react';
import { InfoTip, RichText } from '../components/ui';
import { STRONG_CORRELATION, displayName } from '../lib/analysis';
import { SUGGESTED_QUESTIONS, answer } from '../lib/assistant';
import { guessTarget } from '../lib/blueprints';

const REPLY_DELAY_MS = 350;

export default function AssistantView({ analysis, messages, onMessages }) {
    const name = displayName(analysis.meta.fileName);
    const [input, setInput] = useState('');
    const [typing, setTyping] = useState(false);
    const endRef = useRef(null);
    const timer = useRef(null);

    useEffect(() => {
        endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
    }, [messages, typing]);

    useEffect(() => () => clearTimeout(timer.current), []);

    const ask = (text) => {
        const question = text.trim();
        if (!question || typing) return;
        onMessages((prev) => [...prev, { role: 'user', text: question }]);
        setInput('');
        setTyping(true);
        timer.current = setTimeout(() => {
            onMessages((prev) => [...prev, { role: 'assistant', text: answer(question, analysis) }]);
            setTyping(false);
        }, REPLY_DELAY_MS);
    };

    const strong = analysis.correlations.filter((c) => Math.abs(c.correlation) > STRONG_CORRELATION).length;
    const findings = analysis.insights.filter((i) => i.type !== 'success').slice(0, 4);

    return (
        <div className="page page--assistant">
            <aside className="assistant__aside">
                <p className="eyebrow">Talking about</p>
                <h2 className="assistant__dataset" title={name}>
                    {name}
                </h2>
                <dl className="facts facts--compact">
                    <dt>Records</dt>
                    <dd>{analysis.meta.rows.toLocaleString()}</dd>
                    <dt>Numeric columns</dt>
                    <dd>{analysis.numericCols.length}</dd>
                    <dt>Categorical columns</dt>
                    <dd>{analysis.categoricalCols.length}</dd>
                    <dt>Strong correlations</dt>
                    <dd>{strong}</dd>
                </dl>
                {findings.length > 0 && (
                    <>
                        <p className="eyebrow eyebrow--spaced">Highlights</p>
                        <ul className="highlights">
                            {findings.map((f, i) => (
                                <li key={i}>
                                    <Lightbulb aria-hidden="true" />
                                    <RichText text={f.text} />
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </aside>

            <section className="assistant" aria-label="Ask about your data">
                <div className="assistant__thread" aria-live="polite">
                    <div className="bubble bubble--bot">
                        <p>
                            Hi! Ask me anything about <strong>{name}</strong>. I answer from the analysis computed on your device.
                            <InfoTip text="Answers come from rules applied to the computed statistics. No data is sent to an AI service." />
                        </p>
                    </div>
                    {messages.map((m, i) => (
                        <div key={i} className={`bubble ${m.role === 'user' ? 'bubble--user' : 'bubble--bot'}`}>
                            <RichText text={m.text} />
                        </div>
                    ))}
                    {typing && (
                        <div className="bubble bubble--bot bubble--typing" aria-label="Assistant is typing">
                            <span />
                            <span />
                            <span />
                        </div>
                    )}
                    <div ref={endRef} />
                </div>

                <div className="assistant__composer">
                    <div className="chips" aria-label="Suggested questions">
                        {SUGGESTED_QUESTIONS.map((q) => (
                            <button key={q} type="button" className="chip" onClick={() => ask(q)} disabled={typing}>
                                {q}
                            </button>
                        ))}
                    </div>
                    <form
                        className="composer"
                        onSubmit={(e) => {
                            e.preventDefault();
                            ask(input);
                        }}
                    >
                        <label htmlFor="assistant-input" className="visually-hidden">
                            Your question
                        </label>
                        <input
                            id="assistant-input"
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={`e.g. What is the average of ${guessTarget(analysis) ?? 'a column'}?`}
                            autoComplete="off"
                        />
                        <button type="submit" className="composer__send" disabled={!input.trim() || typing} aria-label="Send">
                            <ArrowUp aria-hidden="true" />
                        </button>
                    </form>
                </div>
            </section>
        </div>
    );
}
