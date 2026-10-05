import { act, fireEvent, render, screen, within } from '@testing-library/react';
import DataMind from './DataMind';

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
beforeAll(() => {
    window.scrollTo = jest.fn();
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

beforeEach(() => localStorage.clear());

test('register, analyse the sample, explore every view and ask a question', async () => {
    render(<DataMind />);

    fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    fireEvent.change(screen.getByPlaceholderText('Jane Appleseed'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 6 characters'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByRole('heading', { name: 'Datasets' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('datamind_current_user'))).not.toHaveProperty('password');

    fireEvent.click(screen.getByRole('button', { name: /Try a sample dataset/ }));
    expect(await screen.findByText(/rows read/)).toBeInTheDocument();
    expect((await screen.findAllByText(/All 20,000 rows analysed/, {}, { timeout: 15000 })).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Phone sales sample' })).toBeInTheDocument();

    // Overview: column catalogue and preview.
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toHaveTextContent('OrderDate');

    // Univariate: every chart type on the first numeric card.
    fireEvent.click(screen.getByRole('tab', { name: 'Univariate' }));
    const firstCard = screen.getAllByRole('radiogroup', { name: /Chart type for StorageGB/ })[0];
    for (const view of ['Box plot', 'Cumulative', 'Q-Q', 'Histogram']) {
        fireEvent.click(within(firstCard).getByRole('radio', { name: view }));
        expect(within(firstCard).getByRole('radio', { name: view })).toHaveAttribute('aria-checked', 'true');
    }
    expect(screen.getAllByRole('button', { name: /Download/ }).length).toBeGreaterThan(3);

    for (const tab of ['Correlation', 'Bivariate', 'Insights', 'Decision Center', 'Data Quality', 'Segmentation', 'Predictive', 'Python Template']) {
        fireEvent.click(screen.getByRole('tab', { name: tab }));
        expect(screen.getByRole('tabpanel', { name: tab })).toBeInTheDocument();
    }

    jest.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'average of price' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText(/The average of/)).toBeInTheDocument();
    jest.useRealTimers();
}, 30000);
