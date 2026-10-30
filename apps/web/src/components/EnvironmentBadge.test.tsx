import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../env';
import { DemoBanner, EnvironmentBadge } from './EnvironmentBadge';

const others: AppEnv[] = ['operational', 'demo'];

describe('EnvironmentBadge', () => {
  it('shows the R&D badge in the rnd environment', () => {
    render(<EnvironmentBadge appEnv="rnd" />);
    expect(screen.getByText('R&D environment')).toBeInTheDocument();
  });

  it.each(others)('shows nothing in %s', (appEnv) => {
    const { container } = render(<EnvironmentBadge appEnv={appEnv} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DemoBanner', () => {
  it('shows the banner in the demo environment', () => {
    render(<DemoBanner appEnv="demo" />);
    expect(screen.getByText('Demo – sample data')).toBeInTheDocument();
  });

  it.each<AppEnv>(['operational', 'rnd'])('shows nothing in %s', (appEnv) => {
    const { container } = render(<DemoBanner appEnv={appEnv} />);
    expect(container).toBeEmptyDOMElement();
  });
});
