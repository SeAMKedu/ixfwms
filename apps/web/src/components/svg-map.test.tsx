import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render';
import { SvgMap } from './svg-map';

const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <script>window.hacked = true</script>
  <rect id="loc:A3F9" width="80" height="80" onclick="window.hacked = true"/>
  <g id="loc-K7Q2"><rect x="100" width="80" height="80"/></g>
  <text id="title">Lab</text>
</svg>`;

describe('SvgMap', () => {
  it('strips scripts, links places, highlights the target and opens places on click', async () => {
    const { router, container } = renderAt(
      '/',
      [
        {
          path: '/',
          element: <SvgMap href="/api/files/f1/plan.svg" highlight={['K7Q2']} title="Lab" />,
        },
        { path: '/l/:code', element: <p>place page</p> },
      ],
      { '/api/files/f1/plan.svg': drawing },
    );
    await waitFor(() => expect(container.querySelector('.ixf-map [data-ixf-code]')).not.toBeNull());
    const svg = container.querySelector('.ixf-map svg')!;
    expect(svg.querySelector('script')).toBeNull();
    expect(svg.querySelector('[onclick]')).toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
    expect(svg.querySelector('[data-ixf-code="K7Q2"]')?.classList.contains('ixf-target')).toBe(
      true,
    );
    expect(svg.querySelector('[data-ixf-code="A3F9"]')?.classList.contains('ixf-hit')).toBe(false);
    await userEvent.click(svg.querySelector('[data-ixf-code="A3F9"]')!);
    expect(router.state.location.pathname).toBe('/l/A3F9');
    expect(screen.getByText('place page')).toBeTruthy();
  });
});
