import { render, screen } from '@testing-library/react';
import AppWrapper from './App';
import { describe, it, expect } from 'vitest';

describe('App', () => {
  it('renders without crashing', () => {
    render(<AppWrapper />);
    // Since content loads lazily and might show loader, we just check if it renders *something*
    // or specifically look for the header which is always there.
    const headerElement = screen.getByRole('banner'); // Header usually has role='banner' or we can check by text
    expect(headerElement).toBeInTheDocument();
  });
});
