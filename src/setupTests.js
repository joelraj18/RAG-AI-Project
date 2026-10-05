// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom has no Web Workers (and can't load import.meta); the engine falls back to the main thread.
jest.mock('./engine/workerFactory', () => ({ createScanWorker: () => null }));
