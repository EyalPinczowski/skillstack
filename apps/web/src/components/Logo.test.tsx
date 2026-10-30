import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './Logo';

describe('Logo', () => {
  it('has an accessible name and draws three blocks', () => {
    render(<Logo />);
    const logo = screen.getByRole('img', { name: 'Skillstack' });
    expect(logo.querySelectorAll('rect')).toHaveLength(3);
  });

  it('is hidden from assistive technology when decorative', () => {
    render(<Logo title={null} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
